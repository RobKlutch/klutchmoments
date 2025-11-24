/**
 * HighlightLock: Production-grade player tracking system
 * 
 * Solves the spotlight stickiness problem by maintaining persistent 
 * highlight locks that survive ByteTrack ID volatility, detection gaps,
 * and player crossings through intelligent motion prediction and 
 * re-association logic.
 */

import { 
  highlightLockLogger, 
  logStateTransition, 
  logDetectionProcessing, 
  logSystemHealth, 
  logError, 
  logRecovery 
} from './HighlightLockLogger';
import { globalCoordinateSmoothing } from '@/utils/coordinateSmoothing';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX?: number;
  centerY?: number;
}

export interface Detection {
  id: string;
  centerX: number;
  centerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  timestamp?: number;
}

export interface MotionState {
  centerX: number;
  centerY: number;
  velocityX: number;
  velocityY: number;
  width: number;
  height: number;
  confidence: number;
}

export type LockState = 'active' | 'tentative' | 'lost' | 'reacquiring';

export interface HighlightLockConfig {
  // Motion prediction
  maxPredictionTime: number;      // Max time to predict without detections (ms)
  motionDecayRate: number;        // Confidence decay per second
  velocitySmoothing: number;      // Kalman filter smoothing factor
  
  // Re-association thresholds
  maxAssociationDistance: number; // Max center-to-center distance for re-association
  minIoUThreshold: number;        // Minimum IoU overlap for re-association
  hysteresisTime: number;         // Time before allowing ID switches (ms)
  
  // State management
  tentativeTime: number;          // Time before going from tentative to lost (ms)
  reacquireTime: number;          // Max time to attempt reacquisition (ms)
  confidenceThreshold: number;    // Minimum confidence to maintain lock
}

export class HighlightLock {
  private masterId: string;
  private state: LockState = 'active';
  private motionState: MotionState;
  private lastDetectionTime: number = 0;
  private lastStateChangeTime: number = 0;
  private currentByteTrackId: string | null = null;
  private candidateId: string | null = null;
  private candidateFirstSeen: number = 0;
  private config: HighlightLockConfig;
  
  // Motion prediction (simplified Kalman filter)
  private positionUncertainty: number = 0.01;
  private velocityUncertainty: number = 0.01;
  
  // **ARCHITECT-PRESCRIBED DETECTION HISTORY**: Buffer for smooth interpolation between detections
  private detectionHistory: Array<{ detection: Detection; timestamp: number }> = [];
  
  constructor(
    masterId: string,
    initialDetection: Detection,
    config: Partial<HighlightLockConfig> = {}
  ) {
    this.masterId = masterId;
    this.currentByteTrackId = initialDetection.id;
    // **TIME SYNC FIX**: Require valid video timestamp, no epoch fallback
    this.lastDetectionTime = initialDetection.timestamp || 0;
    
    // Default configuration optimized for sports footage with RESPONSIVE TRACKING
    this.config = {
      maxPredictionTime: 3000,        // 3 seconds (increased from 2s)
      motionDecayRate: 0.3,           // 30% per second (decreased from 50% - slower decay)
      velocitySmoothing: 0.75,        // 75% smoothing (was 0.3 - much more responsive for fast players)
      maxAssociationDistance: 0.25,   // 25% of frame width (increased from 15% - more tolerance)
      minIoUThreshold: 0.05,          // 5% overlap minimum (decreased from 10% - less strict)
      hysteresisTime: 800,            // 800ms before ID switches (increased from 300ms - harder to switch)
      tentativeTime: 1000,            // 1000ms before going lost (increased from 500ms)
      reacquireTime: 3000,            // 3s to attempt reacquisition (increased from 2s)
      confidenceThreshold: 0.2,       // 20% minimum confidence (decreased from 30% - more lenient)
      ...config
    };
    
    // Initialize motion state
    this.motionState = {
      centerX: initialDetection.centerX,
      centerY: initialDetection.centerY,
      velocityX: 0,
      velocityY: 0,
      width: initialDetection.width,
      height: initialDetection.height,
      confidence: initialDetection.confidence
    };
    
    // **COORDINATE SMOOTHING RESET**: Prevent state leakage between sessions
    globalCoordinateSmoothing.reset();
    
    console.log('🔒 HighlightLock CREATED:', {
      masterId: this.masterId,
      initialId: this.currentByteTrackId,
      center: [initialDetection.centerX.toFixed(3), initialDetection.centerY.toFixed(3)],
      state: this.state,
      smoothingReset: true
    });
    
    // **PRODUCTION LOGGING**: Log system initialization
    highlightLockLogger.log('info', 'HighlightLock', 'SYSTEM_INITIALIZED', {
      masterId: this.masterId,
      initialByteTrackId: this.currentByteTrackId,
      initialPosition: { x: initialDetection.centerX, y: initialDetection.centerY },
      config: this.config,
      timestamp: Date.now()
    });
  }
  
  /**
   * Update the lock with new detections
   * Returns the best tracking box for rendering
   */
  update(detections: Detection[], currentTime: number): BoundingBox | null {
    // **TIME SYNC FIX**: Reject invalid timestamps to prevent epoch/video time mixing
    // Allow 0 (video start), reject undefined, null, NaN, or negative values
    if (currentTime === undefined || currentTime === null || Number.isNaN(currentTime) || currentTime < 0) {
      console.error('❌ HighlightLock.update(): Invalid timestamp - must be video time in ms', currentTime);
      return null; // Cannot update with invalid timestamp
    }
    
    const startTime = performance.now();
    const deltaTime = (currentTime - this.lastDetectionTime) / 1000; // Convert to seconds
    
    try {
      // **CRITICAL FIX**: Store position BEFORE prediction for accurate velocity calculation
      const positionBeforePrediction = {
        centerX: this.motionState.centerX,
        centerY: this.motionState.centerY
      };
      
      // Update motion prediction
      this.updateMotionPrediction(deltaTime);
      
      // Try to find the best matching detection
      const match = this.findBestMatch(detections, currentTime);
      const matchResults = {
        hasMatch: !!match,
        bestScore: match ? this.calculateMatchScore(match, this.getPredictedPosition()) : 0,
        candidateSwitch: this.candidateId !== null,
        hysteresisActive: this.candidateId !== null,
        detectionCount: detections.length
      };
      
      if (match) {
        this.handleSuccessfulMatch(match, currentTime, deltaTime, positionBeforePrediction);
      } else {
        this.handleMissedDetection(currentTime);
      }
      
      const processingTime = performance.now() - startTime;
      const result = this.getCurrentBoundingBox();
      
      // **PRODUCTION LOGGING**: Log detection processing performance
      logDetectionProcessing(detections.length, processingTime, matchResults);
      
      // **PRODUCTION LOGGING**: Log system health periodically
      if (Math.random() < 0.1) { // 10% sampling rate
        logSystemHealth({
          lockState: this.state,
          confidence: this.motionState.confidence,
          detectionGaps: deltaTime > 0.1 ? 1 : 0,
          lastUpdateAge: currentTime - this.lastDetectionTime,
          errorCount: 0, // Would track actual errors
          recoveryCount: 0 // Would track recovery attempts
        });
      }
      
      return result;
      
    } catch (error) {
      // **PRODUCTION LOGGING**: Log errors with full context
      logError(error as Error, {
        masterId: this.masterId,
        detectionCount: detections.length,
        currentState: this.state,
        deltaTime,
        confidence: this.motionState.confidence
      });
      
      // Return last known position on error
      return this.getCurrentBoundingBox();
    }
  }
  
  /**
   * Find the best matching detection using IoU and motion consistency
   * **SPATIAL MATCHING**: Use IoU and distance instead of strict ID matching (ByteTrack IDs are unstable!)
   */
  private findBestMatch(detections: Detection[], currentTime: number): Detection | null {
    if (detections.length === 0) return null;
    
    // **CRITICAL FIX v2.1**: Prioritize exact ID match FIRST (server uses ID-locked tracking)
    // The server's spatial tracking preserves IDs, so player_37 stays player_37
    const exactIdMatch = detections.find(d => d.id === this.masterId);
    if (exactIdMatch) {
      console.log(`✅ EXACT ID MATCH: detectionId="${exactIdMatch.id}" matches masterId="${this.masterId}"`, {
        center: [exactIdMatch.centerX.toFixed(3), exactIdMatch.centerY.toFixed(3)],
        confidence: exactIdMatch.confidence.toFixed(2)
      });
      
      // Update tracking ID if needed
      if (exactIdMatch.id !== this.currentByteTrackId) {
        console.log(`🔄 ID UPDATE: ${this.currentByteTrackId} → ${exactIdMatch.id} (exact match)`);
        this.currentByteTrackId = exactIdMatch.id;
        this.candidateId = null;
      }
      
      return exactIdMatch;
    }
    
    // **FALLBACK**: Use spatial matching if no exact ID match
    console.log(`⚠️ No exact ID match for masterId="${this.masterId}", falling back to spatial matching`);
    const predicted = this.getPredictedPosition();
    let bestMatch: Detection | null = null;
    let bestScore = -1;
    
    for (const detection of detections) {
      const score = this.calculateMatchScore(detection, predicted);
      
      if (score > bestScore && score > 0.2) {
        bestMatch = detection;
        bestScore = score;
      }
    }
    
    if (bestMatch) {
      console.log(`🎯 SPATIAL MATCH FOUND: detectionId="${bestMatch.id}", score=${bestScore.toFixed(3)}, center=[${bestMatch.centerX.toFixed(3)}, ${bestMatch.centerY.toFixed(3)}]`);
      
      // Update current tracking ID to the matched detection
      if (bestMatch.id !== this.currentByteTrackId) {
        console.log(`🔄 ID UPDATE: ${this.currentByteTrackId} → ${bestMatch.id} (spatial match)`);
        this.currentByteTrackId = bestMatch.id;
        this.candidateId = null;
      }
    } else {
      console.warn(`⚠️ NO SPATIAL MATCH: ${detections.length} detections available, best score was ${bestScore.toFixed(3)}`);
    }
    
    return bestMatch;
  }
  
  /**
   * Calculate match score combining IoU overlap and motion consistency
   */
  private calculateMatchScore(detection: Detection, predicted: MotionState): number {
    // IoU calculation
    const iou = this.calculateIoU(
      { x: detection.x, y: detection.y, width: detection.width, height: detection.height },
      { x: predicted.centerX - predicted.width/2, y: predicted.centerY - predicted.height/2, 
        width: predicted.width, height: predicted.height }
    );
    
    // Distance penalty
    const centerDistance = Math.sqrt(
      Math.pow(detection.centerX - predicted.centerX, 2) + 
      Math.pow(detection.centerY - predicted.centerY, 2)
    );
    const maxDistance = this.config.maxAssociationDistance;
    const distanceScore = Math.max(0, 1 - (centerDistance / maxDistance));
    
    // Size consistency
    const sizeRatio = Math.min(detection.width / predicted.width, predicted.width / detection.width) *
                     Math.min(detection.height / predicted.height, predicted.height / detection.height);
    
    // Combined score with weights
    return (iou * 0.4) + (distanceScore * 0.4) + (sizeRatio * 0.1) + (detection.confidence * 0.1);
  }
  
  /**
   * Handle potential ByteTrack ID switches with hysteresis
   */
  private handlePotentialIdSwitch(newDetection: Detection, currentTime: number): Detection | null {
    const timeSinceLastChange = currentTime - this.lastStateChangeTime;
    
    if (this.candidateId === newDetection.id) {
      // Same candidate - check if enough time has passed
      const candidateAge = currentTime - this.candidateFirstSeen;
      if (candidateAge >= this.config.hysteresisTime) {
        console.log('🔄 HighlightLock ID SWITCH APPROVED:', {
          masterId: this.masterId,
          oldId: this.currentByteTrackId,
          newId: newDetection.id,
          candidateAge,
          hysteresisTime: this.config.hysteresisTime
        });
        
        this.currentByteTrackId = newDetection.id;
        this.candidateId = null;
        this.lastStateChangeTime = currentTime;
        return newDetection;
      }
    } else {
      // New candidate - start tracking it
      this.candidateId = newDetection.id;
      this.candidateFirstSeen = currentTime;
      
      console.log('🤔 HighlightLock NEW CANDIDATE:', {
        masterId: this.masterId,
        currentId: this.currentByteTrackId,
        candidateId: this.candidateId,
        needsHysteresis: this.config.hysteresisTime
      });
    }
    
    // For now, reject the switch and keep using prediction
    return null;
  }
  
  /**
   * Handle successful detection match
   */
  private handleSuccessfulMatch(
    detection: Detection, 
    currentTime: number, 
    deltaTime: number,
    positionBeforePrediction: { centerX: number; centerY: number }
  ): void {
    console.log(`✅ HANDLE SUCCESSFUL MATCH: detectionId="${detection.id}", masterId="${this.masterId}", deltaTime=${deltaTime.toFixed(3)}s`);
    
    // **DIAGNOSTIC LOGGING**: Compare backend centerX vs recalculated centerX
    const backendCenterX = detection.centerX;
    const backendCenterY = detection.centerY;
    const recalculatedCenterX = detection.x + detection.width / 2;
    const recalculatedCenterY = detection.y + detection.height / 2;
    
    console.log('🔬 COORDINATE COMPARISON:', {
      detectionId: detection.id,
      backendCenter: { x: backendCenterX?.toFixed(4), y: backendCenterY?.toFixed(4) },
      recalculatedCenter: { x: recalculatedCenterX.toFixed(4), y: recalculatedCenterY.toFixed(4) },
      topLeft: { x: detection.x.toFixed(4), y: detection.y.toFixed(4) },
      dimensions: { width: detection.width.toFixed(4), height: detection.height.toFixed(4) },
      delta: { 
        x: backendCenterX ? (backendCenterX - recalculatedCenterX).toFixed(6) : 'N/A',
        y: backendCenterY ? (backendCenterY - recalculatedCenterY).toFixed(6) : 'N/A'
      }
    });
    
    // **FINAL FIX**: Use backend-provided center coordinates exclusively (1:1 backend tracking)
    // If backend provides centerX/centerY, trust them completely. Otherwise fallback to calculation.
    const detectionCenterX = detection.centerX !== undefined ? detection.centerX : (detection.x + detection.width / 2);
    const detectionCenterY = detection.centerY !== undefined ? detection.centerY : (detection.y + detection.height / 2);
    
    // **SINGLE SMOOTHING LAYER**: Apply EMA smoothing only (removed globalCoordinateSmoothing)
    const smoothing = this.config.velocitySmoothing;
    
    if (deltaTime > 0) {
      // Calculate velocity from raw detection position
      const positionDelta = {
        x: detectionCenterX - positionBeforePrediction.centerX,
        y: detectionCenterY - positionBeforePrediction.centerY
      };
      
      const newVelocityX = positionDelta.x / deltaTime;
      const newVelocityY = positionDelta.y / deltaTime;
      
      const oldVelocityX = this.motionState.velocityX;
      const oldVelocityY = this.motionState.velocityY;
      
      this.motionState.velocityX = (1 - smoothing) * this.motionState.velocityX + smoothing * newVelocityX;
      this.motionState.velocityY = (1 - smoothing) * this.motionState.velocityY + smoothing * newVelocityY;
      
      console.log(`📐 VELOCITY CALC: delta=[${positionDelta.x.toFixed(5)}, ${positionDelta.y.toFixed(5)}], deltaTime=${deltaTime.toFixed(3)}s, newVel=[${newVelocityX.toFixed(5)}, ${newVelocityY.toFixed(5)}], smoothing=${smoothing}, oldVel=[${oldVelocityX.toFixed(5)}, ${oldVelocityY.toFixed(5)}], finalVel=[${this.motionState.velocityX.toFixed(5)}, ${this.motionState.velocityY.toFixed(5)}]`);
    }
    
    // Update position and size with EMA smoothing (ONLY layer)
    this.motionState.centerX = (1 - smoothing) * this.motionState.centerX + smoothing * detectionCenterX;
    this.motionState.centerY = (1 - smoothing) * this.motionState.centerY + smoothing * detectionCenterY;
    this.motionState.width = (1 - smoothing) * this.motionState.width + smoothing * detection.width;
    this.motionState.height = (1 - smoothing) * this.motionState.height + smoothing * detection.height;
    // **CRITICAL FIX**: FULLY restore confidence when fresh detection arrives (was only +0.1)
    this.motionState.confidence = Math.max(0.8, detection.confidence); // Use detection confidence (min 0.8)
    
    // **SMOOTH TRACKING LOG**: Log single-layer smoothing effectiveness
    console.log('🎯 SMOOTH TRACKING UPDATE (SINGLE LAYER):', {
      masterId: this.masterId,
      rawDetection: { x: detection.x.toFixed(3), y: detection.y.toFixed(3), centerX: detectionCenterX.toFixed(3), centerY: detectionCenterY.toFixed(3) },
      finalCenter: { x: this.motionState.centerX.toFixed(3), y: this.motionState.centerY.toFixed(3) },
      velocity: { x: this.motionState.velocityX.toFixed(3), y: this.motionState.velocityY.toFixed(3) },
      confidence: this.motionState.confidence.toFixed(3)
    });
    
    // Reset uncertainties
    this.positionUncertainty = Math.max(0.005, this.positionUncertainty * 0.9);
    this.velocityUncertainty = Math.max(0.005, this.velocityUncertainty * 0.9);
    
    this.lastDetectionTime = currentTime;
    this.candidateId = null; // Clear any pending candidate
    
    // **ARCHITECT-PRESCRIBED**: Store detection in history for interpolation
    this.detectionHistory.push({ detection, timestamp: currentTime });
    if (this.detectionHistory.length > 4) {
      this.detectionHistory.shift(); // Keep last 4 detections
    }
    
    // Update state
    if (this.state !== 'active') {
      this.state = 'active';
      this.lastStateChangeTime = currentTime;
      
      console.log('✅ HighlightLock REACQUIRED:', {
        masterId: this.masterId,
        byteTrackId: this.currentByteTrackId,
        center: [this.motionState.centerX.toFixed(3), this.motionState.centerY.toFixed(3)],
        confidence: this.motionState.confidence.toFixed(3)
      });
    }
  }
  
  /**
   * Handle missed detection
   */
  private handleMissedDetection(currentTime: number): void {
    console.log(`❌ HANDLE MISSED DETECTION: masterId="${this.masterId}", state="${this.state}"`);
    const timeSinceLastDetection = currentTime - this.lastDetectionTime;
    
    // Decay confidence
    const decayFactor = Math.pow(1 - this.config.motionDecayRate, timeSinceLastDetection / 1000);
    this.motionState.confidence *= decayFactor;
    
    // Increase uncertainties
    this.positionUncertainty = Math.min(0.1, this.positionUncertainty * 1.1);
    this.velocityUncertainty = Math.min(0.1, this.velocityUncertainty * 1.1);
    
    // State transitions based on time
    const currentState = this.state;
    
    if (this.state === 'active' && timeSinceLastDetection >= this.config.tentativeTime) {
      this.state = 'tentative';
      this.lastStateChangeTime = currentTime;
    } else if (this.state === 'tentative' && timeSinceLastDetection >= this.config.tentativeTime * 2) {
      this.state = 'lost';
      this.lastStateChangeTime = currentTime;
    } else if (this.state === 'lost' && timeSinceLastDetection >= this.config.reacquireTime) {
      this.state = 'reacquiring';
      this.lastStateChangeTime = currentTime;
    }
    
    if (currentState !== this.state) {
      console.log('⚠️ HighlightLock STATE CHANGE:', {
        masterId: this.masterId,
        oldState: currentState,
        newState: this.state,
        timeSinceDetection: timeSinceLastDetection,
        confidence: this.motionState.confidence.toFixed(3)
      });
      
      // **PRODUCTION LOGGING**: Log state transitions with full context
      logStateTransition(this.masterId, currentState, this.state, {
        confidence: this.motionState.confidence,
        timeSinceLastDetection,
        detectionCount: 0, // No detections in missed detection scenario
        byteTrackId: this.currentByteTrackId,
        position: { x: this.motionState.centerX, y: this.motionState.centerY },
        uncertainties: { position: this.positionUncertainty, velocity: this.velocityUncertainty }
      });
    }
  }
  
  /**
   * Update motion prediction using simple physics
   */
  private updateMotionPrediction(deltaTime: number): void {
    if (deltaTime <= 0) return;
    
    // Update predicted position based on velocity
    this.motionState.centerX += this.motionState.velocityX * deltaTime;
    this.motionState.centerY += this.motionState.velocityY * deltaTime;
    
    // Clamp to valid bounds
    this.motionState.centerX = Math.max(0, Math.min(1, this.motionState.centerX));
    this.motionState.centerY = Math.max(0, Math.min(1, this.motionState.centerY));
  }
  
  /**
   * Get predicted position for current time
   */
  private getPredictedPosition(): MotionState {
    return { ...this.motionState };
  }
  
  /**
   * Get current bounding box for rendering
   * **CRITICAL TRUE CENTER FIX**: MUST include centerX/centerY for accurate spotlight rendering
   */
  private getCurrentBoundingBox(): BoundingBox | null {
    if (this.motionState.confidence < this.config.confidenceThreshold) {
      return null;
    }
    
    const halfWidth = this.motionState.width / 2;
    const halfHeight = this.motionState.height / 2;
    
    return {
      x: Math.max(0, Math.min(1 - this.motionState.width, this.motionState.centerX - halfWidth)),
      y: Math.max(0, Math.min(1 - this.motionState.height, this.motionState.centerY - halfHeight)),
      width: this.motionState.width,
      height: this.motionState.height,
      centerX: this.motionState.centerX,
      centerY: this.motionState.centerY
    };
  }
  
  /**
   * Get tracking snapshot with player ID for spotlight rendering
   * Public accessor for current tracking state
   */
  public getTrackingSnapshot(): { box: BoundingBox & { id: string }; id: string; confidence: number; state: LockState } | null {
    const box = this.getCurrentBoundingBox();
    if (!box) {
      return null;
    }
    
    return {
      box: { ...box, id: this.masterId },
      id: this.masterId,
      confidence: this.motionState.confidence,
      state: this.state
    };
  }
  
  /**
   * Calculate Intersection over Union (IoU) between two bounding boxes
   */
  private calculateIoU(box1: BoundingBox, box2: BoundingBox): number {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
    
    if (x2 <= x1 || y2 <= y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;
    
    return union > 0 ? intersection / union : 0;
  }
  
  /**
   * **ARCHITECT-PRESCRIBED INTERPOLATION**: Smooth 60fps tracking using detection history
   * Uses velocity-based interpolation between detections for tight, smooth player following
   */
  public tickPredict(currentTime: number): BoundingBox | null {
    if (this.motionState.confidence < this.config.confidenceThreshold) {
      return null;
    }
    
    // **CASE 1: Use interpolation if we have recent detection history**
    if (this.detectionHistory.length >= 2) {
      const latest = this.detectionHistory[this.detectionHistory.length - 1];
      const previous = this.detectionHistory[this.detectionHistory.length - 2];
      
      const timeSinceLatest = currentTime - latest.timestamp;
      const detectionInterval = latest.timestamp - previous.timestamp;
      
      // **INTERPOLATION WINDOW**: Use velocity-based extrapolation for up to 200ms
      if (timeSinceLatest <= 200 && detectionInterval > 0) {
        // Calculate velocity from last two detections
        const latestCenter = {
          x: latest.detection.x + latest.detection.width / 2,
          y: latest.detection.y + latest.detection.height / 2
        };
        const previousCenter = {
          x: previous.detection.x + previous.detection.width / 2,
          y: previous.detection.y + previous.detection.height / 2
        };
        
        const velocityX = (latestCenter.x - previousCenter.x) / detectionInterval;
        const velocityY = (latestCenter.y - previousCenter.y) / detectionInterval;
        
        // Apply velocity cap (2.5 screen units/second = 0.0025 per ms)
        const maxVelocity = 0.0025;
        const cappedVelX = Math.max(-maxVelocity, Math.min(maxVelocity, velocityX));
        const cappedVelY = Math.max(-maxVelocity, Math.min(maxVelocity, velocityY));
        
        // Extrapolate position
        const predictedX = latestCenter.x + cappedVelX * timeSinceLatest;
        const predictedY = latestCenter.y + cappedVelY * timeSinceLatest;
        
        // Apply easing to reduce confidence in prediction over time
        const easeFactor = Math.min(timeSinceLatest / 200, 1.0);
        const easeWeight = 1 - easeFactor * 0.3;
        
        const finalX = predictedX * easeWeight + latestCenter.x * (1 - easeWeight);
        const finalY = predictedY * easeWeight + latestCenter.y * (1 - easeWeight);
        
        // Update motion state with interpolated position
        this.motionState.centerX = Math.max(0, Math.min(1, finalX));
        this.motionState.centerY = Math.max(0, Math.min(1, finalY));
        
        this.lastPredictionTime = currentTime;
        return this.getCurrentBoundingBox();
      }
    }
    
    // **CASE 2: Fallback to velocity-based prediction (original logic)**
    const lastUpdateTime = this.lastPredictionTime || this.lastDetectionTime;
    let deltaTime = (currentTime - lastUpdateTime) / 1000;
    deltaTime = Math.min(Math.max(deltaTime, 0), 0.2);
    
    if (deltaTime > 0) {
      this.motionState.centerX += this.motionState.velocityX * deltaTime;
      this.motionState.centerY += this.motionState.velocityY * deltaTime;
      
      this.motionState.centerX = Math.max(0, Math.min(1, this.motionState.centerX));
      this.motionState.centerY = Math.max(0, Math.min(1, this.motionState.centerY));
    }
    
    this.lastPredictionTime = currentTime;
    return this.getCurrentBoundingBox();
  }
  
  /**
   * **ARCHITECT FIX**: Reset prediction timebase on video controls to prevent drift
   */
  public resetPredictionTimebase(): void {
    this.lastPredictionTime = Date.now();
  }
  
  // **ARCHITECT FIX**: Add tracking for incremental predictions
  private lastPredictionTime: number = 0;

  // Public getters
  get id(): string { return this.masterId; }
  get currentState(): LockState { return this.state; }
  get confidence(): number { return this.motionState.confidence; }
  get byteTrackId(): string | null { return this.currentByteTrackId; }
  get isActive(): boolean { return this.state === 'active' || this.state === 'tentative'; }
  get position(): { x: number; y: number } { 
    return { x: this.motionState.centerX, y: this.motionState.centerY }; 
  }
}