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

// Global player ID counter - ensures unique IDs that are NEVER reused
let globalPlayerIdCounter = 1;

/**
 * Reset tracking state for a video to prevent ID explosion and stale player accumulation
 * @param videoId - Video identifier to reset (optional - resets all if not provided)
 */
export function resetTrackingState(videoId?: string): void {
  if (videoId) {
    // Reset specific video
    playerTracker.delete(videoId);
    console.log(`🧹 TRACKING RESET: Cleared tracking state for videoId=${videoId}`);
  } else {
    // Reset all tracking state
    playerTracker.clear();
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
  const dt = Math.max(0.001, (timestamp - lastSeen) / 1000); // Convert to seconds, minimum 1ms
  
  // Velocity gating parameters (more lenient to prevent ID explosion)
  const V_MAX = 0.8; // More generous max velocity  
  const EPSILON = 0.05; // Larger tolerance for measurement noise
  const maxAllowedDistance = V_MAX * dt + EPSILON;
  
  // **STICKY TRACKING**: Continuity gates for selected players (much tighter for stability)
  if (isSelected) {
    const DISTANCE_THRESHOLD = 0.08; // **ARCHITECT FIX**: Tightened from 0.25 to prevent jumps
    const MIN_IOU_STRICT = 0.05; // Require meaningful overlap
    const MAX_VELOCITY_SELECTED = 0.5; // **ARCHITECT FIX**: Much stricter velocity cap
    
    // **STICKINESS ENFORCEMENT**: Require BOTH distance AND IoU (not OR)
    const distanceGatePassed = distance <= DISTANCE_THRESHOLD;
    const iouGatePassed = iou >= MIN_IOU_STRICT;
    
    // **STICKY VELOCITY**: Much stricter velocity constraint for selected player
    const velocity = distance / dt;
    const velocityGatePassed = velocity <= MAX_VELOCITY_SELECTED;
    
    // **COMBINED STRICT GATES**: All must pass for selected player to maintain lock
    const accepted = distanceGatePassed && iouGatePassed && velocityGatePassed;
    
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
  selectedPlayerId?: string
): DetectionPlayer[] {
  const MATCH_THRESHOLD = 0.08; // **TIGHTENED**: Stricter distance-based matching
  const MAX_LOST_FRAMES = 30;   // Keep players longer to avoid ID churn
  const MIN_CONFIDENCE_BOOST = 0.05; // Boost confidence for tracked players
  
  // Get or initialize tracking state for this video
  let trackedPlayers = playerTracker.get(videoId) || [];
  
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
    console.log(`🔍 ID-LOCK SEARCH: Looking for selectedPlayerId="${selectedPlayerId}" in ${trackedPlayers.length} tracked players:`, trackedPlayers.map(p => p.id));
    const selectedTrackerIdx = trackedPlayers.findIndex(t => t.id === selectedPlayerId);
    console.log(`🔍 ID-LOCK RESULT: selectedTrackerIdx=${selectedTrackerIdx}, originalTrackerCount=${originalTrackerCount}`);
    if (selectedTrackerIdx >= 0 && selectedTrackerIdx < originalTrackerCount) {
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
        // **COORDINATE SMOOTHING**: Apply EMA filter to reduce jumpiness
        const SMOOTHING_ALPHA = 0.7; // Higher = more responsive, lower = more smooth
        selectedTracker.centerX = SMOOTHING_ALPHA * detection.centerX + (1 - SMOOTHING_ALPHA) * selectedTracker.centerX;
        selectedTracker.centerY = SMOOTHING_ALPHA * detection.centerY + (1 - SMOOTHING_ALPHA) * selectedTracker.centerY;
        selectedTracker.width = SMOOTHING_ALPHA * detection.width + (1 - SMOOTHING_ALPHA) * selectedTracker.width;
        selectedTracker.height = SMOOTHING_ALPHA * detection.height + (1 - SMOOTHING_ALPHA) * selectedTracker.height;
        selectedTracker.confidence = Math.min(1.0, Math.max(detection.confidence, selectedTracker.confidence + MIN_CONFIDENCE_BOOST));
        selectedTracker.lastSeen = timestamp;
        selectedTracker.lostFrames = 0;
        
        resultPlayers.push({
          id: selectedTracker.id,
          centerX: selectedTracker.centerX,
          centerY: selectedTracker.centerY,
          x: selectedTracker.centerX - selectedTracker.width / 2,
          y: selectedTracker.centerY - selectedTracker.height / 2,
          width: selectedTracker.width,
          height: selectedTracker.height,
          confidence: selectedTracker.confidence
        });
        
        matchedTrackers.add(selectedTrackerIdx);
        matchedDetections.add(bestDetectionForSelected);
        console.log(`🔒 ID-LOCK: Preserved selected player ${selectedPlayerId} at distance ${bestDistanceForSelected.toFixed(3)}`);
      } else {
        console.log(`🚫 ID-LOCK FAILED: No detection passed continuity gates for selected player ${selectedPlayerId}`);
        
        // **ARCHITECT FIX**: Do NOT update position if no acceptable match
        // Instead, increment lostFrames and emit last-known position with reduced confidence
        selectedTracker.lostFrames++;
        selectedTracker.confidence = Math.max(0.1, selectedTracker.confidence * 0.9); // Decay confidence
        
        // Emit last-known position (prevents coordinate jumps)
        resultPlayers.push({
          id: selectedTracker.id,
          centerX: selectedTracker.centerX,
          centerY: selectedTracker.centerY,
          x: selectedTracker.centerX - selectedTracker.width / 2,
          y: selectedTracker.centerY - selectedTracker.height / 2,
          width: selectedTracker.width,
          height: selectedTracker.height,
          confidence: selectedTracker.confidence
        });
        
        matchedTrackers.add(selectedTrackerIdx);
        console.log(`🔒 ID-LOCK HOLD: Emitting last-known position for ${selectedPlayerId} (lostFrames=${selectedTracker.lostFrames}, confidence=${selectedTracker.confidence.toFixed(3)})`);
      }
    } else {
      console.log(`🚫 ID-LOCK FAILED: Selected player ${selectedPlayerId} not found in tracked players`);
      
      // **ID-LOCK RECOVERY**: Create new tracker with selected ID from best available detection
      if (newDetections.length > 0) {
        // Find best unmatched detection for recovery
        let bestDetection = null;
        let bestDetectionIdx = -1;
        
        for (let detectIdx = 0; detectIdx < newDetections.length; detectIdx++) {
          if (matchedDetections.has(detectIdx)) continue;
          
          const detection = newDetections[detectIdx];
          if (!bestDetection || detection.confidence > bestDetection.confidence) {
            bestDetection = detection;
            bestDetectionIdx = detectIdx;
          }
        }
        
        if (bestDetection && bestDetectionIdx >= 0) {
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
          
          // Add to result
          resultPlayers.push({
            id: selectedPlayerId,
            centerX: bestDetection.centerX,
            centerY: bestDetection.centerY,
            x: bestDetection.centerX - bestDetection.width / 2,
            y: bestDetection.centerY - bestDetection.height / 2,
            width: bestDetection.width,
            height: bestDetection.height,
            confidence: bestDetection.confidence * 0.9
          });
          
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
      resultPlayers.push({
        id: tracker.id,
        centerX: tracker.centerX,
        centerY: tracker.centerY,
        x: tracker.centerX - tracker.width / 2,  // Top-left X
        y: tracker.centerY - tracker.height / 2, // Top-left Y
        width: tracker.width,
        height: tracker.height,
        confidence: tracker.confidence
      });
      
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
    resultPlayers.push({
      id: newPlayerId,
      centerX: detection.centerX,
      centerY: detection.centerY,
      x: detection.centerX - detection.width / 2,  // Top-left X
      y: detection.centerY - detection.height / 2, // Top-left Y
      width: detection.width,
      height: detection.height,
      confidence: detection.confidence
    });
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
  selectedPlayerId?: string
): any {
  if (!response || !response.players || !Array.isArray(response.players)) {
    return response;
  }
  
  console.log(`🔧 APPLYING SPATIAL TRACKING to ${response.players.length} cached/fresh detections`);
  
  // Apply spatial tracking to the players array
  const trackedPlayers = assignConsistentPlayerIDs(response.players, videoId, timestamp, selectedPlayerId);
  
  console.log(`🔧 SPATIAL TRACKING COMPLETED, returning ${trackedPlayers.length} tracked players`);
  
  // Return response with tracked players
  return {
    ...response,
    players: trackedPlayers,
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
  const players: DetectionPlayer[] = trackedPlayers.map(tracker => ({
    id: tracker.id,
    centerX: tracker.centerX,
    centerY: tracker.centerY,
    x: tracker.centerX - tracker.width / 2,  // Top-left X
    y: tracker.centerY - tracker.height / 2, // Top-left Y
    width: tracker.width,
    height: tracker.height,
    confidence: tracker.confidence
  }));
  
  return {
    players,
    timestamp: currentTime,
    source: 'spatial_tracking_cache',
    trackedCount: trackedPlayers.length
  };
}