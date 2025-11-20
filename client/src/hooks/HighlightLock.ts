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
  
  constructor(
    masterId: string,
    initialDetection: Detection,
    config: Partial<HighlightLockConfig> = {}
  ) {
    this.masterId = masterId;
    this.currentByteTrackId = initialDetection.id;
    this.lastDetectionTime = initialDetection.timestamp || Date.now();
    
    // Default configuration optimized for sports footage
    this.config = {
      maxPredictionTime: 2000,        // 2 seconds
      motionDecayRate: 0.5,           // 50% per second
      velocitySmoothing: 0.3,         // 30% smoothing
      maxAssociationDistance: 0.15,   // 15% of frame width
      minIoUThreshold: 0.1,           // 10% overlap minimum
      hysteresisTime: 300,            // 300ms before ID switches
      tentativeTime: 500,             // 500ms before going lost
      reacquireTime: 2000,            // 2s to attempt reacquisition
      confidenceThreshold: 0.3,       // 30% minimum confidence
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
  update(detections: Detection[], currentTime: number = Date.now()): BoundingBox | null {
    const startTime = performance.now();
    const deltaTime = (currentTime - this.lastDetectionTime) / 1000; // Convert to seconds
    
    try {
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
        this.handleSuccessfulMatch(match, currentTime, deltaTime);
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
   */
  private findBestMatch(detections: Detection[], currentTime: number): Detection | null {
    if (detections.length === 0) return null;
    
    const predicted = this.getPredictedPosition();
    let bestMatch: Detection | null = null;
    let bestScore = -1;
    
    for (const detection of detections) {
      const score = this.calculateMatchScore(detection, predicted);
      
      // Apply hysteresis - prefer current ByteTrack ID
      const isCurrentId = detection.id === this.currentByteTrackId;
      const adjustedScore = isCurrentId ? score * 1.2 : score; // 20% bonus for current ID
      
      if (adjustedScore > bestScore && adjustedScore > 0.3) { // Minimum match threshold
        bestMatch = detection;
        bestScore = adjustedScore;
      }
    }
    
    // Handle potential ID switches with hysteresis
    if (bestMatch && bestMatch.id !== this.currentByteTrackId) {
      return this.handlePotentialIdSwitch(bestMatch, currentTime);
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
  private handleSuccessfulMatch(detection: Detection, currentTime: number, deltaTime: number): void {
    // **ENHANCED COORDINATE SMOOTHING**: Use advanced smoothing system for stable tracking
    const boundingBox = {
      x: detection.x,
      y: detection.y,
      width: detection.width,
      height: detection.height,
      confidence: detection.confidence
    };
    
    // Apply coordinate smoothing to get stable, smooth coordinates
    const smoothedBox = globalCoordinateSmoothing.update(boundingBox, currentTime);
    
    // Extract center coordinates from smoothed bounding box
    const smoothedCenterX = smoothedBox.x + smoothedBox.width / 2;
    const smoothedCenterY = smoothedBox.y + smoothedBox.height / 2;
    
    // Update motion state with Kalman-like filtering using smoothed coordinates
    const smoothing = this.config.velocitySmoothing;
    
    if (deltaTime > 0) {
      const newVelocityX = (smoothedCenterX - this.motionState.centerX) / deltaTime;
      const newVelocityY = (smoothedCenterY - this.motionState.centerY) / deltaTime;
      
      this.motionState.velocityX = (1 - smoothing) * this.motionState.velocityX + smoothing * newVelocityX;
      this.motionState.velocityY = (1 - smoothing) * this.motionState.velocityY + smoothing * newVelocityY;
    }
    
    // Update position and size with enhanced smoothing
    this.motionState.centerX = (1 - smoothing) * this.motionState.centerX + smoothing * smoothedCenterX;
    this.motionState.centerY = (1 - smoothing) * this.motionState.centerY + smoothing * smoothedCenterY;
    this.motionState.width = (1 - smoothing) * this.motionState.width + smoothing * smoothedBox.width;
    this.motionState.height = (1 - smoothing) * this.motionState.height + smoothing * smoothedBox.height;
    this.motionState.confidence = Math.min(1.0, this.motionState.confidence + 0.1); // Increase confidence
    
    // **SMOOTH TRACKING LOG**: Log coordinate smoothing effectiveness
    console.log('🎯 SMOOTH TRACKING UPDATE:', {
      masterId: this.masterId,
      rawDetection: { x: detection.x.toFixed(3), y: detection.y.toFixed(3) },
      smoothedBox: { x: smoothedBox.x.toFixed(3), y: smoothedBox.y.toFixed(3) },
      finalCenter: { x: this.motionState.centerX.toFixed(3), y: this.motionState.centerY.toFixed(3) },
      velocity: { x: this.motionState.velocityX.toFixed(3), y: this.motionState.velocityY.toFixed(3) },
      confidence: this.motionState.confidence.toFixed(3)
    });
    
    // Reset uncertainties
    this.positionUncertainty = Math.max(0.005, this.positionUncertainty * 0.9);
    this.velocityUncertainty = Math.max(0.005, this.velocityUncertainty * 0.9);
    
    this.lastDetectionTime = currentTime;
    this.candidateId = null; // Clear any pending candidate
    
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
      height: this.motionState.height
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
   * **SEAMLESS TRACKING FIX**: Incremental motion prediction for per-frame updates
   * Advances predicted position by incremental deltaTime without triggering missed detection penalties
   */
  public tickPredict(currentTime: number): BoundingBox | null {
    if (this.motionState.confidence < this.config.confidenceThreshold) {
      return null;
    }
    
    // Calculate incremental time since last prediction update
    const lastUpdateTime = this.lastPredictionTime || this.lastDetectionTime;
    let deltaTime = (currentTime - lastUpdateTime) / 1000; // Convert to seconds
    
    // **ARCHITECT FIX**: Clamp deltaTime to prevent stalls and limit max prediction step
    deltaTime = Math.min(Math.max(deltaTime, 0), 0.2); // Max 200ms step to prevent huge jumps
    
    if (deltaTime > 0) {
      // Update predicted position based on velocity (no confidence decay)
      this.motionState.centerX += this.motionState.velocityX * deltaTime;
      this.motionState.centerY += this.motionState.velocityY * deltaTime;
      
      // Clamp to valid bounds
      this.motionState.centerX = Math.max(0, Math.min(1, this.motionState.centerX));
      this.motionState.centerY = Math.max(0, Math.min(1, this.motionState.centerY));
    }
    
    // **CRITICAL FIX**: Always update lastPredictionTime to prevent permanent stalls
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