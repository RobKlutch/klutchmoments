/**
 * Coordinate Smoothing System
 * 
 * Provides smooth, stable player tracking using Kalman filtering and velocity capping
 * to eliminate jumpy movements and coordinate instability regardless of detection frequency.
 */

interface Point2D {
  x: number;
  y: number;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

interface TrackingState {
  position: Point2D;
  velocity: Point2D;
  size: { width: number; height: number };
  confidence: number;
  lastUpdateTime: number;
  predictedPosition: Point2D;
}

export class CoordinateSmoothing {
  private state: TrackingState | null = null;
  private readonly maxVelocity = 1.5; // Maximum movement per second (increased for sports - fast players)
  private readonly dampingFactor = 0.98; // Minimal damping (was 0.85 - too much slowdown)
  private readonly positionSmoothing = 0.7; // High responsiveness for fast-moving sports (was 0.15 - too sticky)
  private readonly velocitySmoothing = 0.6; // Quick velocity response (was 0.25 - too slow)
  private readonly confidenceThreshold = 0.2; // Minimum confidence to accept detection
  
  /**
   * Update tracking with new detection
   */
  update(detection: BoundingBox, timestamp: number): BoundingBox {
    const center = {
      x: detection.x + detection.width / 2,
      y: detection.y + detection.height / 2
    };
    
    if (!this.state) {
      // Initialize tracking state
      this.state = {
        position: center,
        velocity: { x: 0, y: 0 },
        size: { width: detection.width, height: detection.height },
        confidence: detection.confidence || 1.0,
        lastUpdateTime: timestamp,
        predictedPosition: center
      };
      
      return this.getBoundingBox();
    }
    
    const deltaTime = (timestamp - this.state.lastUpdateTime) / 1000; // Convert to seconds
    
    // Skip if time delta is too small or too large (prevents instability)
    if (deltaTime < 0.016 || deltaTime > 1.0) {
      return this.getBoundingBox();
    }
    
    // Calculate velocity from position change
    const rawVelocity = {
      x: (center.x - this.state.position.x) / deltaTime,
      y: (center.y - this.state.position.y) / deltaTime
    };
    
    // Apply velocity capping to prevent jumpy movement
    const cappedVelocity = this.capVelocity(rawVelocity);
    
    // Smooth velocity using EMA
    this.state.velocity = {
      x: this.state.velocity.x * (1 - this.velocitySmoothing) + cappedVelocity.x * this.velocitySmoothing,
      y: this.state.velocity.y * (1 - this.velocitySmoothing) + cappedVelocity.y * this.velocitySmoothing
    };
    
    // Apply velocity damping
    this.state.velocity.x *= this.dampingFactor;
    this.state.velocity.y *= this.dampingFactor;
    
    // Calculate expected position based on velocity
    const expectedPosition = {
      x: this.state.position.x + this.state.velocity.x * deltaTime,
      y: this.state.position.y + this.state.velocity.y * deltaTime
    };
    
    // Smooth position using EMA between expected and detected positions
    const detectionConfidence = Math.max(detection.confidence || 0, this.confidenceThreshold);
    const trustFactor = Math.min(detectionConfidence, 1.0) * this.positionSmoothing;
    
    this.state.position = {
      x: expectedPosition.x * (1 - trustFactor) + center.x * trustFactor,
      y: expectedPosition.y * (1 - trustFactor) + center.y * trustFactor
    };
    
    // Smooth size changes
    this.state.size = {
      width: this.state.size.width * 0.8 + detection.width * 0.2,
      height: this.state.size.height * 0.8 + detection.height * 0.2
    };
    
    // Update confidence and timestamp
    this.state.confidence = Math.max(this.state.confidence * 0.9, detectionConfidence);
    this.state.lastUpdateTime = timestamp;
    
    return this.getBoundingBox();
  }
  
  /**
   * Predict position for current timestamp (for smooth interpolation)
   */
  predict(timestamp: number): BoundingBox | null {
    if (!this.state) return null;
    
    const deltaTime = (timestamp - this.state.lastUpdateTime) / 1000;
    
    // Don't predict too far into the future
    if (deltaTime > 0.5) {
      return this.getBoundingBox();
    }
    
    // Predict position based on current velocity
    this.state.predictedPosition = {
      x: this.state.position.x + this.state.velocity.x * deltaTime,
      y: this.state.position.y + this.state.velocity.y * deltaTime
    };
    
    return {
      x: this.state.predictedPosition.x - this.state.size.width / 2,
      y: this.state.predictedPosition.y - this.state.size.height / 2,
      width: this.state.size.width,
      height: this.state.size.height,
      confidence: this.state.confidence * Math.exp(-deltaTime) // Decay confidence over time
    };
  }
  
  /**
   * Get current bounding box
   */
  private getBoundingBox(): BoundingBox {
    if (!this.state) {
      throw new Error('Tracking state not initialized');
    }
    
    return {
      x: this.state.position.x - this.state.size.width / 2,
      y: this.state.position.y - this.state.size.height / 2,
      width: this.state.size.width,
      height: this.state.size.height,
      confidence: this.state.confidence
    };
  }
  
  /**
   * Cap velocity to prevent jumpy movement
   */
  private capVelocity(velocity: Point2D): Point2D {
    const magnitude = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    
    if (magnitude > this.maxVelocity) {
      const scale = this.maxVelocity / magnitude;
      return {
        x: velocity.x * scale,
        y: velocity.y * scale
      };
    }
    
    return velocity;
  }
  
  /**
   * Reset tracking state
   */
  reset(): void {
    this.state = null;
  }
  
  /**
   * Get tracking status
   */
  getStatus(): { isTracking: boolean; confidence: number; velocity: number } {
    if (!this.state) {
      return { isTracking: false, confidence: 0, velocity: 0 };
    }
    
    const velocity = Math.sqrt(
      this.state.velocity.x * this.state.velocity.x + 
      this.state.velocity.y * this.state.velocity.y
    );
    
    return {
      isTracking: this.state.confidence > this.confidenceThreshold,
      confidence: this.state.confidence,
      velocity
    };
  }
}

/**
 * Global coordinate smoothing instance for consistent tracking
 */
export const globalCoordinateSmoothing = new CoordinateSmoothing();