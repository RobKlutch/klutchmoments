/**
 * Spatial Tracking System for Player Detection
 * Maintains consistent player IDs across video frames using position-based tracking
 * with IoU continuity and velocity gating for robust ID-lock preservation
 */

interface TrackedPlayer {
  id: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  confidence: number;
  lastSeen: number;
  lostFrames: number;
}

interface DetectionPlayer {
  centerX: number;
  centerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  id?: string;
}

// Global tracking state: Key = videoId, Value = tracked players array
const playerTracker = new Map<string, TrackedPlayer[]>();

// **ANCHOR STORAGE**: Store FULL canonical anchor coordinates for backward seek recovery
// Key = videoId, Value = { playerId, coordinates with topLeft AND center }
const anchorStorage = new Map<string, {
  playerId: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  topLeftX?: number;
  topLeftY?: number;
} | null>();

// Global player ID counter - ensures unique IDs that are NEVER reused
let globalPlayerIdCounter = 1;

/**
 * Helper to create a complete player object with all required fields
 * @param topLeftXOverride - If provided, use explicit topLeft instead of calculating from center (canonical coordinates)
 * @param topLeftYOverride - If provided, use explicit topLeft instead of calculating from center (canonical coordinates)
 */
function createPlayerObject(
  id: string, 
  centerX: number, 
  centerY: number, 
  width: number, 
  height: number, 
  confidence: number,
  topLeftXOverride?: number,
  topLeftYOverride?: number
) {
  // **CANONICAL COORDINATES FIX**: Use explicit topLeft if provided, otherwise calculate from center
  const topLeftX = topLeftXOverride !== undefined ? topLeftXOverride : centerX - width / 2;
  const topLeftY = topLeftYOverride !== undefined ? topLeftYOverride : centerY - height / 2;
  
  return {
    id,
    x: topLeftX,
    y: topLeftY,
    width,
    height,
    centerX,
    centerY,
    topLeftX,
    topLeftY,
    confidence,
    description: `Player ${id.replace('player_', '')}`
  };
}

/**
 * Reset tracking state for a video to prevent ID explosion and stale player accumulation
 * @param videoId - Video identifier to reset (optional - resets all if not provided)
 * @param selectedPlayerId - The player ID selected in Timeline stage (optional)
 * @param anchorCoordinates - FULL canonical coordinates from Timeline (includes topLeftX/Y and centerX/Y)
 */
export function resetTrackingState(
  videoId?: string, 
  selectedPlayerId?: string, 
  anchorCoordinates?: { 
    x: number; 
    y: number; 
    width: number; 
    height: number; 
    centerX: number; 
    centerY: number;
    topLeftX?: number;
    topLeftY?: number;
  }
): void {
  if (videoId) {
    // Reset specific video
    playerTracker.delete(videoId);
    
    // **CRITICAL FIX (Oct 20, 2025)**: Reset player ID counter for each new session
    // This ensures player IDs start from 1 (player_1, player_2, etc.) for every video upload
    globalPlayerIdCounter = 1;
    
    // **CRITICAL FIX**: Store FULL canonical coordinates from Timeline without re-normalization
    // This ensures coordinates pass through unchanged: Timeline → Backend → Video Preview
    if (selectedPlayerId && anchorCoordinates) {
      const anchorPlayer: TrackedPlayer = {
        id: selectedPlayerId,
        centerX: anchorCoordinates.centerX,
        centerY: anchorCoordinates.centerY,
        width: anchorCoordinates.width,
        height: anchorCoordinates.height,
        confidence: 1.0, // Anchor has maximum confidence
        lastSeen: 0, // Will be updated on first detection
        lostFrames: 0
      };
      
      playerTracker.set(videoId, [anchorPlayer]);
      
      // **ANCHOR STORAGE**: Save FULL canonical coordinates (including topLeft) for backward seek recovery
      anchorStorage.set(videoId, {
        playerId: selectedPlayerId,
        centerX: anchorCoordinates.centerX,
        centerY: anchorCoordinates.centerY,
        width: anchorCoordinates.width,
        height: anchorCoordinates.height,
        topLeftX: anchorCoordinates.topLeftX,
        topLeftY: anchorCoordinates.topLeftY
      });
      
      console.log(`🧹 TRACKING RESET: Initialized tracking for videoId=${videoId} with FULL canonical anchor:`, {
        playerId: selectedPlayerId,
        topLeft: anchorCoordinates.topLeftX !== undefined 
          ? `(${anchorCoordinates.topLeftX.toFixed(3)}, ${anchorCoordinates.topLeftY!.toFixed(3)})`
          : 'not provided',
        center: `(${anchorCoordinates.centerX.toFixed(3)}, ${anchorCoordinates.centerY.toFixed(3)})`,
        anchor: 'Timeline selection (canonical coordinates stored)',
        idCounterReset: true
      });
    } else {
      anchorStorage.delete(videoId);
      console.log(`🧹 TRACKING RESET: Cleared tracking state for videoId=${videoId} (no anchor provided), reset ID counter to 1`);
    }
  } else {
    // Reset all tracking state
    playerTracker.clear();
    anchorStorage.clear();
    globalPlayerIdCounter = 1;
    console.log(`🧹 TRACKING RESET: Cleared all tracking state, reset ID counter to 1`);
  }
}

/**
 * Calculate Intersection over Union (IoU) between two bounding boxes
 * @param box1 - First bounding box with centerX, centerY, width, height
 * @param box2 - Second bounding box with centerX, centerY, width, height
 * @returns IoU value between 0 and 1
 */
function calculateIoU(box1: {centerX: number, centerY: number, width: number, height: number}, 
                     box2: {centerX: number, centerY: number, width: number, height: number}): number {
  // Convert to top-left coordinates
  const x1_1 = box1.centerX - box1.width / 2;
  const y1_1 = box1.centerY - box1.height / 2;
  const x2_1 = box1.centerX + box1.width / 2;
  const y2_1 = box1.centerY + box1.height / 2;
  
  const x1_2 = box2.centerX - box2.width / 2;
  const y1_2 = box2.centerY - box2.height / 2;
  const x2_2 = box2.centerX + box2.width / 2;
  const y2_2 = box2.centerY + box2.height / 2;
  
  // Calculate intersection
  const intersectionX1 = Math.max(x1_1, x1_2);
  const intersectionY1 = Math.max(y1_1, y1_2);
  const intersectionX2 = Math.min(x2_1, x2_2);
  const intersectionY2 = Math.min(y2_1, y2_2);
  
  const intersectionWidth = Math.max(0, intersectionX2 - intersectionX1);
  const intersectionHeight = Math.max(0, intersectionY2 - intersectionY1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  
  // Calculate union
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const unionArea = area1 + area2 - intersectionArea;
  
  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

/**
 * Check if a detection passes continuity gates for ID-locked matching
 * @param tracker - Existing tracked player
 * @param detection - New detection candidate
 * @param timestamp - Current timestamp
 * @param isSelected - Whether this is the selected player (stricter gating)
 * @returns Object with gate results and telemetry
 */
function checkContinuityGates(tracker: TrackedPlayer, detection: DetectionPlayer, timestamp: number, isSelected: boolean = false) {
  const distance = Math.sqrt(
    Math.pow(detection.centerX - tracker.centerX, 2) + 
    Math.pow(detection.centerY - tracker.centerY, 2)
  );
  
  const iou = calculateIoU(tracker, detection);
  
  // **CRITICAL FIX**: Handle missing lastSeen timestamp to prevent NaN velocity calculations
  const lastSeen = tracker.lastSeen || timestamp; // Fallback to current timestamp if missing
  const dtRaw = timestamp - lastSeen;
  const dt = Math.max(0.001, dtRaw); // Minimum to prevent division by zero
  
  // **DEBUG**: Log timestamp values to diagnose dt calculation
  if (isSelected && dt < 0.01) {
    console.log(`⚠️ DT CALCULATION DEBUG: tracker.lastSeen=${lastSeen.toFixed(3)}s, currentTimestamp=${timestamp.toFixed(3)}s, dtRaw=${dtRaw.toFixed(3)}s, dt=${dt.toFixed(3)}s`);
  }

  
  // Velocity gating parameters (more lenient to prevent ID explosion)
  const V_MAX = 0.8; // More generous max velocity  
  const EPSILON = 0.05; // Larger tolerance for measurement noise
  const maxAllowedDistance = V_MAX * dt + EPSILON;
  
  // **INSTANT STICKY TRACKING**: Continuity gates optimized for fast movements (jumps, sprints, pivots)
  if (isSelected) {
    // **CRITICAL FIX**: Reduced from 1.5 to 0.35 to prevent tracker jumping between different players
    // At 1.3s interval: max distance = 0.455 (45.5% of screen) instead of 1.95 (195% of screen!)
    // This prevents the tracker from teleporting from left side to right side
    // while still allowing tracking of fast sprints and direction changes
    const MAX_VELOCITY_SELECTED = 0.35; // Balanced: strict enough to prevent jumps, lenient enough for sprints
    const MIN_IOU_STRICT = 0.05; // Require meaningful overlap
    const MIN_DT_FOR_VELOCITY_CHECK = 0.05; // Minimum dt to calculate velocity (prevents division by near-zero)
    
    // **VELOCITY-BASED DISTANCE**: Scale threshold with time interval for smooth tracking
    // At 2s interval: max distance = 0.5, at 0.1s: max distance = 0.025
    const DISTANCE_THRESHOLD = MAX_VELOCITY_SELECTED * dt;
    
    // **STICKINESS ENFORCEMENT**: Require BOTH distance AND IoU (not OR)
    const distanceGatePassed = distance <= DISTANCE_THRESHOLD;
    const iouGatePassed = iou >= MIN_IOU_STRICT;
    
    // **CRITICAL FIX**: Skip velocity check if dt is too small (prevents spurious failures)
    // When dt < 50ms, even tiny distances produce huge velocities due to division
    let velocityGatePassed = true;
    if (dt >= MIN_DT_FOR_VELOCITY_CHECK) {
      const velocity = distance / dt;
      velocityGatePassed = velocity <= MAX_VELOCITY_SELECTED;
    }
    
    // **SMART LOCK**: Accept if (distance valid OR IoU valid) AND velocity valid
    // At 2s intervals, IoU can be 0 for moving players, so OR logic enables distance-based tracking
    const accepted = (distanceGatePassed || iouGatePassed) && velocityGatePassed;
    
    return {
      accepted,
      distance,
      iou,
      dt,
      maxAllowedDistance,
      gates: {
        distanceStrict: distanceGatePassed,
        iouStrict: iouGatePassed,
        velocity: velocityGatePassed
      },
      reason: !accepted ? 
        (!velocityGatePassed ? 'velocity_exceeded' : 
         (!distanceGatePassed || !iouGatePassed) ? 'sticky_continuity_failed' : 'unknown') : 'sticky_accepted'
    };
  } else {
    // More relaxed gates for non-selected players to prevent ID explosion
    const DISTANCE_THRESHOLD = 0.15; // More generous distance
    const MIN_IOU = 0.02; // Much more relaxed IoU
    
    const distanceGatePassed = distance <= DISTANCE_THRESHOLD;
    const iouGatePassed = iou >= MIN_IOU;
    const velocityGatePassed = distance <= maxAllowedDistance;
    
    const accepted = distanceGatePassed && iouGatePassed && velocityGatePassed;
    
    return {
      accepted,
      distance,
      iou,
      dt,
      maxAllowedDistance,
      gates: {
        distance: distanceGatePassed,
        iou: iouGatePassed,
        velocity: velocityGatePassed
      },
      reason: !accepted ?
        (!velocityGatePassed ? 'velocity_exceeded' :
         !distanceGatePassed ? 'distance_exceeded' :
         !iouGatePassed ? 'iou_too_low' : 'unknown') : 'accepted'
    };
  }
}

/**
 * Assign consistent player IDs across frames using spatial tracking
 * @param newDetections - Array of player detections from current frame
 * @param videoId - Unique identifier for the video being processed
 * @param timestamp - Current timestamp in seconds
 * @returns Array of players with consistent IDs
 */
export function assignConsistentPlayerIDs(
  newDetections: DetectionPlayer[], 
  videoId: string, 
  timestamp: number,
  selectedPlayerId?: string,
  selectedPlayer?: { id: string; x: number; y: number; centerX?: number; centerY?: number } | null
): DetectionPlayer[] {
  const MATCH_THRESHOLD = 0.08; // **TIGHTENED**: Stricter distance-based matching
  const MAX_LOST_FRAMES = 30;   // Keep players longer to avoid ID churn
  const MIN_CONFIDENCE_BOOST = 0.05; // Boost confidence for tracked players
  
  // Get or initialize tracking state for this video
  let trackedPlayers = playerTracker.get(videoId) || [];
  
  // **BACKWARD SEEK DETECTION**: Reset tracking if timestamp jumps backward significantly
  // **CRITICAL FIX**: Preserve selected anchor player during backward seeks
  if (trackedPlayers.length > 0) {
    const mostRecentSeen = Math.max(...trackedPlayers.map(p => p.lastSeen));
    const timeDelta = timestamp - mostRecentSeen;
    
    // If timestamp jumped backward by more than 0.5s, assume a seek occurred
    if (timeDelta < -0.5) {
      console.log(`⏪ BACKWARD SEEK DETECTED: timestamp=${timestamp.toFixed(3)}s, lastSeen=${mostRecentSeen.toFixed(3)}s, delta=${timeDelta.toFixed(3)}s`);
      
      // **ANCHOR PRESERVATION**: Restore selected player to original Timeline anchor geometry
      const storedAnchor = anchorStorage.get(videoId);
      
      if (storedAnchor && selectedPlayerId === storedAnchor.playerId) {
        // **CRITICAL FIX**: Reset geometry to ORIGINAL anchor coordinates, not current position
        // This ensures IoU gates pass when matching to earlier-frame detections
        const restoredAnchor: TrackedPlayer = {
          id: storedAnchor.playerId,
          centerX: storedAnchor.centerX,
          centerY: storedAnchor.centerY,
          width: storedAnchor.width,
          height: storedAnchor.height,
          confidence: 1.0,
          lastSeen: 0, // Fresh anchor
          lostFrames: 0
        };
        
        trackedPlayers = [restoredAnchor];
        playerTracker.set(videoId, trackedPlayers);
        console.log(`🔒 BACKWARD SEEK: Restored anchor geometry for ${storedAnchor.playerId} to Timeline position (${storedAnchor.centerX.toFixed(3)}, ${storedAnchor.centerY.toFixed(3)})`);
      } else {
        console.log(`⚠️ BACKWARD SEEK: No stored anchor found - Clearing all trackers`);
        resetTrackingState(videoId);
        trackedPlayers = [];
      }
    }
  }
  
  // Remove players that have been lost for too long
  trackedPlayers = trackedPlayers.filter(player => player.lostFrames < MAX_LOST_FRAMES);
  
  // **ARCHITECT FIX**: Take snapshot to prevent intra-frame double-matching
  const originalTrackerCount = trackedPlayers.length;
  const resultPlayers: DetectionPlayer[] = [];
  const matchedTrackers = new Set<number>();
  const matchedDetections = new Set<number>();
  
  // **PHASE 1**: Match detections against EXISTING trackers only
  // **ID-LOCK PRIORITY**: First, try to match the selected player if specified
  if (selectedPlayerId) {
    let selectedTrackerIdx = trackedPlayers.findIndex(t => t.id === selectedPlayerId);
    
    // **FALLBACK ID RECOVERY**: If selected ID not found but coordinates provided, create tracker with selected ID
    if (selectedTrackerIdx < 0 && selectedPlayer && selectedPlayer.centerX !== undefined && selectedPlayer.centerY !== undefined) {
      console.log(`🔄 ID RECOVERY: Selected player ${selectedPlayerId} not in trackers, creating from coordinates (${selectedPlayer.centerX.toFixed(3)}, ${selectedPlayer.centerY.toFixed(3)})`);
      
      const recoveredTracker: TrackedPlayer = {
        id: selectedPlayerId,
        centerX: selectedPlayer.centerX,
        centerY: selectedPlayer.centerY,
        width: 0.06,  // Default size
        height: 0.14,
        confidence: 0.8,
        lastSeen: timestamp,
        lostFrames: 0
      };
      
      trackedPlayers.push(recoveredTracker);
      selectedTrackerIdx = trackedPlayers.length - 1;
    }
    
    if (selectedTrackerIdx >= 0 && selectedTrackerIdx < trackedPlayers.length) {
      const selectedTracker = trackedPlayers[selectedTrackerIdx];
      let bestDetectionForSelected = -1;
      let bestDistanceForSelected = Infinity;
      
      // Find the best detection using IoU + velocity gating
      for (let detectIdx = 0; detectIdx < newDetections.length; detectIdx++) {
        if (matchedDetections.has(detectIdx)) continue;
        
        const detection = newDetections[detectIdx];
        const gateResult = checkContinuityGates(selectedTracker, detection, timestamp, true);
        
        // Log gate results for debugging
        console.log(`🧪 SELECTED GATE CHECK: player=${selectedPlayerId} detection=${detectIdx} distance=${gateResult.distance.toFixed(3)} iou=${gateResult.iou.toFixed(3)} dt=${gateResult.dt.toFixed(3)}s maxDist=${gateResult.maxAllowedDistance.toFixed(3)} gates=${JSON.stringify(gateResult.gates)} result=${gateResult.reason}`);
        
        // Accept detection if it passes continuity gates and is the best so far
        if (gateResult.accepted && gateResult.distance < bestDistanceForSelected) {
          bestDetectionForSelected = detectIdx;
          bestDistanceForSelected = gateResult.distance;
        }
      }
      
      // If we found a match for the selected player, lock it in first
      if (bestDetectionForSelected >= 0) {
        const detection = newDetections[bestDetectionForSelected];
        // **INSTANT RESPONSE SMOOTHING**: High alpha for immediate reaction to movements
        const SMOOTHING_ALPHA = 0.9; // Very responsive - instantly reacts to jumps, dashes, pivots
        selectedTracker.centerX = SMOOTHING_ALPHA * detection.centerX + (1 - SMOOTHING_ALPHA) * selectedTracker.centerX;
        selectedTracker.centerY = SMOOTHING_ALPHA * detection.centerY + (1 - SMOOTHING_ALPHA) * selectedTracker.centerY;
        selectedTracker.width = SMOOTHING_ALPHA * detection.width + (1 - SMOOTHING_ALPHA) * selectedTracker.width;
        selectedTracker.height = SMOOTHING_ALPHA * detection.height + (1 - SMOOTHING_ALPHA) * selectedTracker.height;
        selectedTracker.confidence = Math.min(1.0, Math.max(detection.confidence, selectedTracker.confidence + MIN_CONFIDENCE_BOOST));
        selectedTracker.lastSeen = timestamp;
        selectedTracker.lostFrames = 0;
        
        // **CANONICAL COORDINATES FIX**: Use anchor topLeft if available (prevents re-normalization)
        const storedAnchor = anchorStorage.get(videoId);
        const useAnchorTopLeft = storedAnchor && storedAnchor.playerId === selectedPlayerId && 
                                  storedAnchor.topLeftX !== undefined;
        
        resultPlayers.push(createPlayerObject(
          selectedTracker.id,
          selectedTracker.centerX,
          selectedTracker.centerY,
          selectedTracker.width,
          selectedTracker.height,
          selectedTracker.confidence,
          useAnchorTopLeft ? storedAnchor.topLeftX : undefined,
          useAnchorTopLeft ? storedAnchor.topLeftY : undefined
        ));
        
        matchedTrackers.add(selectedTrackerIdx);
        matchedDetections.add(bestDetectionForSelected);
        console.log(`🔒 ID-LOCK: Preserved selected player ${selectedPlayerId} at distance ${bestDistanceForSelected.toFixed(3)}`);
      } else {
        console.log(`🚫 ID-LOCK FAILED: No detection passed continuity gates for selected player ${selectedPlayerId}`);
        
        // **CRITICAL FIX**: Update lastSeen even in HOLD mode to prevent stale timestamps
        selectedTracker.lastSeen = timestamp;
        selectedTracker.lostFrames++;
        selectedTracker.confidence = Math.max(0.1, selectedTracker.confidence * 0.9); // Decay confidence
        
        // **CANONICAL COORDINATES FIX**: Use anchor topLeft if available (prevents re-normalization)
        const storedAnchorHold = anchorStorage.get(videoId);
        const useAnchorTopLeftHold = storedAnchorHold && storedAnchorHold.playerId === selectedPlayerId && 
                                      storedAnchorHold.topLeftX !== undefined;
        
        // Emit last-known position (prevents coordinate jumps)
        resultPlayers.push(createPlayerObject(
          selectedTracker.id,
          selectedTracker.centerX,
          selectedTracker.centerY,
          selectedTracker.width,
          selectedTracker.height,
          selectedTracker.confidence,
          useAnchorTopLeftHold ? storedAnchorHold.topLeftX : undefined,
          useAnchorTopLeftHold ? storedAnchorHold.topLeftY : undefined
        ));
        
        matchedTrackers.add(selectedTrackerIdx);
        console.log(`🔒 ID-LOCK HOLD: Emitting last-known position for ${selectedPlayerId} (lostFrames=${selectedTracker.lostFrames}, confidence=${selectedTracker.confidence.toFixed(3)})`);
      }
    } else {
      console.log(`🚫 ID-LOCK FAILED: Selected player ${selectedPlayerId} not found in tracked players`);
      
      // **ID-LOCK RECOVERY**: Create new tracker with selected ID from best available detection
      if (newDetections.length > 0) {
        // **FIX**: Find detection closest to user's selection instead of highest confidence
        let bestDetection = null;
        let bestDetectionIdx = -1;
        let bestScore = Infinity; // Lower is better (distance-based)
        
        for (let detectIdx = 0; detectIdx < newDetections.length; detectIdx++) {
          if (matchedDetections.has(detectIdx)) continue;
          
          const detection = newDetections[detectIdx];
          
          // **CRITICAL FIX**: Use spatial distance from anchor or selectedPlayer, otherwise fall back to confidence
          let score: number;
          
          // **PRIORITY 1**: Check stored anchor coordinates from /api/reset-tracking
          const storedAnchor = anchorStorage.get(videoId);
          const hasAnchor = storedAnchor && storedAnchor.playerId === selectedPlayerId;
          
          // **PRIORITY 2**: Check selectedPlayer coordinates from detection request
          const hasSelectedPlayerCoords = selectedPlayer && (selectedPlayer.centerX !== undefined || selectedPlayer.x !== undefined);
          
          if (hasAnchor || hasSelectedPlayerCoords) {
            // Use distance to anchor (priority) or selected player's position (fallback)
            let selectedCenterX: number;
            let selectedCenterY: number;
            
            if (hasAnchor) {
              // **USE STORED ANCHOR** - highest priority!
              selectedCenterX = storedAnchor.centerX;
              selectedCenterY = storedAnchor.centerY;
              console.log(`🎯 ID-LOCK RECOVERY: Using stored ANCHOR coordinates (${selectedCenterX.toFixed(3)}, ${selectedCenterY.toFixed(3)}) for spatial matching`);
            } else {
              // Fallback to selectedPlayer coordinates
              selectedCenterX = selectedPlayer.centerX ?? (selectedPlayer.x + 0.03); // Fallback estimate
              selectedCenterY = selectedPlayer.centerY ?? (selectedPlayer.y + 0.07); // Fallback estimate
            }
            
            const detectionCenterX = detection.centerX ?? (detection.x + detection.width / 2);
            const detectionCenterY = detection.centerY ?? (detection.y + detection.height / 2);
            
            const distance = Math.sqrt(
              Math.pow(detectionCenterX - selectedCenterX, 2) +
              Math.pow(detectionCenterY - selectedCenterY, 2)
            );
            score = distance; // Lower distance = better match
          } else {
            // Fall back to inverse confidence (higher confidence = lower score)
            score = 1.0 - detection.confidence;
          }
          
          if (!bestDetection || score < bestScore) {
            bestDetection = detection;
            bestDetectionIdx = detectIdx;
            bestScore = score;
          }
        }
        
        if (bestDetection && bestDetectionIdx >= 0) {
          const storedAnchor = anchorStorage.get(videoId);
          const hasAnchor = storedAnchor && storedAnchor.playerId === selectedPlayerId;
          const hasSelectedPlayerCoords = selectedPlayer && (selectedPlayer.centerX !== undefined || selectedPlayer.x !== undefined);
          
          const matchingMethod = hasAnchor ? 'ANCHOR-BASED SPATIAL' : (hasSelectedPlayerCoords ? 'SPATIAL DISTANCE' : 'CONFIDENCE');
          console.log(`🔧 ID-LOCK RECOVERY: Using ${matchingMethod} selection (score=${bestScore.toFixed(3)})`);
          console.log(`🔧 ID-LOCK RECOVERY: Created new tracker for ${selectedPlayerId} using detection with confidence ${bestDetection.confidence.toFixed(3)}`);
          
          // Create new tracker with the selected ID
          const recoveredTracker: TrackedPlayer = {
            id: selectedPlayerId, // Force the selected ID
            centerX: bestDetection.centerX,
            centerY: bestDetection.centerY,
            width: bestDetection.width,
            height: bestDetection.height,
            confidence: bestDetection.confidence * 0.9, // Slightly reduced confidence
            lastSeen: timestamp, // **CRITICAL FIX**: Use correct field name
            lostFrames: 0
          };
          
          // Add recovered tracker and mark detection as matched
          trackedPlayers.push(recoveredTracker);
          matchedTrackers.add(trackedPlayers.length - 1);
          matchedDetections.add(bestDetectionIdx);
          
          // **CANONICAL COORDINATES FIX**: Use anchor topLeft if available (prevents re-normalization)
          const storedAnchorRecovery = anchorStorage.get(videoId);
          const useAnchorTopLeftRecovery = storedAnchorRecovery && storedAnchorRecovery.playerId === selectedPlayerId && 
                                            storedAnchorRecovery.topLeftX !== undefined;
          
          // Add to result
          resultPlayers.push(createPlayerObject(
            selectedPlayerId,
            bestDetection.centerX,
            bestDetection.centerY,
            bestDetection.width,
            bestDetection.height,
            bestDetection.confidence * 0.9,
            useAnchorTopLeftRecovery ? storedAnchorRecovery.topLeftX : undefined,
            useAnchorTopLeftRecovery ? storedAnchorRecovery.topLeftY : undefined
          ));
          
          console.log(`🔧 ID-LOCK RECOVERY: Created new tracker for ${selectedPlayerId} using detection with confidence ${bestDetection.confidence.toFixed(3)}`);
        } else {
          console.log(`🚫 ID-LOCK RECOVERY FAILED: No unmatched detections available for recovery`);
        }
      } else {
        console.log(`🚫 ID-LOCK RECOVERY FAILED: No detections available for recovery`);
      }
    }
  }

  // **PHASE 1 CONTINUED**: Match remaining detections against remaining trackers
  for (let detectIdx = 0; detectIdx < newDetections.length; detectIdx++) {
    if (matchedDetections.has(detectIdx)) continue;
    
    const detection = newDetections[detectIdx];
    let bestMatch = -1;
    let bestDistance = Infinity;
    
    // Search only ORIGINAL trackers (prevent matching newly created ones)
    for (let i = 0; i < originalTrackerCount; i++) {
      if (matchedTrackers.has(i)) continue; // Already matched
      
      const tracker = trackedPlayers[i];
      const gateResult = checkContinuityGates(tracker, detection, timestamp, false);
      
      // Accept detection if it passes continuity gates and is the best so far
      if (gateResult.accepted && gateResult.distance < bestDistance) {
        bestMatch = i;
        bestDistance = gateResult.distance;
      }
    }
    
    if (bestMatch >= 0) {
      // Match found - update existing tracker
      const tracker = trackedPlayers[bestMatch];
      // **COORDINATE SMOOTHING**: Apply EMA filter to reduce jumpiness
      const SMOOTHING_ALPHA = 0.7; // Higher = more responsive, lower = more smooth  
      tracker.centerX = SMOOTHING_ALPHA * detection.centerX + (1 - SMOOTHING_ALPHA) * tracker.centerX;
      tracker.centerY = SMOOTHING_ALPHA * detection.centerY + (1 - SMOOTHING_ALPHA) * tracker.centerY;
      tracker.width = SMOOTHING_ALPHA * detection.width + (1 - SMOOTHING_ALPHA) * tracker.width;
      tracker.height = SMOOTHING_ALPHA * detection.height + (1 - SMOOTHING_ALPHA) * tracker.height;
      tracker.confidence = Math.min(1.0, Math.max(detection.confidence, tracker.confidence + MIN_CONFIDENCE_BOOST));
      tracker.lastSeen = timestamp;
      tracker.lostFrames = 0;
      
      // **COORDINATE FIX**: Ensure x,y represent top-left, not center
      resultPlayers.push(createPlayerObject(
        tracker.id,
        tracker.centerX,
        tracker.centerY,
        tracker.width,
        tracker.height,
        tracker.confidence
      ));
      
      matchedTrackers.add(bestMatch);
      matchedDetections.add(detectIdx);
    }
  }
  
  // **PHASE 2**: Create new trackers for unmatched detections
  for (let detectIdx = 0; detectIdx < newDetections.length; detectIdx++) {
    if (matchedDetections.has(detectIdx)) continue; // Already matched
    
    const detection = newDetections[detectIdx];
    const newPlayerId = `player_${globalPlayerIdCounter++}`;
    const newTracker: TrackedPlayer = {
      id: newPlayerId,
      centerX: detection.centerX,
      centerY: detection.centerY,
      width: detection.width,
      height: detection.height,
      confidence: detection.confidence,
      lastSeen: timestamp,
      lostFrames: 0
    };
    
    trackedPlayers.push(newTracker);
    
    // **COORDINATE FIX**: Ensure x,y represent top-left, not center
    resultPlayers.push(createPlayerObject(
      newPlayerId,
      detection.centerX,
      detection.centerY,
      detection.width,
      detection.height,
      detection.confidence
    ));
  }
  
  // Increment lost frames for unmatched ORIGINAL trackers only
  for (let i = 0; i < originalTrackerCount; i++) {
    if (!matchedTrackers.has(i)) {
      trackedPlayers[i].lostFrames++;
    }
  }
  
  // Update tracking state
  playerTracker.set(videoId, trackedPlayers);
  
  console.log(`🎯 SPATIAL TRACKING: ${resultPlayers.length} players tracked, ${trackedPlayers.length} total in memory`);
  
  return resultPlayers;
}

/**
 * Apply spatial tracking to a detection response (handles both cached and fresh responses)
 * @param response - Detection response object with players array
 * @param videoId - Video identifier for tracking
 * @param timestamp - Current timestamp
 * @returns Modified response with spatial tracking applied
 */
export function applySpatialTrackingToResponse(
  response: any, 
  videoId: string, 
  timestamp: number,
  selectedPlayerId?: string,
  selectedPlayer?: { id: string; x: number; y: number; centerX?: number; centerY?: number } | null
): any {
  if (!response || !response.players || !Array.isArray(response.players)) {
    return response;
  }
  
  console.log(`🔧 APPLYING SPATIAL TRACKING to ${response.players.length} cached/fresh detections`);
  
  // Apply spatial tracking to the players array
  const trackedPlayers = assignConsistentPlayerIDs(response.players, videoId, timestamp, selectedPlayerId, selectedPlayer);
  
  console.log(`🔧 SPATIAL TRACKING COMPLETED, returning ${trackedPlayers.length} tracked players`);
  
  // **OPTION 2 FIX**: Always include selectedPlayer field in response
  // This surfaces the ID-locked or HOLD position explicitly for frontend spotlight rendering
  let selectedPlayerData = null;
  if (selectedPlayerId) {
    // Find the selected player in tracked results (includes both ID-lock success and HOLD positions)
    selectedPlayerData = trackedPlayers.find(p => p.id === selectedPlayerId) || null;
    
    if (selectedPlayerData) {
      console.log(`✅ SELECTED PLAYER FOUND: ${selectedPlayerId} at (${selectedPlayerData.centerX?.toFixed(3)}, ${selectedPlayerData.centerY?.toFixed(3)}) - confidence ${selectedPlayerData.confidence?.toFixed(3)}`);
    } else {
      console.warn(`⚠️ SELECTED PLAYER NOT FOUND: ${selectedPlayerId} not in tracked results`);
    }
  }
  
  // Return response with tracked players AND explicit selectedPlayer field
  return {
    ...response,
    players: trackedPlayers,
    selectedPlayer: selectedPlayerData, // NEW: Explicitly surfaced selected player (ID-lock or HOLD)
    frameAnalysis: {
      ...response.frameAnalysis,
      totalPlayers: trackedPlayers.length
    }
  };
}

/**
 * Get the latest tracked players for a video - used for cache fallback when GPU is overloaded
 * @param videoId - Video identifier
 * @returns Latest tracked players with metadata
 */
export function getLatestTrackedPlayers(videoId: string): {
  players: DetectionPlayer[];
  timestamp: number;
  source: string;
  trackedCount: number;
} {
  const trackedPlayers = playerTracker.get(videoId) || [];
  const currentTime = Date.now() / 1000;
  
  console.log(`📦 CACHE LOOKUP: Found ${trackedPlayers.length} tracked players for videoId=${videoId}`);
  
  // Convert TrackedPlayer[] to DetectionPlayer[] format
  const players: DetectionPlayer[] = trackedPlayers.map(tracker => createPlayerObject(
    tracker.id,
    tracker.centerX,
    tracker.centerY,
    tracker.width,
    tracker.height,
    tracker.confidence
  ));
  
  return {
    players,
    timestamp: currentTime,
    source: 'spatial_tracking_cache',
    trackedCount: trackedPlayers.length
  };
}