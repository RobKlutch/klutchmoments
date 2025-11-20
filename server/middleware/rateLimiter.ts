import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { applySpatialTrackingToResponse, getLatestTrackedPlayers } from '../utils/spatialTracking';

// **RATE LIMITING INTERFACES**
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds  
  maxRequests: number; // Max requests per window
  maxConcurrent: number; // Max concurrent processing per user
}

interface UserRateLimit {
  count: number;
  resetTime: number;
  concurrent: number;
  lastRequest: number;
}

interface GlobalState {
  concurrent: number;
  totalRequests: number;
  resetTime: number;
}

// **CIRCUIT BREAKER** for graceful degradation
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  nextAttempt: number;
}

// **RESPONSE CACHING** to prevent duplicate processing
interface CacheEntry {
  response: any;
  timestamp: number;
  hash: string;
}

class DetectionRateLimiter {
  private userLimits = new Map<string, UserRateLimit>();
  private globalState: GlobalState = { 
    concurrent: 0, 
    totalRequests: 0, 
    resetTime: Date.now() + 60000 
  };
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    state: 'closed',
    nextAttempt: 0
  };
  private responseCache = new Map<string, CacheEntry>();
  private cleanupInterval: NodeJS.Timeout;
  
  private readonly config: RateLimitConfig = {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 600, // INCREASED: 600 requests per user per minute (~10Hz) for smooth tracking
    maxConcurrent: 3, // OPTIMIZED: Increased for real-time tracking responsiveness
  };
  
  private readonly globalConfig = {
    maxRequestsPerMinute: 800, // INCREASED: Higher limit for video tracking (13Hz)
    maxConcurrentGlobal: 5, // OPTIMIZED: Increased for better throughput
    circuitBreakerThreshold: 15, // INCREASED: More tolerance for video tracking workload
    circuitBreakerTimeout: 10000, // OPTIMIZED: Faster recovery (10s for responsive tracking)
    cacheTimeout: 300000 // INCREASED: 5 minute cache timeout for better reuse
  };

  constructor() {
    // Clean up expired entries every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30000);
  }

  // **FRAME HASH GENERATION** for cache deduplication
  private generateFrameHash(imageData: string, timestamp: number): string {
    // Validate imageData parameter
    if (!imageData || typeof imageData !== 'string') {
      console.warn('generateFrameHash called with invalid imageData:', typeof imageData);
      // Use timestamp only for hash when imageData is invalid
      const roundedTimestamp = Math.floor(timestamp * 10) / 10; // 0.1s precision for real-time tracking
      return createHash('md5').update(`fallback:${roundedTimestamp}`).digest('hex');
    }
    
    // **CRITICAL FIX**: Ultra-high precision timing for real-time tracking
    // Create hash from image data (first 1000 chars) + rounded timestamp (50ms precision for 6-10Hz tracking)
    const roundedTimestamp = Math.floor(timestamp * 20) / 20; // 0.05s (50ms) precision for 6-10Hz tracking
    const imagePrefix = imageData.substring(0, 1000);
    return createHash('md5').update(`${imagePrefix}:${roundedTimestamp}`).digest('hex');
  }

  // **CACHE CHECK** - Return cached response if available
  private checkCache(frameHash: string): any | null {
    const cached = this.responseCache.get(frameHash);
    // **CRITICAL FIX**: Ultra-short cache timeout for real-time tracking (120ms for 6-10Hz support)
    const cacheTimeout = Math.min(this.globalConfig.cacheTimeout, 120); // Max 120ms cache for 6-10Hz real-time tracking
    if (cached && Date.now() - cached.timestamp < cacheTimeout) {
      console.log(`🔄 CACHE HIT: Returning cached detection result (age: ${Date.now() - cached.timestamp}ms)`);
      return cached.response;
    }
    if (cached) {
      console.log(`♻️ CACHE EXPIRED: Removing stale cache entry (age: ${Date.now() - cached.timestamp}ms)`);
      this.responseCache.delete(frameHash); // Remove expired cache
    }
    return null;
  }

  // **CACHE STORE** - Store successful detection response
  private storeCache(frameHash: string, response: any): void {
    // Only cache successful responses
    if (response && response.success) {
      this.responseCache.set(frameHash, {
        response,
        timestamp: Date.now(),
        hash: frameHash
      });
      
      // Limit cache size (keep most recent 100 entries)
      if (this.responseCache.size > 100) {
        const oldestKey = Array.from(this.responseCache.keys())[0];
        this.responseCache.delete(oldestKey);
      }
    }
  }

  // **CIRCUIT BREAKER CHECK** - Prevent requests when system is failing
  private checkCircuitBreaker(): { allowed: boolean; reason?: string } {
    const now = Date.now();
    
    switch (this.circuitBreaker.state) {
      case 'open':
        if (now >= this.circuitBreaker.nextAttempt) {
          this.circuitBreaker.state = 'half-open';
          return { allowed: true };
        }
        return { 
          allowed: false, 
          reason: `Circuit breaker open. Retry in ${Math.ceil((this.circuitBreaker.nextAttempt - now) / 1000)}s` 
        };
        
      case 'half-open':
      case 'closed':
        return { allowed: true };
        
      default:
        return { allowed: true };
    }
  }

  // **CIRCUIT BREAKER UPDATE** - Track success/failure
  private updateCircuitBreaker(success: boolean): void {
    if (success) {
      // Reset failures on success
      if (this.circuitBreaker.state === 'half-open') {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failures = 0;
      }
    } else {
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailure = Date.now();
      
      if (this.circuitBreaker.failures >= this.globalConfig.circuitBreakerThreshold) {
        this.circuitBreaker.state = 'open';
        this.circuitBreaker.nextAttempt = Date.now() + this.globalConfig.circuitBreakerTimeout;
        console.warn(`🔥 Circuit breaker opened after ${this.circuitBreaker.failures} failures`);
      }
    }
  }

  // **RATE LIMIT CHECK** for user and global limits
  private checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number; reason?: string } {
    const now = Date.now();
    
    // Check global rate limit (reset every minute)
    if (now >= this.globalState.resetTime) {
      this.globalState.totalRequests = 0;
      this.globalState.resetTime = now + 60000;
    }
    
    if (this.globalState.totalRequests >= this.globalConfig.maxRequestsPerMinute) {
      const retryAfter = Math.ceil((this.globalState.resetTime - now) / 1000);
      return { 
        allowed: false, 
        retryAfter,
        reason: "Global rate limit exceeded" 
      };
    }
    
    // Check user rate limit
    let userLimit = this.userLimits.get(userId);
    if (!userLimit || now >= userLimit.resetTime) {
      userLimit = {
        count: 0,
        resetTime: now + this.config.windowMs,
        concurrent: 0,
        lastRequest: now
      };
      this.userLimits.set(userId, userLimit);
    }
    
    if (userLimit.count >= this.config.maxRequests) {
      const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000);
      return { 
        allowed: false, 
        retryAfter,
        reason: "User rate limit exceeded" 
      };
    }
    
    return { allowed: true };
  }

  // **CONCURRENCY CHECK** for processing limits
  private checkConcurrency(userId: string): { allowed: boolean; reason?: string } {
    // Check global concurrency
    if (this.globalState.concurrent >= this.globalConfig.maxConcurrentGlobal) {
      return { 
        allowed: false, 
        reason: "Maximum concurrent detections in progress globally" 
      };
    }
    
    // Check per-user concurrency
    const userLimit = this.userLimits.get(userId);
    if (userLimit && userLimit.concurrent >= this.config.maxConcurrent) {
      return { 
        allowed: false, 
        reason: "Maximum concurrent detections for this user" 
      };
    }
    
    return { allowed: true };
  }

  // **INCREMENT COUNTERS** when request starts processing
  private incrementCounters(userId: string): void {
    // Increment global counters
    this.globalState.totalRequests++;
    this.globalState.concurrent++;
    
    // Increment user counters
    let userLimit = this.userLimits.get(userId)!;
    userLimit.count++;
    userLimit.concurrent++;
    userLimit.lastRequest = Date.now();
  }

  // **DECREMENT COUNTERS** when request completes
  private decrementCounters(userId: string): void {
    // Decrement global concurrent
    this.globalState.concurrent = Math.max(0, this.globalState.concurrent - 1);
    
    // Decrement user concurrent
    const userLimit = this.userLimits.get(userId);
    if (userLimit) {
      userLimit.concurrent = Math.max(0, userLimit.concurrent - 1);
    }
  }

  // **CLEANUP** expired entries
  private cleanup(): void {
    const now = Date.now();
    
    // Clean expired user limits
    for (const [userId, limit] of Array.from(this.userLimits.entries())) {
      // Remove if window expired AND no concurrent requests
      if (now >= limit.resetTime && limit.concurrent === 0) {
        this.userLimits.delete(userId);
      }
    }
    
    // Clean expired cache entries
    for (const [hash, entry] of Array.from(this.responseCache.entries())) {
      if (now - entry.timestamp > this.globalConfig.cacheTimeout) {
        this.responseCache.delete(hash);
      }
    }
  }

  // **RESPONSE INTERCEPTOR** - Track completion and cache results
  private interceptResponse(res: Response, frameHash: string, userId: string): void {
    const originalJson = res.json.bind(res);
    const rateLimiterInstance = this;
    
    // **CRITICAL FIX**: Track completion to avoid double-decrement
    let requestCompleted = false;
    
    const decrementOnce = () => {
      if (!requestCompleted) {
        rateLimiterInstance.decrementCounters(userId);
        requestCompleted = true;
      }
    };
    
    res.json = function(body: any) {
      try {
        // Track success/failure for circuit breaker
        const success = res.statusCode < 400;
        rateLimiterInstance.updateCircuitBreaker(success);
        
        // Cache successful responses
        if (success) {
          rateLimiterInstance.storeCache(frameHash, body);
        }
        
        return originalJson(body);
      } finally {
        // Decrement counters when response completes normally
        decrementOnce();
      }
    };

    // Handle errors/early exits
    res.on('close', () => {
      decrementOnce();
    });

    res.on('error', () => {
      decrementOnce();
      rateLimiterInstance.updateCircuitBreaker(false);
    });
  }

  // **MAIN MIDDLEWARE** - Express middleware entry point
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Only apply to authenticated requests
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const userId = req.user.id;
      
      try {
        // **STEP 1**: Check circuit breaker
        const circuitCheck = this.checkCircuitBreaker();
        if (!circuitCheck.allowed) {
          // **ARCHITECT FIX**: Dynamic retry-after based on actual circuit breaker recovery time
          const retryAfter = Math.max(1, Math.ceil((this.circuitBreaker.nextAttempt - Date.now()) / 1000));
          res.set('Retry-After', retryAfter.toString());
          return res.status(503).json({
            error: "Service temporarily unavailable",
            reason: circuitCheck.reason,
            retryAfter: retryAfter
          });
        }
        
        // **STEP 2**: Generate frame hash for caching (only if body has image data)
        let frameHash = '';
        let cachedResponse = null;
        
        if (req.body && req.body.imageDataUrl && req.body.timestampMs) {
          const { imageDataUrl, timestampMs } = req.body;
          
          try {
            // Additional validation for imageDataUrl
            if (typeof imageDataUrl === 'string' && imageDataUrl.length > 0 && 
                typeof timestampMs === 'number' && timestampMs > 0) {
              frameHash = this.generateFrameHash(imageDataUrl, timestampMs / 1000);
              
              // **STEP 3**: Check cache first
              cachedResponse = this.checkCache(frameHash);
              if (cachedResponse) {
                // Apply spatial tracking to cached response (with selected player ID for locking)
                const videoId = req.body.videoId || 'tracking-video';
                const timestamp = timestampMs / 1000;
                const selectedPlayerId = req.body.selectedPlayerId;
                const trackedResponse = applySpatialTrackingToResponse(cachedResponse, videoId, timestamp, selectedPlayerId);
                
                return res.json({
                  ...trackedResponse,
                  cached: true,
                  cacheHit: true
                });
              }
            }
          } catch (error) {
            console.warn('Error generating frame hash, proceeding without cache:', error);
            // Continue without caching if hash generation fails
            frameHash = '';
          }
        }
        
        // **STEP 4**: Check rate limits
        const rateLimitCheck = this.checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
          if (rateLimitCheck.retryAfter) {
            res.set('Retry-After', rateLimitCheck.retryAfter.toString());
          }
          return res.status(429).json({
            error: "Rate limit exceeded",
            reason: rateLimitCheck.reason,
            retryAfter: rateLimitCheck.retryAfter
          });
        }
        
        // **STEP 5**: Check concurrency limits
        const concurrencyCheck = this.checkConcurrency(userId);
        if (!concurrencyCheck.allowed) {
          console.log(`🔥 Service overloaded - YOLOv8 model needs recovery. Backing off for 10000ms (attempt 1/3)`);
          
          // **ARCHITECT FIX**: Return cached tracking data instead of 503 error
          try {
            const videoId = req.body?.videoId || 'tracking-video';
            const currentTime = Date.now() / 1000;
            const selectedPlayerId = req.body?.selectedPlayerId;
            
            console.log(`📦 OVERLOAD FALLBACK: Attempting to serve cached data for videoId=${videoId}`);
            const cacheResult = getLatestTrackedPlayers(videoId);
            
            if (cacheResult.players.length > 0) {
              // Apply spatial tracking to cached data with selected player ID for locking
              const fallbackResponse = {
                success: true,
                timestamp: currentTime,
                frameAnalysis: {
                  totalPlayers: cacheResult.trackedCount
                },
                players: cacheResult.players,
                fallbackMode: true,
                source: 'overload_cache_fallback',
                processingTime: 0
              };
              
              const trackedResponse = applySpatialTrackingToResponse(fallbackResponse, videoId, currentTime, selectedPlayerId);
              
              console.log(`✅ OVERLOAD FALLBACK: Serving ${cacheResult.players.length} cached players instead of 503`);
              return res.json({
                ...trackedResponse,
                overloadFallback: true
              });
            }
          } catch (fallbackError) {
            console.error("Overload fallback error:", fallbackError);
          }
          
          // If no cached data available, fall back to traditional 503 response
          res.set('Retry-After', '10');
          return res.status(503).json({
            error: "Service overloaded",
            reason: concurrencyCheck.reason,
            retryAfter: 10
          });
        }
        
        // **STEP 6**: All checks passed - increment counters and process request
        this.incrementCounters(userId);
        
        // **STEP 7**: Set up response interceptor for cleanup and caching
        this.interceptResponse(res, frameHash, userId);
        
        // **STEP 8**: Continue to actual detection processing via next()
        next();
        
      } catch (error) {
        console.error('Rate limiter error:', error);
        this.updateCircuitBreaker(false);
        return res.status(500).json({ error: "Rate limiting system error" });
      }
    };
  }

  // **SHUTDOWN CLEANUP** - Clean up interval on shutdown
  public shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  // **DEBUG INFO** - Get current state for monitoring
  public getDebugInfo() {
    return {
      globalState: this.globalState,
      circuitBreaker: this.circuitBreaker,
      userCount: this.userLimits.size,
      cacheSize: this.responseCache.size,
      config: this.config,
      globalConfig: this.globalConfig
    };
  }
}

// Export singleton instance
export const detectionRateLimiter = new DetectionRateLimiter();
export default detectionRateLimiter.middleware();

// Export for potential graceful shutdown
export const shutdownRateLimiter = () => detectionRateLimiter.shutdown();