/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🚨 CRITICAL: NO COORDINATE FLIPPING ALLOWED 🚨
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This hook manages spotlight tracking coordinates through the complete pipeline:
 * Backend → HighlightLock → currentBoxState → SpotlightOverlay
 * 
 * COORDINATE SYSTEM (NEVER CHANGE THIS):
 * - Origin (0,0) is TOP-LEFT corner
 * - X increases LEFT → RIGHT (never flip)
 * - Y increases TOP → BOTTOM
 * 
 * CRITICAL: When updating currentBoxState from HighlightLock results,
 * **ALWAYS** preserve centerX and centerY fields:
 * 
 * ✅ CORRECT:
 * const newBox = {
 *   x: updatedBox.x,
 *   y: updatedBox.y,
 *   width: updatedBox.width,
 *   height: updatedBox.height,
 *   centerX: updatedBox.centerX,  // MUST preserve!
 *   centerY: updatedBox.centerY   // MUST preserve!
 * };
 * 
 * ❌ WRONG (causes spotlight on wrong side):
 * const newBox = {
 *   x: updatedBox.x,
 *   y: updatedBox.y,
 *   width: updatedBox.width,
 *   height: updatedBox.height
 *   // centerX/centerY MISSING = bug!
 * };
 * 
 * See coordinateGuards.ts for full documentation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { HighlightLock, type Detection, type BoundingBox as HighlightBoundingBox } from './HighlightLock';
import { safeGet, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';
import { assertCenterCoordinatesPresent, validateNoFlip } from '@/utils/coordinateGuards';

// **TRACKING TYPES**: Player detection and tracking interfaces
export interface DetectedPlayer {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  description: string;
  // Canonical coordinates with explicit semantics
  centerX?: number;
  centerY?: number;
  topLeftX?: number;
  topLeftY?: number;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX?: number; // **CRITICAL**: True center coordinates from detection
  centerY?: number; // **CRITICAL**: True center coordinates from detection
  id?: string; // **ID-LOCKED TRACKING SUPPORT**
}

// Normalized detection with guaranteed canonical coordinates
interface NormalizedDetectedPlayer extends DetectedPlayer {
  centerX: number;
  centerY: number;
  topLeftX: number;
  topLeftY: number;
}

interface TrackedPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/**
 * **ARCHITECT PRESCRIBED CANONICAL SOLUTION**: 
 * Canonicalize detection coordinates to ensure consistent semantics.
 * 
 * This function handles:
 * - Mixed coordinate formats (pixel vs normalized, center vs top-left)
 * - Auto-detection of coordinate system based on values
 * - Explicit centerX/centerY and topLeftX/topLeftY output
 * - Runtime bounds validation and logging
 */
function normalizeDetections(
  detections: DetectedPlayer[], 
  frameWidth?: number, 
  frameHeight?: number
): NormalizedDetectedPlayer[] {
  return detections.map(player => {
    // Ensure all coordinates are numeric and valid
    const x = Number(player.x) || 0;
    const y = Number(player.y) || 0;
    const width = Number(player.width) || 0.1;
    const height = Number(player.height) || 0.1;
    
    let centerX: number, centerY: number, topLeftX: number, topLeftY: number;
    
    // **COORDINATE DETECTION LOGIC**: Auto-detect coordinate system
    const hasExplicitCenter = typeof player.centerX === 'number' && typeof player.centerY === 'number';
    const hasExplicitTopLeft = typeof player.topLeftX === 'number' && typeof player.topLeftY === 'number';
    
    // **FIX**: Prioritize explicit topLeft/center when BOTH are provided (don't recalculate)
    if (hasExplicitTopLeft && hasExplicitCenter) {
      // Use both explicitly - don't recalculate either
      topLeftX = Number(player.topLeftX);
      topLeftY = Number(player.topLeftY);
      centerX = Number(player.centerX);
      centerY = Number(player.centerY);
    } else if (hasExplicitTopLeft) {
      // Use explicit top-left coordinates if provided
      topLeftX = Number(player.topLeftX);
      topLeftY = Number(player.topLeftY);
      centerX = topLeftX + width / 2;
      centerY = topLeftY + height / 2;
    } else if (hasExplicitCenter) {
      // Use explicit center coordinates if provided
      centerX = Number(player.centerX);
      centerY = Number(player.centerY);
      topLeftX = centerX - width / 2;
      topLeftY = centerY - height / 2;
    } else {
      // **CRITICAL FIX**: Auto-detect coordinate format from x,y values
      const isPixelFormat = frameWidth && frameHeight && 
                           (x > 1 || y > 1 || width > 1 || height > 1);
      
      if (isPixelFormat) {
        // Convert pixel coordinates to normalized
        const normX = x / frameWidth!;
        const normY = y / frameHeight!;
        const normW = width / frameWidth!;
        const normH = height / frameHeight!;
        
        // **YOLOv8 FORMAT**: x,y are top-left in pixel coordinates
        topLeftX = normX;
        topLeftY = normY;
        centerX = topLeftX + normW / 2;
        centerY = topLeftY + normH / 2;
        
        // Production: Pixel to normalized conversion completed
      } else {
        // **FIXED: ALWAYS TREAT AS TOP-LEFT COORDINATES**
        // Server returns normalized top-left format - removed unstable heuristic that caused jumps
        topLeftX = x;
        topLeftY = y;
        centerX = topLeftX + width / 2;
        centerY = topLeftY + height / 2;
      }
    }
    
    // **BOUNDS VALIDATION**: Clamp coordinates to [0,1] range
    centerX = Math.max(0, Math.min(1, centerX));
    centerY = Math.max(0, Math.min(1, centerY));
    topLeftX = Math.max(0, Math.min(1 - width, topLeftX));
    topLeftY = Math.max(0, Math.min(1 - height, topLeftY));
    
    // **RUNTIME VERIFICATION**: Edge detection validation completed
    // Production: Edge case logging disabled for performance
    
    // **CRITICAL FIX**: For pixel format, use normalized dimensions
    const finalWidth = (frameWidth && frameHeight && 
                       (x > 1 || y > 1 || width > 1 || height > 1)) 
                      ? width / frameWidth : width;
    const finalHeight = (frameWidth && frameHeight && 
                        (x > 1 || y > 1 || width > 1 || height > 1)) 
                       ? height / frameHeight : height;

    return {
      ...player,
      x: topLeftX, // Use normalized top-left x
      y: topLeftY, // Use normalized top-left y  
      width: Number(finalWidth),   // Use normalized width
      height: Number(finalHeight), // Use normalized height
      centerX: Number(centerX),
      centerY: Number(centerY),
      topLeftX: Number(topLeftX),
      topLeftY: Number(topLeftY)
    } as NormalizedDetectedPlayer;
  });
}

// **CRITICAL FIX**: Utility function to clamp bounding box coordinates within [0,1] bounds
// Prevents negative coordinates that cause off-screen spotlight positioning
function clampBox(centerX: number, centerY: number, width: number, height: number): BoundingBox {
  // Convert center coordinates to top-left, ensuring they don't go negative
  let x = centerX - width / 2;
  let y = centerY - height / 2;
  
  // Clamp top-left coordinates to ensure box stays within [0,1] bounds
  x = Math.min(Math.max(0, x), 1 - width);
  y = Math.min(Math.max(0, y), 1 - height);
  
  // **CRITICAL**: Recalculate center coordinates after clamping to maintain accuracy
  const finalCenterX = x + width / 2;
  const finalCenterY = y + height / 2;
  
  return { x, y, width, height, centerX: finalCenterX, centerY: finalCenterY };
}

// **CRITICAL FIX**: Reduced default box sizes to prevent edge violations
const DEFAULT_BOX_WIDTH = 0.06;
const DEFAULT_BOX_HEIGHT = 0.14;
const DEFAULT_CENTER_X = 0.5; // Center of screen
const DEFAULT_CENTER_Y = 0.5; // Center of screen

// **ENHANCED TRACKER**: Advanced tracking with confidence-based fallbacks
class Tracker {
  private static readonly SMOOTH_ALPHA = 0.25; // Base smoothing factor
  private static readonly LOW_CONFIDENCE_ALPHA = 0.15; // Stronger smoothing for low confidence
  private static readonly HIGH_CONFIDENCE_ALPHA = 0.35; // Less smoothing for high confidence
  private static readonly MAX_LOST_FRAMES = 60; // Increased tolerance (~20s at 3fps)
  private static readonly MIN_MATCH_SCORE = 0.30; // Balanced threshold for tracking
  private static readonly CONFIDENCE_THRESHOLD = 0.6; // Below this triggers fallback mode
  private static readonly STABILITY_HISTORY_SIZE = 10; // Track stability over N frames
  
  private lastBox: BoundingBox | null = null;
  private lastVelocity: { x: number; y: number } = { x: 0, y: 0 };
  private lostFrames = 0;
  private lastUpdateTime = 0;
  private selectionAnchor: { x: number; y: number } | null = null;
  private selectedPlayerId: string | null = null; // **ID-LOCKED TRACKING**
  
  // **NEW: Enhanced tracking state**
  private confidence = 1.0; // Current detection confidence
  private stabilityHistory: number[] = []; // Recent stability scores
  private manualOverrideActive = false;
  private lastDetectionConfidence = 1.0;
  private smoothingHistory: { position: BoundingBox; confidence: number; timestamp: number }[] = [];

  constructor(private debug = false) {} // Disable debug mode for performance

  // Calculate Intersection over Union (IoU) for two bounding boxes
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

  // Calculate normalized center distance between two boxes
  private calculateCenterDistance(box1: BoundingBox, box2: BoundingBox): number {
    const center1 = {
      x: box1.x + box1.width / 2,
      y: box1.y + box1.height / 2
    };
    const center2 = {
      x: box2.x + box2.width / 2,
      y: box2.y + box2.height / 2
    };
    
    const distance = Math.sqrt(
      Math.pow(center1.x - center2.x, 2) + Math.pow(center1.y - center2.y, 2)
    );
    
    // Normalize by diagonal length (max possible distance is sqrt(2))
    return Math.min(distance / Math.sqrt(2), 1);
  }

  // Calculate size difference between two boxes
  private calculateSizeDelta(box1: BoundingBox, box2: BoundingBox): number {
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    
    if (area1 === 0 && area2 === 0) return 0;
    if (area1 === 0 || area2 === 0) return 1;
    
    const ratio = Math.min(area1, area2) / Math.max(area1, area2);
    return 1 - ratio;
  }

  // **ARCHITECT PRESCRIBED FIX**: Score candidate detection with ID-locked priority
  private scorePlayer(candidateBox: BoundingBox): number {
    // **CRITICAL ID-LOCKED BONUS**: Give massive priority to matching player ID
    if (this.selectedPlayerId && candidateBox.id === this.selectedPlayerId) {
      return 10.0; // **GUARANTEE ID-LOCKED PLAYER WINS**
    }
    // **CRITICAL FIX**: When no lastBox, use selectionAnchor for scoring instead of returning 1.0 for all
    if (!this.lastBox) {
      if (this.selectionAnchor) {
        // Score by distance to selection anchor (prefer closer players)
        const candidateCenter = {
          x: candidateBox.x + candidateBox.width / 2,
          y: candidateBox.y + candidateBox.height / 2
        };
        
        const distance = Math.sqrt(
          Math.pow(candidateCenter.x - this.selectionAnchor.x, 2) + 
          Math.pow(candidateCenter.y - this.selectionAnchor.y, 2)
        );
        
        // Normalize distance and invert (closer = higher score)
        const normalizedDistance = Math.min(distance / Math.sqrt(2), 1);
        const score = 1.0 - normalizedDistance;
        
        // Debug: Anchor scoring completed
        
        return score;
      } else {
        // **CRITICAL FIX**: Return 0.0 to prevent first-frame bias when no anchor exists
        // Debug: No anchor available
        return 0.0;
      }
    }
    
    // Regular scoring when we have a lastBox
    const iou = this.calculateIoU(this.lastBox, candidateBox);
    const centerDistance = this.calculateCenterDistance(this.lastBox, candidateBox);
    const sizeDelta = this.calculateSizeDelta(this.lastBox, candidateBox);
    
    // **STICKINESS FIX**: Add strong continuity bonus for previously tracked player
    let score = 0.5 * iou + 0.25 * (1 - centerDistance) + 0.1 * (1 - sizeDelta);
    
    // **CRITICAL**: Add continuity bonus to prevent player switching
    if (this.lastBox) {
      // Give strong bonus to players near our last position (stickiness)
      const continuityBonus = Math.max(0, 0.3 - centerDistance); // Up to 0.3 bonus for close players
      score += 0.2 * continuityBonus; // 20% bonus weight for stickiness
    }
    
    // Debug: Player scoring completed
    
    return score;
  }

  // **CONFIDENCE-BASED SMOOTHING**: Calculate adaptive smoothing factor based on detection confidence
  private getAdaptiveSmoothingAlpha(confidence: number): number {
    if (confidence >= Tracker.CONFIDENCE_THRESHOLD) {
      return Tracker.HIGH_CONFIDENCE_ALPHA; // Less smoothing for high confidence
    } else if (confidence >= 0.3) {
      return Tracker.SMOOTH_ALPHA; // Normal smoothing for medium confidence
    } else {
      return Tracker.LOW_CONFIDENCE_ALPHA; // Heavy smoothing for low confidence
    }
  }

  // **STABILITY TRACKING**: Calculate tracking stability over recent history
  private updateStabilityScore(newConfidence: number): number {
    this.stabilityHistory.push(newConfidence);
    if (this.stabilityHistory.length > Tracker.STABILITY_HISTORY_SIZE) {
      this.stabilityHistory.shift();
    }
    
    if (this.stabilityHistory.length < 3) return 1.0; // Not enough history
    
    // Calculate stability as inverse of variance
    const mean = this.stabilityHistory.reduce((a, b) => a + b, 0) / this.stabilityHistory.length;
    const variance = this.stabilityHistory.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / this.stabilityHistory.length;
    const stability = Math.max(0, 1 - Math.sqrt(variance));
    
    return stability;
  }

  // **HARD ID-LOCK ENFORCEMENT**: Strictly enforce selectedPlayerId tracking
  update(detections: DetectedPlayer[], frameWidth?: number, frameHeight?: number): void {
    const currentTime = performance.now();
    const dt = this.lastUpdateTime > 0 ? (currentTime - this.lastUpdateTime) / 1000 : 0;
    this.lastUpdateTime = currentTime;

    if (detections.length === 0) {
      this.lostFrames++;
      
      // **ID-LOCK FREEZE**: When selectedPlayerId is set, freeze last position for missing IDs
      if (this.selectedPlayerId && this.lastBox && this.lostFrames <= Tracker.MAX_LOST_FRAMES) {
        if (this.debug) {
          console.log(`🔒 ID-LOCK FREEZE: Holding position for missing player ID "${this.selectedPlayerId}" (frame ${this.lostFrames}/${Tracker.MAX_LOST_FRAMES})`);
        }
        // Keep last box frozen - don't update position
        return;
      }
      
      return;
    }

    // **CRITICAL FIX**: Normalize detections to ensure consistent coordinate semantics
    const normalizedDetections = normalizeDetections(detections, frameWidth, frameHeight);
    
    // **CRITICAL FIX**: Preserve player IDs AND centerX/centerY for ID-locked tracking
    const candidateBoxes = normalizedDetections.map(det => ({
      x: det.topLeftX,
      y: det.topLeftY, 
      width: det.width,
      height: det.height,
      centerX: det.centerX, // **CRITICAL**: Preserve true center for accurate rendering
      centerY: det.centerY, // **CRITICAL**: Preserve true center for accurate rendering
      id: det.id // **PRESERVE PLAYER ID FOR TRACKING**
    }));
    
    // Debug: Tracker input normalization completed

    let bestMatch: BoundingBox | null = null;
    let bestScore = 0;
    let bestCenterDist = 1.0;
    
    // **HARD ID-LOCK ASSERTION**: If selectedPlayerId is set, ONLY use that ID's box
    if (this.selectedPlayerId) {
      const idLockedBox = candidateBoxes.find(box => box.id === this.selectedPlayerId);
      
      if (idLockedBox) {
        // **ENFORCE STRICT ID-LOCK**: Use ONLY the box with matching ID
        bestMatch = idLockedBox;
        bestScore = 10.0; // Maximum score for ID-locked player
        bestCenterDist = 0.0; // Perfect match for ID-locked player
        
        if (this.debug) {
          console.log(`🔒 HARD ID-LOCK: Found player "${this.selectedPlayerId}" - using EXCLUSIVELY`, {
            playerBox: {
              x: idLockedBox.x.toFixed(4),
              y: idLockedBox.y.toFixed(4),
              width: idLockedBox.width.toFixed(4),
              height: idLockedBox.height.toFixed(4)
            },
            otherPlayersIgnored: candidateBoxes.length - 1,
            lostFrames: this.lostFrames
          });
        }
      } else {
        // **ID-LOCK MISSING**: Increment lost frames but don't fall back to proximity
        this.lostFrames++;
        
        if (this.debug) {
          console.log(`🔒 ID-LOCK MISSING: Player "${this.selectedPlayerId}" not found in ${candidateBoxes.length} detections`, {
            availableIds: candidateBoxes.map(box => box.id).filter(Boolean),
            lostFrames: this.lostFrames,
            maxLostFrames: Tracker.MAX_LOST_FRAMES,
            willFreezePosition: this.lostFrames <= Tracker.MAX_LOST_FRAMES
          });
        }
        
        // **FREEZE POSITION**: Keep last valid position for missing ID
        if (this.lastBox && this.lostFrames <= Tracker.MAX_LOST_FRAMES) {
          if (this.debug) {
            console.log(`🔒 ID-LOCK FREEZE: Maintaining last position for missing player "${this.selectedPlayerId}"`);
          }
          return; // Keep existing position frozen
        } else {
          // Give up after max lost frames
          if (this.debug) {
            console.log(`🔒 ID-LOCK TIMEOUT: Player "${this.selectedPlayerId}" lost for too long, clearing tracking`);
          }
          this.lastBox = null;
          return;
        }
      }
    } else {
      // **FALLBACK TO PROXIMITY**: Only when no selectedPlayerId is set
      const MIN_MATCH_SCORE = 0.3;
      
      // Use selection anchor if no previous tracking, otherwise use last known position  
      const referenceBox = this.lastBox || (this.selectionAnchor ? {
        x: this.selectionAnchor.x - 0.01,
        y: this.selectionAnchor.y - 0.04,
        width: 0.02,
        height: 0.08
      } : null);
      
      if (!referenceBox) {
        this.lostFrames++;
        if (this.debug) {
          console.log('🚫 No reference box available for proximity tracking');
        }
        return;
      }
      
      for (const box of candidateBoxes) {
        const centerDist = this.calculateCenterDistance(referenceBox, box);
        const proximityGate = this.selectionAnchor && this.lostFrames > 5 ? 1.0 : 0.6;
        
        if (centerDist < proximityGate) {
          const score = this.scorePlayer(box);
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = box;
            bestCenterDist = centerDist;
          }
        }
      }
      
      // Only accept matches that meet minimum score threshold
      if (!bestMatch || bestScore < MIN_MATCH_SCORE) {
        this.lostFrames++;
        if (this.debug) {
          console.log(`🚫 No valid proximity match found (best score: ${bestScore.toFixed(3)})`);
        }
        return;
      }
    }
    
    // Debug: Player tracking evaluation completed

    // **ENHANCED TRACKING**: Accept by score OR proximity with confidence tracking
    if (bestMatch && (bestScore >= Tracker.MIN_MATCH_SCORE || bestCenterDist <= 0.25)) {
      // **NEW: Calculate detection confidence based on match quality**
      this.confidence = Math.min(1.0, bestScore + (1.0 - bestCenterDist));
      this.lastDetectionConfidence = this.confidence;
      
      // **STICKY TRACKING FIX**: Detect perfect server-side ID locks and skip smoothing
      const isPerfectMatch = bestCenterDist < 0.02; // Very close center distance indicates server ID lock
      const isHighConfidence = this.confidence >= 0.95; // High confidence detection
      const isStickyLock = isPerfectMatch || isHighConfidence;
      
      if (isStickyLock) {
        // **NO SMOOTHING**: Perfect server match - trust it completely for sticky tracking
        // Debug: Sticky lock detected (logging disabled for performance)
        
        // **ARCHITECT FIX**: Capture previous box before overwriting for correct velocity computation
        const prevBox = this.lastBox ? { ...this.lastBox } : null;
        this.lastBox = { ...bestMatch };
        
        // Calculate velocity directly without smoothing for perfect matches
        if (prevBox && dt > 0) {
          const oldCenter = {
            x: prevBox.x + prevBox.width / 2,
            y: prevBox.y + prevBox.height / 2
          };
          const newCenter = {
            x: bestMatch.x + bestMatch.width / 2,
            y: bestMatch.y + bestMatch.height / 2
          };
          
          this.lastVelocity = {
            x: (newCenter.x - oldCenter.x) / dt,
            y: (newCenter.y - oldCenter.y) / dt
          };
        }
      } else {
        // **NORMAL SMOOTHING**: Apply adaptive smoothing for uncertain detections
        const smoothingAlpha = this.getAdaptiveSmoothingAlpha(this.confidence);
        // Debug: Applying smoothing (logging disabled for performance)
        
        // Calculate velocity for prediction with adaptive smoothing
        if (this.lastBox && dt > 0) {
          const oldCenter = {
            x: this.lastBox.x + this.lastBox.width / 2,
            y: this.lastBox.y + this.lastBox.height / 2
          };
          const newCenter = {
            x: bestMatch.x + bestMatch.width / 2,
            y: bestMatch.y + bestMatch.height / 2
          };
          
          const newVelocity = {
            x: (newCenter.x - oldCenter.x) / dt,
            y: (newCenter.y - oldCenter.y) / dt
          };
          
          // Apply adaptive EMA smoothing to velocity based on confidence
          const velocityAlpha = smoothingAlpha * 0.8; // Slightly more conservative for velocity
          this.lastVelocity = {
            x: velocityAlpha * newVelocity.x + (1 - velocityAlpha) * this.lastVelocity.x,
            y: velocityAlpha * newVelocity.y + (1 - velocityAlpha) * this.lastVelocity.y
          };
        }

        // Apply adaptive EMA smoothing to position based on confidence
        if (this.lastBox) {
          const smoothedX = smoothingAlpha * bestMatch.x + (1 - smoothingAlpha) * this.lastBox.x;
          const smoothedY = smoothingAlpha * bestMatch.y + (1 - smoothingAlpha) * this.lastBox.y;
          const smoothedWidth = smoothingAlpha * bestMatch.width + (1 - smoothingAlpha) * this.lastBox.width;
          const smoothedHeight = smoothingAlpha * bestMatch.height + (1 - smoothingAlpha) * this.lastBox.height;
          
          // **CRITICAL**: Preserve or compute centerX/centerY
          const smoothedCenterX = bestMatch.centerX !== undefined 
            ? smoothingAlpha * bestMatch.centerX + (1 - smoothingAlpha) * (this.lastBox.centerX || this.lastBox.x + this.lastBox.width / 2)
            : smoothedX + smoothedWidth / 2;
          const smoothedCenterY = bestMatch.centerY !== undefined 
            ? smoothingAlpha * bestMatch.centerY + (1 - smoothingAlpha) * (this.lastBox.centerY || this.lastBox.y + this.lastBox.height / 2)
            : smoothedY + smoothedHeight / 2;
          
          this.lastBox = {
            x: smoothedX,
            y: smoothedY,
            width: smoothedWidth,
            height: smoothedHeight,
            centerX: smoothedCenterX,
            centerY: smoothedCenterY
          };
        } else {
          this.lastBox = { ...bestMatch };
        }
      }

      // **ENHANCED BOUNDS CLAMPING**: Ensure coordinates stay within bounds
      const clampedX = Math.max(0, Math.min(1 - this.lastBox.width, this.lastBox.x));
      const clampedY = Math.max(0, Math.min(1 - this.lastBox.height, this.lastBox.y));
      
      // **CRITICAL FIX**: Clamp centerX/centerY independently if they exist (preserve backend values!)
      // Don't recalculate from topLeft - backend sends TRUE center from Replicate
      const clampedCenterX = this.lastBox.centerX !== undefined 
        ? Math.max(0, Math.min(1, this.lastBox.centerX))
        : clampedX + this.lastBox.width / 2;
      const clampedCenterY = this.lastBox.centerY !== undefined 
        ? Math.max(0, Math.min(1, this.lastBox.centerY))
        : clampedY + this.lastBox.height / 2;
      
      this.lastBox = {
        x: clampedX,
        y: clampedY,
        width: this.lastBox.width,
        height: this.lastBox.height,
        centerX: clampedCenterX,
        centerY: clampedCenterY
      };

      // **TRACKING HISTORY**: Store for smoothing analysis
      this.smoothingHistory.push({
        position: { ...this.lastBox },
        confidence: this.confidence,
        timestamp: currentTime
      });
      if (this.smoothingHistory.length > 5) {
        this.smoothingHistory.shift();
      }

      this.lostFrames = 0;
      this.manualOverrideActive = false; // Clear manual override when detection succeeds
      
      // Debug: Enhanced tracking with confidence and adaptive smoothing
    } else {
      this.lostFrames++;
      // **CONFIDENCE DECAY**: Gradually reduce confidence when detection fails
      this.confidence = Math.max(0.1, this.confidence * 0.95);
      // Debug: Detection failed, confidence decayed
    }
  }

  // **PERFORMANCE FIX**: Enhanced velocity prediction for multi-second detection gaps
  predict(dt: number): void {
    if (!this.lastBox || this.lostFrames === 0 || this.lostFrames > Tracker.MAX_LOST_FRAMES) {
      return;
    }

    // **AGGRESSIVE PREDICTION**: Apply minimal damping for instant sticky tracking
    const centerX = this.lastBox.x + this.lastBox.width / 2;
    const centerY = this.lastBox.y + this.lastBox.height / 2;
    
    // **MINIMAL DAMPING**: Keep velocity strong for instant response to fast movements
    const dampingFactor = Math.exp(-this.lostFrames * 0.01); // Slower decay = more aggressive prediction
    const dampedVelocityX = this.lastVelocity.x * dampingFactor;
    const dampedVelocityY = this.lastVelocity.y * dampingFactor;
    
    let predictedCenterX = centerX + dampedVelocityX * dt;
    let predictedCenterY = centerY + dampedVelocityY * dt;
    
    // **BOUNDARY PREDICTION**: Prevent unrealistic positions by applying soft constraints
    const constrainedCenterX = Math.max(0.05, Math.min(0.95, predictedCenterX));
    const constrainedCenterY = Math.max(0.05, Math.min(0.95, predictedCenterY));
    
    // **WEIGHTED BLENDING**: Blend predicted position with last known position for stability
    const blendWeight = Math.min(this.lostFrames / 30.0, 0.7); // Max 70% original position
    const finalCenterX = (1 - blendWeight) * constrainedCenterX + blendWeight * centerX;
    const finalCenterY = (1 - blendWeight) * constrainedCenterY + blendWeight * centerY;
    
    this.lastBox = {
      x: finalCenterX - this.lastBox.width / 2,
      y: finalCenterY - this.lastBox.height / 2,
      width: this.lastBox.width,
      height: this.lastBox.height,
      centerX: finalCenterX,
      centerY: finalCenterY
    };

    // **CRITICAL FIX**: Final bounds validation to prevent out-of-bounds coordinates
    const clampedX = Math.max(0, Math.min(1 - this.lastBox.width, this.lastBox.x));
    const clampedY = Math.max(0, Math.min(1 - this.lastBox.height, this.lastBox.y));
    this.lastBox = {
      x: clampedX,
      y: clampedY,
      width: this.lastBox.width,
      height: this.lastBox.height,
      centerX: clampedX + this.lastBox.width / 2,
      centerY: clampedY + this.lastBox.height / 2
    };

    // Debug: Enhanced prediction applied
  }

  /**
   * **ARCHITECT-PRESCRIBED INTERPOLATION**: Compute smooth position at 60fps between detections
   * Uses detection history to interpolate position, providing smooth tracking even with infrequent (500ms-1400ms) detections
   */
  getInterpolatedBox(currentTime: number): BoundingBox | null {
    if (!this.lastBox) return null;
    
    // **CASE 1: Not enough history** - return last box
    if (this.smoothingHistory.length < 2) {
      return { ...this.lastBox };
    }
    
    // Get last two detections for interpolation
    const latest = this.smoothingHistory[this.smoothingHistory.length - 1];
    const previous = this.smoothingHistory[this.smoothingHistory.length - 2];
    
    const timeSinceLatest = currentTime - latest.timestamp;
    const detectionInterval = latest.timestamp - previous.timestamp;
    
    // **CASE 2: Current time before latest detection** - return latest
    if (timeSinceLatest < 0) {
      return { ...latest.position };
    }
    
    // **CASE 3: Within 200ms after latest detection** - extrapolate with velocity
    if (timeSinceLatest <= 200 && detectionInterval > 0) {
      // Calculate velocity from last two detections
      const velocityX = (latest.position.x - previous.position.x) / detectionInterval;
      const velocityY = (latest.position.y - previous.position.y) / detectionInterval;
      
      // Extrapolate position (capped by velocity limit)
      const maxVelocity = 2.5 / 1000; // 2.5 screen units per second
      const cappedVelX = Math.max(-maxVelocity, Math.min(maxVelocity, velocityX));
      const cappedVelY = Math.max(-maxVelocity, Math.min(maxVelocity, velocityY));
      
      const predictedX = latest.position.x + cappedVelX * timeSinceLatest;
      const predictedY = latest.position.y + cappedVelY * timeSinceLatest;
      
      // Apply easing to smooth the extrapolation
      const easeFactor = Math.min(timeSinceLatest / 200, 1.0);
      const easeWeight = 1 - easeFactor * 0.3; // Gradually reduce confidence in prediction
      
      const finalX = Math.max(0, Math.min(1 - latest.position.width, predictedX * easeWeight + latest.position.x * (1 - easeWeight)));
      const finalY = Math.max(0, Math.min(1 - latest.position.height, predictedY * easeWeight + latest.position.y * (1 - easeWeight)));
      
      return {
        x: finalX,
        y: finalY,
        width: latest.position.width,
        height: latest.position.height,
        centerX: finalX + latest.position.width / 2,
        centerY: finalY + latest.position.height / 2
      };
    }
    
    // **CASE 4: Beyond 200ms** - hold last position with damping
    // This prevents wild predictions when no new detection arrives
    return { ...latest.position };
  }

  // **ARCHITECT PRESCRIBED**: Seed tracker with user-selected player position
  seed(selectedPosition: { x: number; y: number }, boxSize: { width: number; height: number } = { width: DEFAULT_BOX_WIDTH, height: DEFAULT_BOX_HEIGHT }): void {
    // Store selection anchor for future scoring
    this.selectionAnchor = { x: selectedPosition.x, y: selectedPosition.y };
    
    // Create initial bounding box centered on selection (convert center to top-left)
    const clampedBox = clampBox(selectedPosition.x, selectedPosition.y, boxSize.width, boxSize.height);
    this.lastBox = clampedBox;
    
    // Reset tracking state
    this.lostFrames = 0;
    this.lastVelocity = { x: 0, y: 0 };
    this.lastUpdateTime = performance.now();
    
    // Debug: Tracker seeded with selection position
  }

  // Get current tracked position with feet positioning and size information
  getPosition(): TrackedPosition | null {
    if (!this.lastBox || this.lostFrames > Tracker.MAX_LOST_FRAMES) {
      return null;
    }

    // Return feet position (center X, bottom Y) with player size information
    const centerX = this.lastBox.x + this.lastBox.width / 2;
    const feetY = this.lastBox.y + this.lastBox.height; // Bottom of bounding box
    
    return {
      x: Math.max(0, Math.min(1, centerX)),
      y: Math.max(0, Math.min(1, feetY)),
      width: this.lastBox.width,
      height: this.lastBox.height
    };
  }

  // **ARCHITECT FIX**: Get current bounding box - GUARANTEED NON-NULL
  getBox(): BoundingBox {
    if (!this.lastBox || this.lostFrames > Tracker.MAX_LOST_FRAMES) {
      // **GUARANTEE NON-NULL**: Return default box at center screen
      const defaultBox = clampBox(DEFAULT_CENTER_X, DEFAULT_CENTER_Y, DEFAULT_BOX_WIDTH, DEFAULT_BOX_HEIGHT);
      console.log('📦 Tracker.getBox() returning DEFAULT BOX:', {
        reason: !this.lastBox ? 'no lastBox' : 'lost frames exceeded',
        lostFrames: this.lostFrames,
        maxLostFrames: Tracker.MAX_LOST_FRAMES,
        defaultBox,
        timestamp: Date.now()
      });
      return defaultBox;
    }
    
    // **CRITICAL ID-LOCK ENFORCEMENT**: Assign selectedPlayerId to trackingBox for proper gating
    const trackedBox = { ...this.lastBox };
    if (this.selectedPlayerId) {
      trackedBox.id = this.selectedPlayerId;
      console.log('🔒 ID-LOCK ENFORCED: Assigning selected player ID to tracking box:', {
        trackingBoxId: trackedBox.id,
        selectedPlayerId: this.selectedPlayerId,
        coordinates: { x: trackedBox.x, y: trackedBox.y },
        timestamp: Date.now()
      });
    }
    
    console.log('📦 Tracker.getBox() returning TRACKED BOX:', {
      lastBox: trackedBox,
      lostFrames: this.lostFrames,
      confidence: this.confidence,
      assignedId: trackedBox.id,
      timestamp: Date.now()
    });
    return trackedBox;
  }

  // **PUBLIC GETTER**: Access selected player ID for detection requests
  getSelectedPlayerId(): string | null {
    return this.selectedPlayerId;
  }

  // **ARCHITECT FIX**: Reset tracker state but maintain default box
  reset(): void {
    // **GUARANTEE NON-NULL**: Initialize with default box instead of null
    const defaultBox = clampBox(DEFAULT_CENTER_X, DEFAULT_CENTER_Y, DEFAULT_BOX_WIDTH, DEFAULT_BOX_HEIGHT);
    this.lastBox = defaultBox;
    this.lastVelocity = { x: 0, y: 0 };
    this.lostFrames = 0;
    this.lastUpdateTime = 0;
    // Preserve anchor across playback restarts
    
    console.log('🔄 Tracker: Reset with DEFAULT BOX (preserving selection anchor):', {
      defaultBox,
      hasAnchor: !!this.selectionAnchor,
      timestamp: Date.now()
    });
  }

  // Explicitly clear selection anchor (for user deselect)
  clearAnchor(): void {
    this.selectionAnchor = null;
    if (this.debug) {
      console.log('🗑️ ANCHOR CLEARED: User deselected');
    }
  }

  // Get tracking status
  getStatus(): { isTracking: boolean; lostFrames: number; hasVelocity: boolean } {
    return {
      isTracking: this.lastBox !== null && this.lostFrames <= Tracker.MAX_LOST_FRAMES,
      lostFrames: this.lostFrames,
      hasVelocity: Math.abs(this.lastVelocity.x) > 0.001 || Math.abs(this.lastVelocity.y) > 0.001
    };
  }

  // **NEW: Enhanced status with fallback information**
  getEnhancedStatus(): {
    mode: 'idle' | 'tracking' | 'predicting' | 'manual' | 'lost';
    confidence: number;
    fallbackActive: boolean;
    fallbackReason?: string;
    detectionAge: number;
    trackingStability: number;
    velocityMagnitude: number;
    canManuallyOverride: boolean;
  } {
    const currentTime = performance.now();
    const detectionAge = currentTime - this.lastUpdateTime;
    const velocityMagnitude = Math.sqrt(
      Math.pow(this.lastVelocity.x, 2) + Math.pow(this.lastVelocity.y, 2)
    );
    const trackingStability = this.updateStabilityScore(this.confidence);
    
    let mode: 'idle' | 'tracking' | 'predicting' | 'manual' | 'lost' = 'idle';
    let fallbackActive = false;
    let fallbackReason: string | undefined;
    
    if (!this.lastBox) {
      mode = 'idle';
    } else if (this.manualOverrideActive) {
      mode = 'manual';
      fallbackActive = true;
      fallbackReason = 'manual_override';
    } else if (this.lostFrames > Tracker.MAX_LOST_FRAMES) {
      mode = 'lost';
      fallbackActive = true;
      fallbackReason = 'detection_failed';
    } else if (this.lostFrames > 0) {
      mode = 'predicting';
      fallbackActive = true;
      fallbackReason = 'velocity_extrapolation';
    } else if (this.confidence < Tracker.CONFIDENCE_THRESHOLD) {
      mode = 'tracking';
      fallbackActive = true;
      fallbackReason = 'low_confidence';
    } else {
      mode = 'tracking';
    }
    
    return {
      mode,
      confidence: this.confidence,
      fallbackActive,
      fallbackReason,
      detectionAge,
      trackingStability,
      velocityMagnitude,
      canManuallyOverride: this.lastBox !== null
    };
  }

  // **NEW: Manual override functionality**
  // **NEW: Set selected player ID for ID-locked tracking**
  setSelectedPlayerId(playerId: string | null): void {
    this.selectedPlayerId = playerId;
    console.log(`🎯 ID-LOCKED TRACKING: Selected player ID=${playerId}`);
  }

  setManualOverride(position: { x: number; y: number }): void {
    if (!this.lastBox) {
      // Create new box at manual position if none exists
      this.lastBox = {
        x: position.x - DEFAULT_BOX_WIDTH / 2,
        y: position.y - DEFAULT_BOX_HEIGHT / 2,
        width: DEFAULT_BOX_WIDTH,
        height: DEFAULT_BOX_HEIGHT
      };
    } else {
      // Move existing box to new position (keeping size)
      this.lastBox = {
        x: position.x - this.lastBox.width / 2,
        y: position.y - this.lastBox.height / 2,
        width: this.lastBox.width,
        height: this.lastBox.height
      };
    }
    
    // Clamp to bounds
    this.lastBox = {
      x: Math.max(0, Math.min(1 - this.lastBox.width, this.lastBox.x)),
      y: Math.max(0, Math.min(1 - this.lastBox.height, this.lastBox.y)),
      width: this.lastBox.width,
      height: this.lastBox.height
    };
    
    // Reset tracking state
    this.manualOverrideActive = true;
    this.confidence = 0.8; // Set moderate confidence for manual positioning
    this.lostFrames = 0;
    this.lastVelocity = { x: 0, y: 0 }; // Reset velocity
    this.lastUpdateTime = performance.now();
    
    // Debug: Manual override applied
  }

  // **CRITICAL FIX**: Enter manual mode without position (for triggering manual mode UI)
  enterManualMode(): void {
    this.manualOverrideActive = true;
    console.log('🖱️ Entered manual mode - waiting for user click');
  }

  // **NEW**: Exit manual mode and resume automatic tracking  
  exitManualMode(): void {
    this.manualOverrideActive = false;
    console.log('🤖 Exited manual mode - resuming automatic tracking');
  }
}

// **HELPER FUNCTION**: Find best matching player for selection anchor
function findBestMatchingPlayer(
  players: NormalizedDetectedPlayer[], 
  selectionAnchor: { x: number; y: number }
): NormalizedDetectedPlayer | null {
  if (!players.length || !selectionAnchor) return null;
  
  let bestPlayer: NormalizedDetectedPlayer | null = null;
  let bestScore = 0;
  
  for (const player of players) {
    // Calculate distance from selection anchor to player center
    const playerCenter = {
      x: player.centerX,
      y: player.centerY
    };
    
    const distance = Math.sqrt(
      Math.pow(playerCenter.x - selectionAnchor.x, 2) + 
      Math.pow(playerCenter.y - selectionAnchor.y, 2)
    );
    
    // Normalize distance and invert (closer = higher score)
    const normalizedDistance = Math.min(distance / Math.sqrt(2), 1);
    const score = 1.0 - normalizedDistance;
    
    if (score > bestScore) {
      bestScore = score;
      bestPlayer = player;
    }
  }
  
  return bestScore > 0.1 ? bestPlayer : null; // Minimum threshold
}

// **HOOK INTERFACE**
interface UseSpotlightTrackerOptions {
  effect: string;
  settings: any;
  externalMode?: boolean; // **NEW**: Use external detection feeding instead of internal API calls
  selectedPlayer?: DetectedPlayer | null; // **FIX**: Full player data for proper bbox seeding
  detectionTime?: number; // **FIX**: Specific timestamp for detection requests (from workflow state)
  componentName?: string; // **DEBUG**: Component name for logging
  deferAutoSeek?: boolean; // **ARCHITECT FIX**: Prevent auto-seeks until initial seek is complete
  videoId?: string; // **FIX**: Video ID for cache lookups
}

// **ENHANCED TRACKING STATUS**: Comprehensive tracking state information
export interface TrackingStatus {
  mode: 'idle' | 'tracking' | 'predicting' | 'manual' | 'lost';
  confidence: number; // 0-1, detection confidence
  fallbackActive: boolean;
  fallbackReason?: 'low_confidence' | 'detection_failed' | 'velocity_extrapolation' | 'manual_override';
  detectionAge: number; // milliseconds since last successful detection
  trackingStability: number; // 0-1, how stable the tracking has been recently
  velocityMagnitude: number; // movement speed for UI indicators
  canManuallyOverride: boolean;
}

interface UseSpotlightTrackerReturn {
  currentBox: { x: number; y: number; width: number; height: number; confidence?: number } | null;
  status: 'idle' | 'tracking' | 'lost';
  trackingStatus: TrackingStatus;
  lastDetectionAge: number;
  ingestDetections: (payload: { players: DetectedPlayer[]; frameWidth: number; frameHeight: number; timestampMs: number }) => void;
  manualOverride: (position: { x: number; y: number }) => void;
  enterManualMode: () => void;
  exitManualMode: () => void;
  resetTracking: () => void;
  // **NEW: Video element diagnostic and rebinding functions**
  forceRebindToActiveVideo: () => void;
  autoRebindToActiveVideo: () => void;
  getCurrentVideoInfo: () => any;
  getAllVideoInfo: () => any[];
  // **NEW: Timeline and debugging functions**
  // **PER-FRAME ID LOOKUP**: Real-time player tracking by time
  getBoxByIdAtTime: (selectedPlayerId: string, sampleTime: number) => {
    box: { x: number; y: number; width: number; height: number; id?: string } | null;
    boxTimestamp: number | null;
    timeDelta: number;
    found: boolean;
    reason?: string;
  };
  immediateTimelineDetection: (videoElement: HTMLVideoElement, timelinePosition: number, reason?: string) => Promise<DetectedPlayer[]>;
  debugDataFlowPipeline: (stage: string, data: any) => void;
}

/**
 * **UNIFIED SPOTLIGHT TRACKER HOOK**
 * 
 * This hook provides a complete player tracking solution that:
 * - Schedules detection calls every 800-1500ms
 * - Normalizes all coordinate formats to canonical form
 * - Uses IoU + center distance matching with EMA smoothing
 * - Applies selection anchor bias for consistent player tracking
 * - Handles video seeking, pausing, and multi-second detection gaps
 * 
 * @param videoRef - Reference to the video element
 * @param selectionAnchor - User-selected player position (normalized 0-1)
 * @param options - Effect configuration options
 * @returns Current tracking state with bounding box and status
 */
export function useSpotlightTracker(
  videoRef: RefObject<HTMLVideoElement>,
  selectionAnchor: { x: number; y: number } | null,
  options: UseSpotlightTrackerOptions
): UseSpotlightTrackerReturn {
  // **CACHE BUST v2.1**: Verify code updates are loading
  console.log('🔥🔥🔥 useSpotlightTracker v2.1 INITIALIZED - BUG FIXED 🔥🔥🔥', {
    externalModeValue: options.externalMode,
    componentName: options.componentName,
    hasSelectionAnchor: !!selectionAnchor,
    timestamp: new Date().toISOString()
  });
  
  // **ENHANCED STATE**: Comprehensive tracking state management
  const [status, setStatus] = useState<'idle' | 'tracking' | 'lost'>('idle');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>({
    mode: 'idle',
    confidence: 0,
    fallbackActive: false,
    detectionAge: 0,
    trackingStability: 1.0,
    velocityMagnitude: 0,
    canManuallyOverride: false
  });
  const [lastDetectionAge, setLastDetectionAge] = useState<number>(0);
  // **CRITICAL FIX**: Add reactive state for currentBox to trigger re-renders  
  const [currentBoxState, setCurrentBoxState] = useState<{ x: number; y: number; width: number; height: number; centerX?: number; centerY?: number; id?: string } | null>(null);
  
  // **rVFC REBINDING FIX**: Track active video element in state to trigger event listener rebinding
  const [activeVideoElement, setActiveVideoElement] = useState<HTMLVideoElement | null>(null);

  // **REFS**: Persistent HighlightLock system for intelligent tracking
  const isMountedRef = useRef(true); // **CONCURRENCY GUARD**: Prevent setState after unmount
  const highlightLockRef = useRef<HighlightLock | null>(null);
  const trackerRef = useRef<Tracker | null>(null); // Keep legacy for compatibility during transition
  const detectionSchedulerRef = useRef<NodeJS.Timeout | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);
  const lastUpdateLoopRef = useRef<number | null>(null);
  
  // **rVFC REBINDING FIX**: Global rVFC handle management
  const currentRVFCHandleRef = useRef<number | null>(null);
  const currentRVFCVideoRef = useRef<HTMLVideoElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  
  // **REQUEST MANAGEMENT**: Track current requests for proper cleanup
  const currentRequestRef = useRef<AbortController | null>(null);
  const firstRunRef = useRef<boolean>(true); // Force first detection
  const pendingSelectedIdRef = useRef<string | null>(null); // **RACE-PROOF ID BINDING**

  // **CRITICAL FIX**: Dynamic video element binding refs
  const dynamicVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoValidationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastVideoElementCheckRef = useRef<number>(0);
  const videoElementDetectionRef = useRef<NodeJS.Timeout | null>(null);

  // **DEBUG LOGGING**: Track when currentBox changes
  const prevBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // **FIX INFINITE LOOP**: Track last player selection to prevent repeated detection for SAME player
  const lastPlayerSelectionRef = useRef<string | null>(null);
  
  // **ARCHITECT PRESCRIBED RESILIENCE**: Cache management for fallback during service overload
  const lastSuccessfulBatchRef = useRef<{ 
    players: DetectedPlayer[], 
    timestamp: number, 
    frameWidth: number, 
    frameHeight: number 
  } | null>(null);
  
  // **CONCURRENCY GUARD**: Mount/unmount lifecycle management
  useEffect(() => {
    isMountedRef.current = true;
    console.log('✅ useSpotlightTracker: Component mounted');
    
    return () => {
      isMountedRef.current = false;
      console.log('🛑 useSpotlightTracker: Component unmounted - setState blocked');
    };
  }, []);
  
  // **GUARDED STATE SETTERS**: Prevent setState after unmount
  const safeSetStatus = useCallback((value: 'idle' | 'tracking' | 'lost' | ((prev: 'idle' | 'tracking' | 'lost') => 'idle' | 'tracking' | 'lost')) => {
    if (isMountedRef.current) setStatus(value);
  }, []);
  
  const safeSetTrackingStatus = useCallback((value: TrackingStatus | ((prev: TrackingStatus) => TrackingStatus)) => {
    if (isMountedRef.current) setTrackingStatus(value);
  }, []);
  
  const safeSetLastDetectionAge = useCallback((value: number | ((prev: number) => number)) => {
    if (isMountedRef.current) setLastDetectionAge(value);
  }, []);
  
  const safeSetCurrentBoxState = useCallback((value: ({ x: number; y: number; width: number; height: number; centerX?: number; centerY?: number; id?: string } | null) | ((prev: { x: number; y: number; width: number; height: number; centerX?: number; centerY?: number; id?: string } | null) => { x: number; y: number; width: number; height: number; centerX?: number; centerY?: number; id?: string } | null)) => {
    if (isMountedRef.current) setCurrentBoxState(value);
  }, []);
  
  const safeSetActiveVideoElement = useCallback((value: (HTMLVideoElement | null) | ((prev: HTMLVideoElement | null) => HTMLVideoElement | null)) => {
    if (isMountedRef.current) setActiveVideoElement(value);
  }, []);
  
  // **CRITICAL UI BINDING DEBUG**: Add comprehensive currentBox change tracking
  useEffect(() => {
    if (currentBoxState !== prevBoxRef.current) {
      const prev = prevBoxRef.current;
      console.log('🔄🔄🔄 useSpotlightTracker: currentBox CHANGED 🔄🔄🔄:', {
        componentName: options.componentName || 'UNKNOWN_COMPONENT',
        prevBox: prev ? {
          x: prev.x.toFixed(3),
          y: prev.y.toFixed(3),
          width: prev.width.toFixed(3),
          height: prev.height.toFixed(3)
        } : null,
        newBox: currentBoxState ? {
          x: currentBoxState.x.toFixed(3),
          y: currentBoxState.y.toFixed(3),
          width: currentBoxState.width.toFixed(3),
          height: currentBoxState.height.toFixed(3)
        } : null,
        hasChanged: !!currentBoxState !== !!prev || 
                   (currentBoxState && prev && (
                     Math.abs(currentBoxState.x - prev.x) > 0.001 ||
                     Math.abs(currentBoxState.y - prev.y) > 0.001 ||
                     Math.abs(currentBoxState.width - prev.width) > 0.001 ||
                     Math.abs(currentBoxState.height - prev.height) > 0.001
                   )),
        coordinateDelta: currentBoxState && prev ? {
          deltaX: (currentBoxState.x - prev.x).toFixed(4),
          deltaY: (currentBoxState.y - prev.y).toFixed(4),
          deltaWidth: (currentBoxState.width - prev.width).toFixed(4),
          deltaHeight: (currentBoxState.height - prev.height).toFixed(4)
        } : 'N/A',
        timestamp: Date.now()
      });
      prevBoxRef.current = currentBoxState;
    }
  }, [currentBoxState, options.componentName]);

  // **DETECTION FUNCTION**: Capture frame and call YOLOv8 API
  // **NO DEDUPLICATION** - allow multiple concurrent requests for reliable tracking
  const detectPlayersInFrame = useCallback(async (videoElement: HTMLVideoElement, maxRetries: number = 3): Promise<DetectedPlayer[]> => {
    const detectionStartTime = performance.now();
    
    // **CRITICAL FIX**: Always check for actively playing videos first
    const allVideos = Array.from(document.querySelectorAll('video'));
    const playingVideos = allVideos.filter(v => !v.paused && v.currentTime > 0 && v.readyState >= 2);
    
    // **EMERGENCY VIDEO SELECTION**: Use actively playing video if available and has progressed
    let actualVideoElement = videoElement;
    if (playingVideos.length > 0 && (videoElement.paused || videoElement.currentTime === 0)) {
      console.log('🚨 FRAME TIMING FIX: Using actively playing video with current timestamp:', {
        passedVideo: {
          currentTime: videoElement.currentTime.toFixed(3),
          paused: videoElement.paused,
          src: videoElement.src?.slice(-30) || 'NO_SOURCE'
        },
        playingVideo: {
          currentTime: playingVideos[0].currentTime.toFixed(3),
          paused: playingVideos[0].paused,
          src: playingVideos[0].src?.slice(-30) || 'NO_SOURCE'
        }
      });
      actualVideoElement = playingVideos[0];
    }
    
    console.log('🎯🎯🎯 DETECTION METRICS: Starting detection request 🎯🎯🎯:', {
      timestamp: actualVideoElement.currentTime.toFixed(3),
      componentName: options.componentName || 'UNKNOWN_COMPONENT',
      detectionStartTime: Date.now(),
      videoState: {
        paused: actualVideoElement.paused,
        readyState: actualVideoElement.readyState,
        videoWidth: actualVideoElement.videoWidth,
        videoHeight: actualVideoElement.videoHeight
      },
      videoSelectionFix: actualVideoElement !== videoElement
    });
    
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    // **REQUEST TRACKING**: Create abort controller for cancellation
    const abortController = new AbortController();
    currentRequestRef.current = abortController;
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement('canvas');
        }
        
        const canvas = offscreenCanvasRef.current;
        const ctx = canvas.getContext('2d')!;
        
        // **CRITICAL FIX**: Use ACTUAL video element's dimensions for high-resolution capture
        canvas.width = actualVideoElement.videoWidth || 848;
        canvas.height = actualVideoElement.videoHeight || 480;
        
        // **ARCHITECT FIX**: Robust seek-and-wait before frame capture when paused
        const useDetectionTime = (options.detectionTime !== undefined && options.detectionTime !== null) && actualVideoElement.paused && !options.deferAutoSeek;
        
        if (useDetectionTime) {
          const targetTime = Math.max(0, Math.min((options.detectionTime || 0), actualVideoElement.duration || Infinity));
          
          // Only seek if we need to move more than 1 frame (≈0.033s at 30fps)
          if (Math.abs(actualVideoElement.currentTime - targetTime) > 0.033) {
            console.log(`🎬 ROBUST SEEKING: ${targetTime.toFixed(3)}s (from ${actualVideoElement.currentTime.toFixed(3)}s)`);
            
            // **PRODUCTION-READY SEEK**: Handle all edge cases
            await new Promise<void>((resolve, reject) => {
              let timeoutId: NodeJS.Timeout;
              let resolved = false;
              
              const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                actualVideoElement.removeEventListener('seeked', handleSeeked);
                actualVideoElement.removeEventListener('timeupdate', handleTimeUpdate);
                actualVideoElement.removeEventListener('error', handleError);
                actualVideoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
              };
              
              const safeResolve = (reason: string) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                console.log(`✅ SEEK ${reason}: Now at ${actualVideoElement.currentTime.toFixed(3)}s`);
                resolve();
              };
              
              const handleSeeked = () => safeResolve('COMPLETE');
              
              const handleTimeUpdate = () => {
                // Fallback: if time is close enough, consider it successful
                if (Math.abs(actualVideoElement.currentTime - targetTime) < 0.1) {
                  safeResolve('TIMEUPDATE');
                }
              };
              
              const handleError = () => {
                if (resolved) return;
                resolved = true;
                cleanup();
                console.warn(`⚠️ SEEK ERROR: Proceeding with ${actualVideoElement.currentTime.toFixed(3)}s`);
                resolve(); // Don't reject - continue with current time
              };
              
              const handleLoadedMetadata = () => {
                // Video ready now, perform seek
                actualVideoElement.currentTime = targetTime;
              };
              
              // Set up comprehensive event listeners
              actualVideoElement.addEventListener('seeked', handleSeeked);
              actualVideoElement.addEventListener('timeupdate', handleTimeUpdate);
              actualVideoElement.addEventListener('error', handleError);
              actualVideoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
              
              // Check if video is ready for seeking
              if (actualVideoElement.readyState >= 1) { // HAVE_METADATA
                actualVideoElement.currentTime = targetTime;
              } else {
                console.log(`⏳ WAITING for metadata before seeking to ${targetTime.toFixed(3)}s`);
              }
              
              // Ultimate timeout failsafe
              timeoutId = setTimeout(() => {
                console.warn(`⏰ SEEK TIMEOUT: Using ${actualVideoElement.currentTime.toFixed(3)}s instead of ${targetTime.toFixed(3)}s`);
                safeResolve('TIMEOUT');
              }, 3000);
            });
          } else {
            console.log(`🎯 SEEK SKIP: Already at ${actualVideoElement.currentTime.toFixed(3)}s (target: ${targetTime.toFixed(3)}s)`);
          }
        }
        
        // **ARCHITECT VERIFICATION**: Assert capture timestamp is correct
        const captureTime = actualVideoElement.currentTime;
        const expectedTime = useDetectionTime ? (options.detectionTime || 0) : captureTime;
        const timeDelta = Math.abs(captureTime - expectedTime);
        
        if (useDetectionTime && timeDelta > 0.05) {
          console.warn(`🚨 CAPTURE TIME MISMATCH: Expected ${expectedTime.toFixed(3)}s, got ${captureTime.toFixed(3)}s (Δ${timeDelta.toFixed(3)}s)`);
        }
        
        ctx.drawImage(actualVideoElement, 0, 0, canvas.width, canvas.height);
        
        console.log(`🖼️ Frame captured: ${canvas.width}×${canvas.height} at ${captureTime.toFixed(3)}s${useDetectionTime ? ` (target: ${expectedTime.toFixed(3)}s, Δ${timeDelta.toFixed(3)}s)` : ''}`);
        
        // **FIX**: Convert to base64 data URL (not blob) to match working API format
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // **CRITICAL FIX**: Use exact field names that schema expects with progressive timestamps
        // **WORKFLOW STATE FIX**: Use detectionTime from workflow state when available (Video Preview stage)
        console.log(`🐛 DETECTION TIME DEBUG:`, {
          'options.detectionTime': options.detectionTime,
          'options.detectionTime type': typeof options.detectionTime,
          'isDefined': options.detectionTime !== undefined,
          'isNotNull': options.detectionTime !== null,
          'videoCurrentTime': actualVideoElement.currentTime,
          'component': options.componentName
        });
        
        // **CRITICAL FIX**: Use detectionTime only when video is paused (for timeline selection)
        // During playback, always use current video time for real-time player tracking  
        const currentTimestamp = useDetectionTime ? ((options.detectionTime || 0) * 1000) : (actualVideoElement.currentTime * 1000);
        console.log(`📊 FRAME TIMING CHECK: ${useDetectionTime ? 'WORKFLOW' : 'VIDEO'} time: ${useDetectionTime ? (options.detectionTime || 0).toFixed(3) : actualVideoElement.currentTime.toFixed(3)}s (${currentTimestamp.toFixed(0)}ms), paused: ${actualVideoElement.paused}`);
        
        // **CRITICAL FIX**: Include selectedPlayerId for backend ID-locking
        const selectedPlayerId = trackerRef.current?.getSelectedPlayerId() || options.selectedPlayer?.id || null;
        
        console.log(`🔧 DETECTION REQUEST - Including selectedPlayerId:`, {
          selectedPlayerIdFromTracker: trackerRef.current?.getSelectedPlayerId(),
          selectedPlayerIdFromOptions: options.selectedPlayer?.id,
          finalSelectedPlayerId: selectedPlayerId,
          timestamp: actualVideoElement.currentTime.toFixed(3)
        });
        
        // **ROBUST CAPTURE HELPER**: Prevent toBlob hangs with preconditions, timeout, and fallback
        const captureStartTime = performance.now();
        
        // **PRECONDITION 1**: Verify video is ready
        if (actualVideoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          console.warn('⚠️ Video not ready for capture - waiting for loadeddata', {
            readyState: actualVideoElement.readyState,
            required: HTMLMediaElement.HAVE_CURRENT_DATA
          });
          await new Promise<void>((resolve) => {
            const onReady = () => {
              actualVideoElement.removeEventListener('loadeddata', onReady);
              resolve();
            };
            if (actualVideoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              resolve();
            } else {
              actualVideoElement.addEventListener('loadeddata', onReady, { once: true });
            }
          });
        }
        
        // **PRECONDITION 2**: Verify video dimensions
        if (actualVideoElement.videoWidth === 0 || actualVideoElement.videoHeight === 0) {
          throw new Error(`Invalid video dimensions: ${actualVideoElement.videoWidth}x${actualVideoElement.videoHeight}`);
        }
        
        // **PRECONDITION 3**: Verify canvas dimensions
        if (canvas.width === 0 || canvas.height === 0) {
          throw new Error(`Invalid canvas dimensions: ${canvas.width}x${canvas.height}`);
        }
        
        // **LAYOUT SETTLEMENT**: Wait one RAF to ensure canvas is ready
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        
        console.log('🖼️ Creating capture blob...', {
          canvasSize: `${canvas.width}x${canvas.height}`,
          videoSize: `${actualVideoElement.videoWidth}x${actualVideoElement.videoHeight}`,
          readyState: actualVideoElement.readyState,
          timestamp: actualVideoElement.currentTime.toFixed(3)
        });
        
        // **ROBUST BLOB CREATION**: Timeout + fallback to dataURL
        let blob: Blob;
        try {
          blob = await new Promise<Blob>((resolve, reject) => {
            let done = false;
            const timeout = setTimeout(() => {
              if (!done) {
                done = true;
                reject(new Error('toBlob timeout after 300ms'));
              }
            }, 300);
            
            try {
              canvas.toBlob((b: Blob | null) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                
                if (!b) {
                  reject(new Error('toBlob returned null'));
                } else {
                  const toBlobLatency = performance.now() - captureStartTime;
                  console.log(`✅ toBlob ok (${toBlobLatency.toFixed(0)}ms) | size=${(b.size / 1024).toFixed(1)} KB`);
                  resolve(b);
                }
              }, 'image/jpeg', 0.92);
            } catch (e) {
              if (!done) {
                done = true;
                clearTimeout(timeout);
                reject(e);
              }
            }
          });
        } catch (toBlobError: any) {
          // **FALLBACK**: Use dataURL if toBlob fails/times out
          console.warn(`⚠️ toBlob failed - using dataURL fallback:`, toBlobError.message);
          
          try {
            const dataURL = canvas.toDataURL('image/jpeg', 0.92);
            const idx = dataURL.indexOf(',');
            const b64 = dataURL.slice(idx + 1);
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
              arr[i] = bin.charCodeAt(i);
            }
            blob = new Blob([arr], { type: 'image/jpeg' });
            console.log(`✅ dataURL fallback ok | size=${(blob.size / 1024).toFixed(1)} KB`);
          } catch (dataURLError: any) {
            throw new Error(`Both toBlob and dataURL failed: ${dataURLError.message}`);
          }
        }
        
        if (!blob || !blob.size) {
          throw new Error('Capture produced empty blob');
        }
        
        // Create FormData for ZERO-LAG path
        const formData = new FormData();
        formData.append('frame', blob, 'frame.jpg');
        formData.append('timestampMs', Math.round(currentTimestamp).toString());
        formData.append('videoId', options.videoId || 'tracking-video'); // **FIX**: Use options.videoId for consistent tracking
        if (selectedPlayerId) {
          formData.append('selectedPlayerId', selectedPlayerId);
        }
        
        // **COMPREHENSIVE FETCH WITH TIMEOUT AND ERROR HANDLING**
        console.log('🚚 POST replicate start');
        
        const fetchTimeout = 150000; // 150 second timeout to account for YOLOv8 processing (118-124s observed)
        const timeoutId = setTimeout(() => {
          if (abortController && !abortController.signal.aborted) {
            abortController.abort('Request timeout');
          }
        }, fetchTimeout);

        let response: Response;
        try {
          response = await fetch('/api/detect-players', {
            method: 'POST',
            credentials: 'include',
            body: formData, // Browser auto-sets multipart/form-data
            signal: abortController.signal
          });
          clearTimeout(timeoutId);
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          
          // **COMPREHENSIVE NETWORK ERROR HANDLING**
          if (fetchError.name === 'AbortError') {
            if (currentRequestRef.current === abortController) {
              currentRequestRef.current = null;
            }
            console.log('🚫 Request aborted (timeout or cancellation)');
            return [];
          }
          
          if (fetchError.name === 'TypeError' || fetchError.message?.includes('Failed to fetch')) {
            console.warn(`🌐 Network error (attempt ${attempt + 1}/${maxRetries + 1}):`, fetchError.message);
            
            if (attempt < maxRetries) {
              const networkBackoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
              console.log(`🔄 Retrying after network error in ${networkBackoff.toFixed(0)}ms`);
              await sleep(networkBackoff);
              continue;
            } else {
              console.error('🚫 Network permanently unavailable - stopping detection requests');
              if (currentRequestRef.current === abortController) {
                currentRequestRef.current = null;
              }
              return [];
            }
          }
          
          // Re-throw unexpected errors
          throw fetchError;
        }
        
        // **RATE LIMITING HANDLING** with exponential backoff
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const backoffDelay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 2000; // Longer backoff
          
          if (attempt < maxRetries) {
            console.log(`⏰ Rate limited. Backing off for ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await sleep(backoffDelay);
            continue;
          } else {
            console.warn('🚫 Rate limit exceeded - detection will retry on next interval');
            // Return empty instead of throwing to prevent cascade failures
            if (currentRequestRef.current === abortController) {
              currentRequestRef.current = null;
            }
            return [];
          }
        }
        
        // **SERVICE UNAVAILABLE HANDLING** with aggressive backoff and circuit breaker
        if (response.status === 503) {
          const retryAfter = response.headers.get('Retry-After');
          // CRITICAL FIX: Much longer backoff for 503 errors to allow YOLOv8 recovery
          const backoffDelay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(4, attempt) * 2000; // 2s, 8s, 32s progression
          
          if (attempt < maxRetries) {
            console.log(`🔥 Service overloaded - YOLOv8 model needs recovery. Backing off for ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await sleep(backoffDelay);
            continue;
          } else {
            console.warn('🚫 Service permanently overloaded - entering circuit breaker mode');
            // Return empty array instead of throwing to prevent cascade failures
            if (currentRequestRef.current === abortController) {
              currentRequestRef.current = null;
            }
            return [];
          }
        }
        
        // **OTHER HTTP ERRORS** with standard exponential backoff
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error || `HTTP ${response.status}`;
          
          // Don't retry on client errors (4xx except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw new Error(`Client error: ${errorMessage}`);
          }
          
          // Retry on server errors (5xx) with exponential backoff
          if (response.status >= 500 && attempt < maxRetries) {
            const backoffDelay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Add jitter
            console.log(`Server error (${response.status}). Retrying in ${backoffDelay.toFixed(0)}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await sleep(backoffDelay);
            continue;
          }
          
          throw new Error(errorMessage);
        }
        
        const data = await response.json();
        console.log(`✅ replicate ${response.status}`);
        
        // **ALWAYS LOG RAW RESPONSE**: Debug logs run immediately after json() - no early returns!
        console.log('📜 RESPONSE PARSING DEBUG (ALWAYS):', {
          responseStatus: response.status,
          responseOk: response.ok,
          dataKeys: Object.keys(data),
          hasSuccess: data.success,
          hasPlayers: !!data.players,
          playersLength: data.players?.length || 0,
          hasDetections: !!data.detections,
          detectionsLength: data.detections?.length || 0,
          hasDataPlayers: !!data.data?.players,
          hasResultPlayers: !!data.result?.players,
          cached: data.cached,
          rawResponse: JSON.stringify(data).substring(0, 400)
        });
        
        // **SUCCESS PATH** - Return detections or handle cached response
        if (data.cached) {
          console.log('🎯 Detection served from cache');
        }
        
        // **ROBUST DETECTION EXTRACTION**: Check all possible response shapes
        const detections = data.players ?? data.detections ?? data.data?.players ?? data.result?.players ?? [];
        
        console.log(`🔍 YOLOv8 PARSING RESULT (DETAILED):`, {
          detectedCount: detections.length,
          resolution: `${canvas.width}×${canvas.height}`,
          serverSuccess: data.success,
          serverTimestamp: data.timestamp,
          serverFrameAnalysis: data.frameAnalysis,
          rawPlayersArray: data.players,
          rawDetectionsArray: data.detections,
          firstThreeDetections: detections.slice(0, 3).map((d: any) => ({
            id: d.id,
            confidence: d.confidence?.toFixed(2),
            x: d.x?.toFixed(3),
            y: d.y?.toFixed(3),
            centerX: d.centerX?.toFixed(3),
            centerY: d.centerY?.toFixed(3)
          }))
        });
        
        // **DEBUG**: Log if server had players but frontend got empty
        if (data.success && data.frameAnalysis?.totalPlayers > 0 && detections.length === 0) {
          console.error('🚨 CRITICAL PARSING ERROR: Server detected players but frontend received empty array!', {
            serverTotalPlayers: data.frameAnalysis.totalPlayers,
            serverPlayersExists: !!data.players,
            serverPlayersLength: data.players?.length || 0,
            serverDetectionsExists: !!data.detections,
            serverDetectionsLength: data.detections?.length || 0,
            parsedDetectionsLength: detections.length,
            fullServerResponse: data
          });
        }
        
        return detections;
        
      } catch (error) {
        lastError = error as Error;
        
        // **ABORT ERROR HANDLING** - Handle cancelled requests gracefully
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('🔄 Detection request aborted (video changed)');
          if (currentRequestRef.current === abortController) {
            currentRequestRef.current = null;
          }
          return [];
        }
        
        // **NETWORK ERROR HANDLING** with exponential backoff
        if (error instanceof TypeError && error.message.includes('fetch')) {
          if (attempt < maxRetries) {
            const backoffDelay = Math.pow(2, attempt) * 1000 + Math.random() * 500; // Add jitter
            console.log(`Network error. Retrying in ${backoffDelay.toFixed(0)}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await sleep(backoffDelay);
            continue;
          }
        }
        
        // If this is the last attempt or a non-retryable error, break
        if (attempt === maxRetries || !(error instanceof Error) || 
            error.message.includes('Client error')) {
          break;
        }
        
        // **GENERAL ERROR BACKOFF** for unexpected errors
        const backoffDelay = Math.pow(2, attempt) * 1000;
        console.log(`Unexpected error: ${error.message}. Retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(backoffDelay);
      }
    }
    
    // **CLEANUP & FALLBACK** - Clean up request tracking
    if (currentRequestRef.current === abortController) {
      currentRequestRef.current = null;
    }
    
    // If all retries failed, log and return empty array
    console.error(`Player detection failed after ${maxRetries + 1} attempts:`, lastError?.message);
    return [];
  }, []);

  // **ARCHITECT PRESCRIBED RESILIENCE**: Cache fallback function for service overload scenarios
  const getCachedDetections = useCallback(async (videoElement: HTMLVideoElement, source: string): Promise<DetectedPlayer[]> => {
    console.log(`🔄 ATTEMPTING CACHE FALLBACK from ${source}:`, {
      videoTime: videoElement.currentTime.toFixed(3),
      hasLocalCache: !!lastSuccessfulBatchRef.current,
      videoId: options.videoId || 'tracking-video'
    });
    
    // **STEP 1**: Try server-side cache endpoint first 
    try {
      const response = await fetch(`/api/detections/latest?videoId=${options.videoId || 'tracking-video'}&timestamp=${Date.now()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const cacheData = await response.json();
        if (cacheData.success && cacheData.players && cacheData.players.length > 0) {
          console.log(`✅ SERVER CACHE HIT: Retrieved ${cacheData.players.length} cached players from server`);
          return cacheData.players;
        }
      }
    } catch (error) {
      console.warn(`⚠️ Server cache unavailable:`, error);
    }
    
    // **STEP 2**: Fall back to local lastSuccessfulBatch
    if (lastSuccessfulBatchRef.current) {
      const cache = lastSuccessfulBatchRef.current;
      const ageMs = Date.now() - cache.timestamp;
      if (ageMs < 10000) { // Use cache if less than 10 seconds old
        console.log(`✅ LOCAL CACHE HIT: Using ${cache.players.length} cached players (age: ${ageMs}ms)`);
        return cache.players;
      } else {
        console.warn(`⚠️ Local cache too old (age: ${ageMs}ms), discarding`);
      }
    }
    
    // **STEP 3**: Return empty array as last resort - but ingestDetections will still be called
    console.log(`❌ NO CACHE AVAILABLE: Returning empty array, but ingestDetections will still be called`);
    return [];
  }, [options.videoId]);

  // **GLOBAL DETECTION COORDINATOR**: Prevents API flooding with proper rate limiting and circuit breaker
  const detectionManagerRef = useRef<{
    lastRequestTime: number;
    isRequesting: boolean;
    pendingRequest: Promise<DetectedPlayer[]> | null;
    requestQueue: Array<{
      videoElement: HTMLVideoElement;
      source: string;
      resolve: (detections: DetectedPlayer[]) => void;
      reject: (error: Error) => void;
    }>;
    failureCount: number;
    lastFailureTime: number;
    circuitBreakerOpen: boolean;
    activeTimers: Set<NodeJS.Timeout>;
    currentRequestSource?: string;
    requestStartTime?: number;
  }>({ 
    lastRequestTime: 0, 
    isRequesting: false, 
    pendingRequest: null,
    requestQueue: [],
    failureCount: 0,
    lastFailureTime: 0,
    circuitBreakerOpen: false,
    activeTimers: new Set(),
    currentRequestSource: undefined,
    requestStartTime: undefined
  });

  // **CRITICAL FIX**: Global timer cleanup with comprehensive shutdown
  const cleanupAllTimers = useCallback(() => {
    const manager = detectionManagerRef.current;
    console.log(`🧹 CRITICAL CLEANUP: Shutting down ${manager.activeTimers.size} active timers to prevent flooding`);
    
    // Cancel all active timers
    manager.activeTimers.forEach(timer => {
      clearTimeout(timer);
    });
    manager.activeTimers.clear();
    
    // Reset detection manager state
    manager.isRequesting = false;
    manager.currentRequestSource = undefined;
    manager.requestStartTime = undefined;
    manager.pendingRequest = null;
    manager.requestQueue = [];
    
    console.log('✅ TIMER CLEANUP COMPLETE: All detection loops stopped');
  }, []);

  // **CIRCUIT BREAKER**: Stop requests when server is overloaded (with more lenient settings)
  const checkCircuitBreaker = useCallback(() => {
    const manager = detectionManagerRef.current;
    const now = Date.now();
    const FAILURE_THRESHOLD = 10; // **ADJUSTED**: Open circuit after 10 failures (was 3) - more lenient
    const RECOVERY_TIME = 10000; // **ADJUSTED**: 10 seconds recovery time (was 30s) - faster recovery
    
    // Reset circuit breaker after recovery time
    if (manager.circuitBreakerOpen && now - manager.lastFailureTime > RECOVERY_TIME) {
      manager.circuitBreakerOpen = false;
      manager.failureCount = 0;
      console.log('🔄 Circuit breaker reset - resuming requests');
    }
    
    return !manager.circuitBreakerOpen;
  }, []);

  // **CIRCUIT BREAKER UPDATE**: Track failures and open circuit if needed
  const updateCircuitBreaker = useCallback((success: boolean) => {
    const manager = detectionManagerRef.current;
    
    if (success) {
      // Reset failure count on success
      manager.failureCount = 0;
    } else {
      manager.failureCount++;
      manager.lastFailureTime = Date.now();
      
      if (manager.failureCount >= 10) {
        manager.circuitBreakerOpen = true;
        console.warn(`🔥 Circuit breaker opened after ${manager.failureCount} failures - stopping requests for 10s`);
      }
    }
  }, []);

  // **RATE LIMITED DETECTION**: Single coordinated detection function with circuit breaker
  const requestDetection = useCallback(async (
    videoElement: HTMLVideoElement, 
    source: string = 'unknown'
  ): Promise<DetectedPlayer[]> => {
    const manager = detectionManagerRef.current;
    
    // **EXTERNAL MODE**: Skip ALL internal detection when using external feeding
    if (options.externalMode) {
      console.log(`🔌 EXTERNAL MODE: Skipping internal detection request from ${source} - using external keyframe feeding`);
      return [];
    }
    
    // **CIRCUIT BREAKER CHECK**: Stop requests if server is overloaded
    if (!checkCircuitBreaker()) {
      console.log(`🚫 CIRCUIT BREAKER OPEN - blocking detection request from ${source}`, {
        failureCount: manager.failureCount,
        lastFailureTime: manager.lastFailureTime,
        timeSinceFailure: Date.now() - manager.lastFailureTime
      });
      return [];
    }
    
    // **CRITICAL FIX**: Block concurrent requests from multiple tracking loops
    if (manager.isRequesting) {
      console.log(`🚫 CONCURRENT REQUEST BLOCKED from ${source} - another request already in progress`, {
        currentlyRequestingSource: manager.currentRequestSource,
        timeSinceRequestStart: Date.now() - (manager.requestStartTime || 0)
      });
      return [];
    }
    
    const now = performance.now();
    const MIN_INTERVAL = 2000; // 2s interval for smooth tracking (matches detectionInterval)
    const timeSinceLastRequest = now - manager.lastRequestTime;
    
    console.log(`🎯 DETECTION REQUEST from ${source}:`, {
      timeSinceLastRequest: timeSinceLastRequest.toFixed(0),
      minInterval: MIN_INTERVAL,
      isRequesting: manager.isRequesting,
      queueLength: manager.requestQueue.length,
      videoTime: videoElement.currentTime.toFixed(3),
      circuitBreakerOpen: manager.circuitBreakerOpen,
      failureCount: manager.failureCount
    });
    
    // **FIXED THROTTLING**: Bypass for all immediate user interactions including timeline clicks
    const isImmediateTrigger = source.includes('immediate_') || source.includes('manual_click');
    
    if (timeSinceLastRequest < MIN_INTERVAL && !isImmediateTrigger) {
      const waitTime = MIN_INTERVAL - timeSinceLastRequest;
      console.log(`⏱️ THROTTLING detection request from ${source} - waiting ${waitTime.toFixed(0)}ms`);
      
      // Wait for the throttle period
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Recheck conditions after waiting
      const newNow = performance.now();
      const newTimeSinceLastRequest = newNow - manager.lastRequestTime;
      
      if (newTimeSinceLastRequest < MIN_INTERVAL) {
        console.log(`🚫 THROTTLE still active after wait - falling back to cache from ${source}`);
        // **ARCHITECT PRESCRIBED FIX**: Always try cache fallback instead of returning empty
        return await getCachedDetections(videoElement, source);
      }
    } else if (isImmediateTrigger) {
      console.log(`🚀 IMMEDIATE TRIGGER - bypassing throttle for ${source}:`, {
        timeSinceLastRequest: timeSinceLastRequest.toFixed(0),
        videoTime: videoElement.currentTime.toFixed(3),
        reason: 'timeline_selection_or_immediate_trigger'
      });
    }
    
    // **CRITICAL FIX**: Aggressive deduplication to prevent request flooding
    if (manager.isRequesting && manager.pendingRequest) {
      const isTimelineTrigger = source.includes('immediate_') || source.includes('manual_click');
      const timeSinceRequest = now - manager.lastRequestTime;
      
      // **CRITICAL**: Only allow truly immediate user actions to bypass deduplication, block everything else
      if (!isTimelineTrigger && timeSinceRequest < 2000) {
        console.log(`🚫 BLOCKING DUPLICATE REQUEST from ${source} - reusing existing request (${timeSinceRequest.toFixed(0)}ms ago)`);
        try {
          return await manager.pendingRequest;
        } catch (error) {
          console.error(`❌ Deduplicated request failed:`, error);
          return [];
        }
      } else if (isTimelineTrigger) {
        console.log(`🚀 TIMELINE TRIGGER: Allowing parallel requests for better detection success`);
        // For timeline triggers, allow parallel requests rather than cancelling
        // This improves detection success when YOLOv8 is slow
        // Note: Server-side caching prevents duplicate processing
        manager.pendingRequest = null;
      } else {
        console.log(`⏱️ TIMED REQUEST: Allowing ${source} after ${timeSinceRequest.toFixed(0)}ms delay`);
      }
    }
    
    // **REQUEST COORDINATION**: Mark as requesting and update timestamp
    manager.isRequesting = true;
    manager.currentRequestSource = source;
    manager.requestStartTime = Date.now();
    manager.lastRequestTime = performance.now();
    
    console.log(`🚀 EXECUTING detection request from ${source}`);
    
    // Create the detection promise
    const detectionPromise = (async (): Promise<DetectedPlayer[]> => {
      try {
        // **ROBUST API CALL**: Use the existing detectPlayersInFrame with proper error handling
        const detections = await detectPlayersInFrame(videoElement, 2); // Reduced retries to prevent long delays
        
        console.log(`✅ DETECTION SUCCESS from ${source}:`, {
          detectionCount: detections.length,
          videoTime: videoElement.currentTime.toFixed(3),
          detections: detections.slice(0, 3).map(d => `${d.id}(${d.confidence.toFixed(2)})`),
          circuitBreakerOpen: detectionManagerRef.current.circuitBreakerOpen,
          failureCount: detectionManagerRef.current.failureCount
        });
        
        // **SUCCESS**: Update circuit breaker
        updateCircuitBreaker(true);
        
        // **ARCHITECT PRESCRIBED CACHE**: Store successful non-empty detections for fallback
        if (detections.length > 0) {
          lastSuccessfulBatchRef.current = {
            players: detections,
            timestamp: Date.now(),
            frameWidth: videoElement.videoWidth || 640,
            frameHeight: videoElement.videoHeight || 480
          };
          console.log(`💾 CACHED ${detections.length} successful detections for fallback`);
        }
        
        // **CRITICAL DEBUGGING**: Track if successful results are reaching the caller
        if (detections.length === 0) {
          console.warn(`⚠️ WARNING: Successful API call returned 0 detections - possible parsing issue`);
        }
        
        return detections;
      } catch (error) {
        console.error(`❌ DETECTION ERROR from ${source}:`, error);
        
        // **ERROR HANDLING WITH CIRCUIT BREAKER**: Track failures and handle 503 errors
        console.log(`❌ DETECTION ERROR DETAILS:`, {
          errorType: (error as Error).constructor.name,
          errorMessage: (error as Error).message,
          source: source
        });
        
        if (error instanceof Error) {
          if (error.message.includes('Service unavailable') || error.message.includes('503') || error.message.includes('overloaded')) {
            console.log(`🔧 SERVICE OVERLOADED (503) - updating circuit breaker`);
            updateCircuitBreaker(false);
          } else if (error.message.includes('Failed to fetch')) {
            console.log(`🌐 NETWORK ERROR - may be rate limited or connection issue`);
            updateCircuitBreaker(false);
          } else {
            console.log(`❌ OTHER ERROR: ${error.message}`);
          }
        }
        
        // Always return empty to prevent cascade failures but update circuit breaker
        return [];
      } finally {
        // **CLEANUP**: Always reset requesting state
        manager.isRequesting = false;
        manager.currentRequestSource = undefined;
        manager.requestStartTime = undefined;
        manager.pendingRequest = null;
        
        console.log(`🏁 DETECTION REQUEST COMPLETED from ${source}`);
      }
    })();
    
    // Store the promise for potential deduplication
    manager.pendingRequest = detectionPromise;
    
    return await detectionPromise;
  }, [detectPlayersInFrame]);

  // **IMMEDIATE TIMELINE DETECTION**: For instant detection when user selects timeline position
  const immediateTimelineDetection = useCallback(async (
    videoElement: HTMLVideoElement,
    timelinePosition: number,
    reason: string = 'timeline_selection'
  ): Promise<DetectedPlayer[]> => {
    console.log(`🎯 IMMEDIATE TIMELINE DETECTION triggered:`, {
      reason,
      timelinePosition: timelinePosition.toFixed(3),
      currentVideoTime: videoElement.currentTime.toFixed(3),
      willSeek: Math.abs(videoElement.currentTime - timelinePosition) > 0.1,
      timestamp: Date.now()
    });

    try {
      // Seek to timeline position if needed
      if (Math.abs(videoElement.currentTime - timelinePosition) > 0.1) {
        console.log(`🎬 SEEKING to timeline position: ${timelinePosition.toFixed(3)}s`);
        
        await new Promise<void>((resolve, reject) => {
          const handleSeeked = () => {
            videoElement.removeEventListener('seeked', handleSeeked);
            videoElement.removeEventListener('error', handleError);
            console.log(`✅ SEEK COMPLETED: Video positioned at ${videoElement.currentTime.toFixed(3)}s`);
            resolve();
          };
          
          const handleError = () => {
            videoElement.removeEventListener('seeked', handleSeeked);
            videoElement.removeEventListener('error', handleError);
            reject(new Error('Failed to seek to timeline position'));
          };
          
          videoElement.addEventListener('seeked', handleSeeked);
          videoElement.addEventListener('error', handleError);
          
          videoElement.currentTime = timelinePosition;
          
          // Fallback timeout
          setTimeout(() => {
            videoElement.removeEventListener('seeked', handleSeeked);
            videoElement.removeEventListener('error', handleError);
            resolve();
          }, 2000);
        });
      }

      // Use coordinated detection with immediate priority
      const detections = await requestDetection(videoElement, `immediate_${reason}`);
      
      console.log(`🎯 IMMEDIATE DETECTION RESULTS:`, {
        reason,
        timelinePosition: timelinePosition.toFixed(3),
        detectionCount: detections.length,
        videoTime: videoElement.currentTime.toFixed(3),
        detections: detections.slice(0, 3).map(d => ({
          id: d.id,
          x: d.x.toFixed(3),
          y: d.y.toFixed(3),
          confidence: d.confidence.toFixed(2)
        })),
        timestamp: Date.now()
      });

      return detections;
    } catch (error) {
      console.error(`❌ IMMEDIATE TIMELINE DETECTION failed:`, error);
      return [];
    }
  }, [requestDetection]);

  // **ENHANCED DATA FLOW DEBUGGING**: Track complete pipeline from detection to UI updates
  const debugDataFlowPipeline = useCallback((stage: string, data: any) => {
    console.log(`🔍 DATA FLOW PIPELINE [${stage}]:`, {
      stage,
      data,
      currentBoxState: currentBoxState,
      trackerBox: trackerRef.current?.getBox(),
      status,
      trackingMode: trackingStatus.mode,
      timestamp: Date.now()
    });
  }, [currentBoxState, status, trackingStatus.mode]);
  
  // **ARCHITECT PRESCRIBED METRICS**: Track detection cadence and coordinate deltas
  const metricsRef = useRef({
    lastDetectionTime: 0,
    detectionCount: 0,
    coordinateDeltas: [] as Array<{ time: number, deltaX: number, deltaY: number }>,
    frameCallbackCount: 0,
    lastCoordinate: null as { x: number, y: number } | null,
    detectionIntervals: [] as number[]
  });
  
  const logDetectionMetrics = useCallback((newBox: any, source: string) => {
    const now = performance.now();
    const metrics = metricsRef.current;
    
    // Calculate detection cadence (Hz)
    const timeDelta = now - metrics.lastDetectionTime;
    const detectionHz = timeDelta > 0 ? 1000 / timeDelta : 0;
    
    // Track detection intervals for average calculation
    if (metrics.lastDetectionTime > 0) {
      metrics.detectionIntervals.push(timeDelta);
      if (metrics.detectionIntervals.length > 20) {
        metrics.detectionIntervals.shift(); // Keep last 20 intervals
      }
    }
    
    // Calculate coordinate delta
    let coordinateDelta = { deltaX: 0, deltaY: 0 };
    if (metrics.lastCoordinate && newBox) {
      coordinateDelta = {
        deltaX: Math.abs(newBox.x - metrics.lastCoordinate.x),
        deltaY: Math.abs(newBox.y - metrics.lastCoordinate.y)
      };
    }
    
    metrics.detectionCount++;
    metrics.lastDetectionTime = now;
    if (newBox) {
      metrics.lastCoordinate = { x: newBox.x, y: newBox.y };
      metrics.coordinateDeltas.push({ time: now, ...coordinateDelta });
      
      // Keep only last 10 coordinate deltas
      if (metrics.coordinateDeltas.length > 10) {
        metrics.coordinateDeltas.shift();
      }
    }
    
    // Calculate average detection interval
    const avgInterval = metrics.detectionIntervals.length > 0 
      ? metrics.detectionIntervals.reduce((a, b) => a + b, 0) / metrics.detectionIntervals.length 
      : 0;
    
    // **CRITICAL VERIFICATION**: Log detection pipeline metrics
    console.log(`📊 DETECTION METRICS [${source}]:`, {
      detectionHz: detectionHz.toFixed(2) + 'Hz',
      avgDetectionHz: avgInterval > 0 ? (1000 / avgInterval).toFixed(2) + 'Hz' : 'N/A',
      detectionCount: metrics.detectionCount,
      coordinateDelta: `${coordinateDelta.deltaX.toFixed(4)}, ${coordinateDelta.deltaY.toFixed(4)}`,
      coordinateMovement: coordinateDelta.deltaX > 0.001 || coordinateDelta.deltaY > 0.001 ? '🔄 MOVING' : '⏸️ STABLE',
      coordinateStability: metrics.coordinateDeltas.length > 3 ? 
        (metrics.coordinateDeltas.slice(-3).every(d => d.deltaX < 0.01 && d.deltaY < 0.01) ? 'STABLE' : 'MOVING') : 'INITIALIZING',
      avgDetectionInterval: avgInterval.toFixed(1) + 'ms',
      targetInterval: '120-167ms (6-8Hz)',
      rVFCSupported: videoRef.current && 'requestVideoFrameCallback' in videoRef.current,
      timestamp: Date.now()
    });
  }, [videoRef]);

  // **UNIFIED UPDATE LOOP**: Single requestVideoFrameCallback/RAF loop with tracking-before-overlay ordering
  // This replaces ALL competing timers and loops to ensure proper sequencing
  const startUnifiedTrackingLoop = useCallback(() => {
    // **CRITICAL FIX**: Use dynamically rebinded video element if available
    const video = dynamicVideoRef.current || videoRef.current;
    const tracker = trackerRef.current;
    
    // **MANDATORY**: Disable ALL competing timers before starting unified loop
    console.log('🛑 UNIFIED LOOP: Disabling all competing timers and loops');
    cleanupAllTimers();
    
    // **STICKINESS FIX**: Force rVFC restart to ensure frame callbacks are actually running
    if (currentRVFCVideoRef.current === video && currentRVFCHandleRef.current !== null) {
      console.log('🔄 rVFC loop appears active but forcing restart to ensure frame callbacks are running');
      // Cancel the potentially stale callback
      video?.cancelVideoFrameCallback(currentRVFCHandleRef.current);
      currentRVFCHandleRef.current = null;
      currentRVFCVideoRef.current = null;
    }
    
    // **rVFC REBINDING FIX**: Cancel any existing rVFC loop to prevent duplicates
    if (currentRVFCHandleRef.current !== null && currentRVFCVideoRef.current) {
      console.log('🛑 Canceling existing rVFC loop to prevent duplicates');
      currentRVFCVideoRef.current.cancelVideoFrameCallback(currentRVFCHandleRef.current);
      currentRVFCHandleRef.current = null;
      currentRVFCVideoRef.current = null;
    }
    
    // **ENHANCED STARTUP DEBUGGING**: Detailed requirement verification
    console.log('🚀 rVFC STARTUP CHECK:', {
      hasVideo: !!video,
      hasTracker: !!tracker,
      hasHighlightLock: !!highlightLockRef.current,
      hasSelectionAnchor: !!selectionAnchor,
      videoElement: video ? {
        tagName: video.tagName,
        currentTime: video.currentTime.toFixed(3),
        duration: video.duration || 'unknown',
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        videoWidth: video.videoWidth || 'unknown',
        videoHeight: video.videoHeight || 'unknown',
        hasRequestVideoFrameCallback: typeof video.requestVideoFrameCallback === 'function',
        src: video.src ? video.src.substring(video.src.lastIndexOf('/') + 1) : 'NO_SOURCE'
      } : null,
      selectionAnchor
    });
    
    // **CRITICAL FIX**: Allow tracking to start with HighlightLock even without selectionAnchor
    // This enables manual selections to start tracking immediately
    if (!video || !tracker) {
      console.error('🚫 rVFC: Missing requirements - video:', !!video, 'tracker:', !!tracker);
      return;
    }
    
    // **OPTIONAL WARNING**: Log if starting without selectionAnchor (manual selection path)
    if (!selectionAnchor && !highlightLockRef.current) {
      console.warn('⚠️ rVFC: Starting without selectionAnchor or HighlightLock - tracking may be limited');
    }

    // **CRITICAL FIX**: Verify requestVideoFrameCallback is available
    if (typeof video.requestVideoFrameCallback !== 'function') {
      console.error('🚫 rVFC: requestVideoFrameCallback not available on this video element, will fallback to RAF');
      return;
    }

    // **CRITICAL FIX**: Verify video is in valid state
    if (video.readyState < 1) {
      console.error('🚫 rVFC: Video not ready (readyState < 1), cannot start rVFC loop');
      return;
    }

    let rvfcHandle: number | null = null;
    let lastDetectionTime = 0;
    let frameCount = 0;
    
    const onVideoFrame = async (now: number, metadata: VideoFrameCallbackMetadata) => {
      // **rVFC REBINDING FIX**: Bail early if this is a stale callback from old video element
      if (currentRVFCVideoRef.current !== video) {
        console.log('🚫 Stale rVFC callback detected - bailing early to prevent re-enqueue');
        return;
      }
      
      frameCount++;
      
      // **ARCHITECT PRESCRIBED LOGGING**: Per-frame video state monitoring
      console.log(`🎬 rVFC FRAME ${frameCount}:`, {
        videoTime: video.currentTime.toFixed(3),
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        mediaTime: metadata.mediaTime?.toFixed(3) || 'unknown',
        presentedFrames: metadata.presentedFrames || 'unknown',
        expectedDisplayTime: metadata.expectedDisplayTime?.toFixed(3) || 'unknown',
        elementId: video.id || 'NO_ID',
        srcShort: video.src ? video.src.substring(video.src.lastIndexOf('/') + 1, video.src.lastIndexOf('/') + 20) : 'NO_SOURCE',
        timestamp: Date.now()
      });
      
      // **DEAD-RECKONING**: Always update trackingBox on every frame for smooth tracking
      const dt = metadata.mediaTime ? (metadata.mediaTime - (lastDetectionTime || metadata.mediaTime)) / 1000 : 1/30;
      tracker.predict(dt);
      
      // **SEAMLESS TRACKING FIX**: Use proper incremental motion prediction
      console.log('🔍 rVFC PREDICTION CHECK:', {
        hasHighlightLock: !!highlightLockRef.current,
        highlightLockActive: highlightLockRef.current?.isActive,
        highlightLockState: highlightLockRef.current?.currentState,
        frame: frameCount
      });
      
      if (highlightLockRef.current) {
        const currentTime = Date.now();
        const predictedBox = highlightLockRef.current.tickPredict(currentTime);
        
        const motionState = (highlightLockRef.current as any).motionState;
        const velocityX = motionState?.velocityX?.toFixed(5) || '0';
        const velocityY = motionState?.velocityY?.toFixed(5) || '0';
        
        console.log(`🎯 rVFC PREDICTION [${frameCount}]: box=[${predictedBox?.x.toFixed(3)}, ${predictedBox?.y.toFixed(3)}], vel=[${velocityX}, ${velocityY}]`);
        
        // **ARCHITECT FIX**: Update currentBoxState with epsilon threshold to prevent React spam
        if (predictedBox) {
          safeSetCurrentBoxState(prev => {
            const newBox = {
              x: predictedBox.x,
              y: predictedBox.y,
              width: predictedBox.width,
              height: predictedBox.height,
              id: predictedBox.id  // **CRITICAL**: Preserve player ID to prevent spotlight from jumping
            };
            
            // **EPSILON THRESHOLD**: Only update if significant change (>0.001) to prevent re-render spam
            const epsilon = 0.001;
            const hasSignificantChange = !prev || 
              Math.abs(prev.x - newBox.x) > epsilon || 
              Math.abs(prev.y - newBox.y) > epsilon ||
              Math.abs(prev.width - newBox.width) > epsilon || 
              Math.abs(prev.height - newBox.height) > epsilon;
            
            if (hasSignificantChange) {
              console.log('🎯 HIGHLIGHT INCREMENTAL PREDICTION:', {
                from: prev ? `${prev.x.toFixed(3)}, ${prev.y.toFixed(3)}` : 'null',
                to: `${newBox.x.toFixed(3)}, ${newBox.y.toFixed(3)}`,
                confidence: highlightLockRef.current?.confidence.toFixed(3),
                state: highlightLockRef.current?.currentState,
                frame: frameCount
              });
              return newBox;
            }
            return prev;
          });
        }
      }
      
      const currentBox = tracker.getBox();
      if (currentBox) {
        console.log(`📦 rVFC TRACKING UPDATE:`, {
          center: `${(currentBox.x + currentBox.width/2).toFixed(3)}, ${(currentBox.y + currentBox.height/2).toFixed(3)}`,
          box: `${currentBox.x.toFixed(3)}, ${currentBox.y.toFixed(3)}, ${currentBox.width.toFixed(3)}, ${currentBox.height.toFixed(3)}`,
          videoTime: video.currentTime.toFixed(3)
        });
      }
      
      // **BALANCED TRACKING**: 500ms interval prevents overlapping API calls
      // Avoids race conditions where stale detections overwrite canonical coordinates
      const detectionInterval = video.paused ? 250 : 500; // 500ms prevents concurrent API calls
      const timeSinceLastDetection = now - lastDetectionTime;
      
      if (timeSinceLastDetection >= detectionInterval || lastDetectionTime === 0) {
        console.log(`🔍 rVFC DETECTION TRIGGER:`, {
          timeSinceLastDetection: timeSinceLastDetection.toFixed(0),
          detectionInterval,
          videoTime: video.currentTime.toFixed(3),
          reason: lastDetectionTime === 0 ? 'first_run' : 'interval_met'
        });
        
        lastDetectionTime = now;
        
        try {
          // **CRITICAL FIX**: Always use the current active video element
          const activeVideo = dynamicVideoRef.current || video;
          
          // **USE CENTRALIZED DETECTION**: Replace direct API call with coordinated detection
          // **CRITICAL FIX**: Mark rVFC as immediate to bypass throttling for continuous tracking
          console.log('🚀 rVFC: Using centralized detection manager for coordinated requests');
          const detections = await requestDetection(activeVideo, 'immediate_rVFC');
          
          console.log('🎯 rVFC DIRECT DETECTION RESULTS:', {
            detectionCount: detections.length,
            videoTime: activeVideo.currentTime.toFixed(3),
            detections: detections.map((d: any) => ({
              id: d.id,
              x: d.x.toFixed(3),
              y: d.y.toFixed(3),
              confidence: d.confidence.toFixed(2)
            }))
          });
          
          // **ARCHITECT PRESCRIBED FIX**: ALWAYS call ingestDetections, even on empty results
          // This prevents ingest starvation when service is overloaded
          console.log(`🔗 FEEDING rVFC DETECTIONS TO HIGHLIGHTLOCK SYSTEM (${detections.length} detections)`);
          ingestDetections({
            players: detections,
            frameWidth: video.videoWidth || 640,
            frameHeight: video.videoHeight || 480,
            timestampMs: video.currentTime * 1000
          });
          
          if (detections.length > 0) {
            console.log('🎯 rVFC BEFORE tracker.update():', {
              currentTrackerBox: tracker.getBox(),
              detectionsReceived: detections.length,
              firstDetection: detections[0] ? {
                id: detections[0].id,
                x: detections[0].x.toFixed(3),
                y: detections[0].y.toFixed(3),
                confidence: detections[0].confidence.toFixed(2)
              } : null
            });
            
            const newBoxAfterUpdate = tracker.getBox();
            console.log('🎯 rVFC AFTER tracker.update():', {
              newTrackerBox: newBoxAfterUpdate,
              changed: JSON.stringify(newBoxAfterUpdate) !== JSON.stringify(tracker.getBox()),
              timestamp: Date.now()
            });
            
            // **ARCHITECT PRESCRIBED METRICS**: Log detection pipeline metrics
            logDetectionMetrics(newBoxAfterUpdate, 'rVFC');
            
            const trackerStatus = tracker.getStatus();
            safeSetStatus(trackerStatus.isTracking ? 'tracking' : 'lost');
            
            // **CRITICAL FIX**: Update currentBox state after detection update
            const newBox = tracker.getBox();
            safeSetCurrentBoxState(prev => {
              if (!prev || prev.x !== newBox.x || prev.y !== newBox.y || prev.width !== newBox.width || prev.height !== newBox.height) {
                console.log('📦 FALLBACK CURRENTBOX UPDATE:', {
                  from: prev ? `${prev.x.toFixed(3)}, ${prev.y.toFixed(3)}` : 'null',
                  to: `${newBox.x.toFixed(3)}, ${newBox.y.toFixed(3)}`,
                  detectionsCount: detections.length,
                  timestamp: Date.now()
                });
                return newBox;
              }
              return prev;
            });
          }
        } catch (error) {
          console.error('❌ rVFC detection error:', error);
        }
      } else {
        console.log(`⏭️ rVFC DETECTION SKIP:`, {
          timeSinceLastDetection: timeSinceLastDetection.toFixed(0),
          detectionInterval,
          videoTime: video.currentTime.toFixed(3),
          reason: 'interval_not_met'
        });
      }
      
      // **UPDATE STATUS**: Continuous status updates
      const enhancedStatus = tracker.getEnhancedStatus();
      safeSetTrackingStatus({
        mode: enhancedStatus.mode,
        confidence: enhancedStatus.confidence,
        fallbackActive: enhancedStatus.fallbackActive,
        fallbackReason: enhancedStatus.fallbackReason as any,
        detectionAge: enhancedStatus.detectionAge,
        trackingStability: enhancedStatus.trackingStability,
        velocityMagnitude: enhancedStatus.velocityMagnitude,
        canManuallyOverride: enhancedStatus.canManuallyOverride
      });
      
      // **CRITICAL FIX**: Update currentBox state to trigger React re-renders
      const newBox = tracker.getBox();
      safeSetCurrentBoxState(prev => {
        if (!prev || prev.x !== newBox.x || prev.y !== newBox.y || prev.width !== newBox.width || prev.height !== newBox.height) {
          console.log('📦 REACTIVE CURRENTBOX UPDATE:', {
            from: prev ? `${prev.x.toFixed(3)}, ${prev.y.toFixed(3)}` : 'null',
            to: `${newBox.x.toFixed(3)}, ${newBox.y.toFixed(3)}`,
            timestamp: Date.now()
          });
          return newBox;
        }
        return prev;
      });
      
      // **CONTINUE LOOP**: Schedule next frame if video is still valid
      if (!video.ended && video.readyState >= 2) {
        rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);
      } else {
        console.log('🏁 rVFC loop ended:', { ended: video.ended, readyState: video.readyState });
      }
    };
    
    // **START rVFC LOOP**: Begin video-frame-driven tracking
    console.log('🚀 Starting rVFC-driven tracking loop');
    
    // **CRITICAL FIX**: Set currentRVFCVideoRef BEFORE starting loop to prevent race condition
    // If callback fires before this is set, it will bail thinking it's stale
    currentRVFCVideoRef.current = video;
    
    rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);
    
    // **rVFC REBINDING FIX**: Track global rVFC handle
    currentRVFCHandleRef.current = rvfcHandle;
    
    // **GLOBAL TIMER MANAGEMENT**: Use centralized timer cleanup to prevent multiple concurrent timers
    const manager = detectionManagerRef.current;
    
    // **CRITICAL FIX**: Clean up ALL existing timers before starting new ones
    cleanupAllTimers();
    
    let pausedDetectionTimer: NodeJS.Timeout | null = null;
    let pausedFrameCount = 0;
    
    const handlePausedDetection = async () => {
      if (video.paused && !video.ended) {
        pausedFrameCount++;
        console.log(`⏸️ PAUSED VIDEO DETECTION ${pausedFrameCount}:`, {
          videoTime: video.currentTime.toFixed(3),
          paused: video.paused,
          readyState: video.readyState,
          activeTimers: manager.activeTimers.size
        });
        
        // Simulate the detection logic from rVFC for paused videos
        const now = performance.now();
        
        // Dead-reckoning update for paused video
        tracker.predict(0.5); // Small delta for stability
        
        // Run detection every interval even when paused - BUT FIX THE DEDUPLICATION
        const detectionInterval = 1000; // 1 second for paused video (faster than before)
        const timeSinceLastDetection = now - lastDetectionTime;
        
        if (timeSinceLastDetection >= detectionInterval || lastDetectionTime === 0) {
          console.log(`🔍 PAUSED DETECTION TRIGGER:`, {
            timeSinceLastDetection: timeSinceLastDetection.toFixed(0),
            videoTime: video.currentTime.toFixed(3),
            reason: lastDetectionTime === 0 ? 'first_run' : 'interval_met'
          });
          
          lastDetectionTime = now;
          
          // **USE CENTRALIZED DETECTION**: Replace direct API call with coordinated detection
          console.log('🚀 PAUSED: Using centralized detection manager for coordinated requests');
          
          try {
            const detections = await requestDetection(video, 'paused');
            
            console.log('🎯 PAUSED DETECTION RESULTS:', {
              detectionCount: detections.length,
              videoTime: video.currentTime.toFixed(3),
              detections: detections.slice(0, 3).map((d: any) => ({
                id: d.id,
                x: d.x.toFixed(3),
                y: d.y.toFixed(3),
                confidence: d.confidence.toFixed(2)
              }))
            });
            
            // **ARCHITECT PRESCRIBED FIX**: ALWAYS call ingestDetections, even on empty results
            // This prevents ingest starvation when service is overloaded  
            console.log(`🔗 FEEDING PAUSED DETECTIONS TO HIGHLIGHTLOCK SYSTEM (${detections.length} detections)`);
            ingestDetections({
              players: detections,
              frameWidth: video.videoWidth || 640,
              frameHeight: video.videoHeight || 480,
              timestampMs: video.currentTime * 1000
            });
            
            if (detections.length > 0) {
              console.log('🎯 PAUSED BEFORE tracker.update():', {
                currentTrackerBox: tracker.getBox(),
                detectionsReceived: detections.length,
                firstDetection: detections[0] ? {
                  id: detections[0].id,
                  x: detections[0].x.toFixed(3),
                  y: detections[0].y.toFixed(3),
                  confidence: detections[0].confidence.toFixed(2)
                } : null
              });
              
              const newBoxAfterUpdate = tracker.getBox();
              console.log('🎯 PAUSED AFTER tracker.update():', {
                newTrackerBox: newBoxAfterUpdate,
                coordinatesChanged: JSON.stringify(newBoxAfterUpdate) !== JSON.stringify(tracker.getBox()),
                timestamp: Date.now()
              });
              
              // **ARCHITECT PRESCRIBED METRICS**: Log detection pipeline metrics
              logDetectionMetrics(newBoxAfterUpdate, 'paused');
              
              const trackerStatus = tracker.getStatus();
              safeSetStatus(trackerStatus.isTracking ? 'tracking' : 'lost');
              
              // **CRITICAL FIX**: Force currentBox state update to trigger SpotlightOverlay re-render
              const newBox = tracker.getBox();
              safeSetCurrentBoxState(prev => {
                const hasChanged = !prev || 
                  Math.abs(prev.x - newBox.x) > 0.001 || 
                  Math.abs(prev.y - newBox.y) > 0.001 || 
                  Math.abs(prev.width - newBox.width) > 0.001 || 
                  Math.abs(prev.height - newBox.height) > 0.001;
                
                if (hasChanged) {
                  console.log('📦 PAUSED DETECTION COORDINATE UPDATE (SpotlightOverlay will re-render):', {
                    from: prev ? `${prev.x.toFixed(3)}, ${prev.y.toFixed(3)}` : 'null',
                    to: `${newBox.x.toFixed(3)}, ${newBox.y.toFixed(3)}`,
                    detectionsCount: detections.length,
                    changeDetected: hasChanged,
                    timestamp: Date.now()
                  });
                  return { ...newBox }; // Create new object to force React re-render
                }
                return prev;
              });
              
              console.log('✅ PAUSED DETECTION SUCCESS - position updated!');
            }
            
          } catch (error) {
            console.error('❌ PAUSED detection error:', error);
          }
          
          // Schedule next detection with global timer tracking
          if (video.paused && !video.ended) {
            pausedDetectionTimer = setTimeout(handlePausedDetection, detectionInterval);
            
            // **CRITICAL**: Register timer in global manager
            if (pausedDetectionTimer) {
              manager.activeTimers.add(pausedDetectionTimer);
            }
          }
        } else {
          // If interval not met, schedule next check with global timer tracking
          const remainingTime = detectionInterval - timeSinceLastDetection;
          if (video.paused && !video.ended) {
            pausedDetectionTimer = setTimeout(handlePausedDetection, remainingTime);
            
            // **CRITICAL**: Register timer in global manager
            if (pausedDetectionTimer) {
              manager.activeTimers.add(pausedDetectionTimer);
            }
          }
        }
      }
    };
    
    // Start paused detection timer if video is initially paused with global timer tracking
    // **CRITICAL FIX**: Only start direct timer when rVFC is not available
    // Prevents competing update loops that cause spotlight jitter
    if (video.paused && !video.ended && typeof video.requestVideoFrameCallback !== 'function') {
      console.log('⏸️ Video is paused - starting DIRECT API detection fallback (no rVFC support)');
      pausedDetectionTimer = setTimeout(handlePausedDetection, 500);
      
      // **CRITICAL**: Register timer in global manager
      if (pausedDetectionTimer) {
        manager.activeTimers.add(pausedDetectionTimer);
      }
      
      console.log(`⏸️ DIRECT DETECTION TIMER STARTED (total active: ${manager.activeTimers.size})`);
    } else if (video.paused && typeof video.requestVideoFrameCallback === 'function') {
      console.log('⏸️ Video paused but rVFC available - using single-shot detection instead of timer');
      // **ARCHITECT RECOMMENDED**: Single-shot detection instead of competing timer
      setTimeout(handlePausedDetection, 100); // One-time detection
    }
    
    // **CLEANUP FUNCTION**: Return cleanup function
    return () => {
      if (rvfcHandle !== null) {
        video.cancelVideoFrameCallback(rvfcHandle);
        console.log('🛑 rVFC loop cancelled');
      }
      if (pausedDetectionTimer !== null) {
        clearTimeout(pausedDetectionTimer);
        manager.activeTimers.delete(pausedDetectionTimer);
        console.log(`🛑 Paused detection timer cancelled (active timers: ${manager.activeTimers.size})`);
      }
      
      // **rVFC REBINDING FIX**: Always clear global handle tracking on cleanup
      if (currentRVFCHandleRef.current === rvfcHandle) {
        currentRVFCHandleRef.current = null;
        currentRVFCVideoRef.current = null;
      } else if (currentRVFCHandleRef.current !== null && currentRVFCVideoRef.current) {
        // **ARCHITECT FIX**: Guarantee cancellation on teardown even if handles don't match
        console.log('🛑 Force canceling any remaining rVFC handle on teardown');
        currentRVFCVideoRef.current.cancelVideoFrameCallback(currentRVFCHandleRef.current);
        currentRVFCHandleRef.current = null;
        currentRVFCVideoRef.current = null;
      }
      
      // **ADDITIONAL CLEANUP**: Clean up any remaining timers
      cleanupAllTimers();
    };
  }, [detectPlayersInFrame, videoRef, selectionAnchor]);
  
  // **FALLBACK**: timeupdate + RAF for browsers without rVFC support
  const startFallbackLoop = useCallback(() => {
    // **CRITICAL FIX**: Use dynamically rebinded video element if available
    const video = dynamicVideoRef.current || videoRef.current;
    const tracker = trackerRef.current;
    
    if (!video || !tracker || !selectionAnchor) {
      console.log('🚫 Fallback: Missing requirements');
      return;
    }
    
    let rafHandle: number | null = null;
    let lastDetectionTime = 0;
    let frameCount = 0;
    
    const onAnimationFrame = async () => {
      frameCount++;
      const now = performance.now();
      
      console.log(`🎬 RAF FALLBACK FRAME ${frameCount}:`, {
        videoTime: video.currentTime.toFixed(3),
        paused: video.paused,
        timestamp: now
      });
      
      // Dead-reckoning update
      const dt = 1/30; // Assume 30fps
      tracker.predict(dt);
      
      // **BALANCED TRACKING**: 500ms interval prevents overlapping API calls
      // Avoids race conditions where stale detections overwrite canonical coordinates
      const detectionInterval = video.paused ? 250 : 500; // 500ms prevents concurrent API calls
      const timeSinceLastDetection = now - lastDetectionTime;
      
      if (timeSinceLastDetection >= detectionInterval || lastDetectionTime === 0) {
        lastDetectionTime = now;
        
        try {
          // **CRITICAL FIX**: Always use the current active video element
          const activeVideo = dynamicVideoRef.current || video;
          // **USE CENTRALIZED DETECTION**: Replace direct call with coordinated detection
          const detections = await requestDetection(activeVideo, 'fallback');
          
          // **ARCHITECT PRESCRIBED FIX**: ALWAYS call ingestDetections, even on empty results
          // This prevents ingest starvation when service is overloaded
          console.log(`🔗 FEEDING FALLBACK DETECTIONS TO HIGHLIGHTLOCK SYSTEM (${detections.length} detections)`);
          ingestDetections({
            players: detections,
            frameWidth: video.videoWidth || 640,
            frameHeight: video.videoHeight || 480,
            timestampMs: video.currentTime * 1000
          });
        } catch (error) {
          console.error('❌ Fallback detection error:', error);
        }
      }
      
      // Continue loop
      if (!video.ended && video.readyState >= 2) {
        rafHandle = requestAnimationFrame(onAnimationFrame);
      }
    };
    
    console.log('🚀 Starting RAF fallback tracking loop');
    rafHandle = requestAnimationFrame(onAnimationFrame);
    
    return () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        console.log('🛑 RAF fallback loop cancelled');
      }
    };
  }, [detectPlayersInFrame, videoRef, selectionAnchor]);

  // **ARCHITECT DEBUGGING**: Video-driven tracking startup with comprehensive external mode tracing
  const startVideoTracking = useCallback(() => {
    // **CRITICAL FIX**: Use dynamically rebinded video element if available
    const video = dynamicVideoRef.current || videoRef.current;
    
    // **ARCHITECT COMPREHENSIVE DEBUGGING**: Debug tracking startup
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎬 startVideoTracking() CALLED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 STARTUP STATE:', {
      hasVideo: !!video,
      hasTracker: !!trackerRef.current,
      hasSelectionAnchor: !!selectionAnchor,
      externalMode: options.externalMode,
      componentName: options.componentName,
      videoInfo: video ? {
        tagName: video.tagName,
        currentTime: video.currentTime.toFixed(3),
        readyState: video.readyState,
        paused: video.paused,
        ended: video.ended,
        hasRequestVideoFrameCallback: typeof video.requestVideoFrameCallback === 'function'
      } : null,
      selectionAnchor
    });
    
    // **CRITICAL FIX**: Allow tracking to start without selectionAnchor for initial detection
    // Users need to see detected players before they can select one
    if (!video || !trackerRef.current) {
      console.error('🚫 startVideoTracking: Missing requirements - video:', !!video, 'tracker:', !!trackerRef.current, 'anchor:', !!selectionAnchor);
      return null;
    }
    
    // **CHICKEN-EGG FIX**: Log when starting without selection anchor (for initial detection)
    if (!selectionAnchor) {
      console.log('🔍 Starting detection WITHOUT selectionAnchor for initial player discovery');
    }
    
    // **ARCHITECT FIX**: External mode check AFTER tracker initialization but BEFORE starting internal loops
    // This ensures HighlightLock and ingestion bindings are ready for external keyframe detections
    if (options.externalMode) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔌 EXTERNAL MODE ACTIVE - SKIPPING INTERNAL LOOPS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 External Mode State:', {
        componentName: options.componentName,
        trackerReady: !!trackerRef.current,
        highlightLockReady: !!highlightLockRef.current,
        ingestDetectionsReady: typeof ingestDetections === 'function',
        timestamp: Date.now()
      });
      console.log('✅ Internal rVFC/fallback loops will NOT start');
      console.log('✅ HighlightLock ready for external keyframe detections');
      return () => {
        console.log('🛑 External mode cleanup (no internal loops were started)');
      };
    }
    
    // **rVFC FEATURE DETECTION**: Check if requestVideoFrameCallback is available (INTERNAL MODE ONLY)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔥 INTERNAL MODE - STARTING DETECTION LOOPS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (typeof video.requestVideoFrameCallback === 'function') {
      console.log('✅ Using requestVideoFrameCallback for video-driven tracking (INTERNAL MODE)');
      console.log('🚀 CALLING startUnifiedTrackingLoop()...');
      const cleanup = startUnifiedTrackingLoop();
      console.log('📋 startUnifiedTrackingLoop() returned:', typeof cleanup);
      return cleanup;
    } else {
      console.log('⚠️ requestVideoFrameCallback not available, falling back to timeupdate + RAF (INTERNAL MODE)');
      console.log('🚀 CALLING startFallbackLoop()...');
      const cleanup = startFallbackLoop();
      console.log('📋 startFallbackLoop() returned:', typeof cleanup);
      return cleanup;
    }
  }, [startUnifiedTrackingLoop, startFallbackLoop, videoRef, selectionAnchor, options.externalMode]);

  // **INITIALIZATION**: Set up tracker when hook mounts or selection changes
  useEffect(() => {
    if (!trackerRef.current) {
      trackerRef.current = new Tracker(true); // Enable debug logging
      console.log('🌱 useSpotlightTracker: Tracker initialized');
      
      // **APPLY PENDING ID**: Apply any pending selectedPlayerId after tracker creation
      if (pendingSelectedIdRef.current) {
        trackerRef.current.setSelectedPlayerId(pendingSelectedIdRef.current);
        console.log(`🎯 ID-LOCKED TRACKING: Applied pending player ID=${pendingSelectedIdRef.current} (post-init)`);
        pendingSelectedIdRef.current = null; // Clear pending
      }
    }
    
    // **rVFC REBINDING FIX**: Initialize active video element state
    const initialVideo = dynamicVideoRef.current || videoRef.current;
    if (initialVideo && initialVideo !== activeVideoElement) {
      console.log('🔗 Setting initial active video element');
      safeSetActiveVideoElement(initialVideo);
    }
    
    // **ARCHITECT FIX**: Auto-rebind to playing video on initialization
    autoRebindToActiveVideo();

      // **ARCHITECT FIX**: ALWAYS initialize currentBox with non-null default values
    if (trackerRef.current) {
      console.log('🌱 useSpotlightTracker: Initializing tracker with default box');
      
      // **GUARANTEE NON-NULL**: Always create default tracking box at center screen
      const defaultCenter = { x: DEFAULT_CENTER_X, y: DEFAULT_CENTER_Y };
      const defaultBoxSize = { width: DEFAULT_BOX_WIDTH, height: DEFAULT_BOX_HEIGHT };
      const defaultBox = clampBox(defaultCenter.x, defaultCenter.y, defaultBoxSize.width, defaultBoxSize.height);
      
      console.log('📦 GUARANTEED NON-NULL TRACKING BOX INITIALIZED:', {
        center: defaultCenter,
        size: defaultBoxSize,
        clampedBox: defaultBox,
        timestamp: Date.now()
      });
      
      // Initialize with default box to ensure currentBox is never null
      trackerRef.current.seed(defaultCenter, defaultBoxSize);
      
      // **CRITICAL FIX**: Initialize currentBox state with default box
      safeSetCurrentBoxState(defaultBox);
    }

    // **SEED TRACKER**: Override with selection anchor if provided
    if (selectionAnchor && trackerRef.current) {
      console.log('🌱 useSpotlightTracker: Overriding with selection anchor:', selectionAnchor);
      
      // **ARCHITECT FIX**: Trust sanitized player from CreatorDashboard
      // Do NOT call createSafePlayer - it rejects sanitized players and forces manual mode
      let boxSize = { width: DEFAULT_BOX_WIDTH, height: DEFAULT_BOX_HEIGHT };
      const selectedPlayer = options.selectedPlayer;
      
      // Minimal validation with numeric coercion - handles both number and string types
      if (selectedPlayer && typeof selectedPlayer.id === 'string') {
        const width = Number(selectedPlayer.width);
        const height = Number(selectedPlayer.height);
        
        if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
          boxSize = { width, height };
          console.log('🎯 SEEDED WITH ACTUAL PLAYER BBOX:', selectedPlayer.id, boxSize);
          
          // **CRITICAL ID-LOCKED TRACKING**: Set the selected player ID for ID-locked tracking
          const selectedId = selectedPlayer.id;
          if (trackerRef.current) {
            trackerRef.current.setSelectedPlayerId(selectedId);
            console.log(`🎯 ID-LOCKED TRACKING: Selected player ID=${selectedId} (immediate bind)`);
          } else {
            // **RACE-PROOF**: Store ID for later application when tracker is ready
            pendingSelectedIdRef.current = selectedId;
            console.log(`🎯 ID-LOCKED TRACKING: Selected player ID=${selectedId} (pending - tracker not ready)`);
          }
        } else {
          console.log('⚠️ SEEDED WITH DEFAULT BBOX - invalid width/height');
          // Clear ID-lock when dimensions are invalid
          if (trackerRef.current) {
            trackerRef.current.setSelectedPlayerId(null);
          }
          pendingSelectedIdRef.current = null;
        }
      } else {
        console.log('⚠️ SEEDED WITH DEFAULT BBOX - no selectedPlayer provided');
        // Clear ID-lock when no player is selected
        if (trackerRef.current) {
          trackerRef.current.setSelectedPlayerId(null);
        }
        pendingSelectedIdRef.current = null; // Clear pending too
      }
      
      trackerRef.current.seed(selectionAnchor, boxSize);
      safeSetStatus('tracking');
      
      // **CRITICAL FIX**: Update currentBox state after seeding with selection anchor
      const newBox = trackerRef.current.getBox();
      safeSetCurrentBoxState(newBox);
      console.log('📦 SELECTION ANCHOR CURRENTBOX UPDATE:', {
        selectionAnchor,
        seedBox: newBox,
        timestamp: Date.now()
      });

      // **CRITICAL FIX v2.3**: ALWAYS clear old HighlightLock when seeding tracker
      // This prevents carrying over stale motion state from previous player selections
      // (even if the ID is the same - coordinates might have changed from sessionStorage hydration)
      if (highlightLockRef.current) {
        console.log('🧹 CLEARING OLD HIGHLIGHTLOCK (tracker reseed):', {
          oldMasterId: highlightLockRef.current.masterId,
          oldPosition: {
            x: highlightLockRef.current.smoothedBox?.x.toFixed(3),
            y: highlightLockRef.current.smoothedBox?.y.toFixed(3)
          },
          newPlayerId: selectedPlayer?.id,
          newPosition: {
            x: selectionAnchor.x.toFixed(3),
            y: selectionAnchor.y.toFixed(3)
          },
          timestamp: Date.now()
        });
        highlightLockRef.current = null;
      }
      
      // **CRITICAL FIX**: Create HighlightLock immediately for manual selections
      // Don't wait for detections - use seed box as initial tracking state
      if (!highlightLockRef.current && selectedPlayer?.id) {
        const initialDetection: Detection = {
          id: selectedPlayer.id,
          centerX: selectionAnchor.x,
          centerY: selectionAnchor.y,
          x: newBox.x,
          y: newBox.y,
          width: newBox.width,
          height: newBox.height,
          confidence: 0.95, // High confidence for manual selection
          timestamp: Date.now()
        };
        
        highlightLockRef.current = new HighlightLock(selectedPlayer.id, initialDetection);
        console.log('✅ HIGHLIGHTLOCK CREATED (MANUAL SELECTION):', {
          masterId: selectedPlayer.id,
          seedBox: newBox,
          timestamp: Date.now()
        });
      }

      // **TIMELINE-BASED IMMEDIATE DETECTION**: Trigger immediate detection when player is selected
      const triggerImmediateDetection = async () => {
        const video = videoRef.current || dynamicVideoRef.current;
        if (video && trackerRef.current) {
          console.log('🎯 TIMELINE SELECTION: Triggering immediate detection for player selection:', {
            playerPosition: selectionAnchor,
            videoTime: video.currentTime.toFixed(3),
            paused: video.paused,
            timestamp: Date.now()
          });
          
          try {
            // Force immediate detection regardless of throttling
            lastDetectionTimeRef.current = 0; // Reset to force immediate detection
            
            // Use centralized detection with timeline source identifier
            const detections = await requestDetection(video, 'timeline_selection');
            
            console.log('🎯 TIMELINE IMMEDIATE DETECTION RESULTS:', {
              detectionCount: detections.length,
              videoTime: video.currentTime.toFixed(3),
              detections: detections.slice(0, 3).map((d: any) => ({
                id: d.id,
                x: d.x.toFixed(3),
                y: d.y.toFixed(3),
                confidence: d.confidence.toFixed(2)
              }))
            });
            
            if (detections.length > 0) {
              console.log('🎯 TIMELINE BEFORE tracker.update():', {
                currentTrackerBox: trackerRef.current.getBox(),
                detectionsReceived: detections.length
              });
              
              // Update tracker with immediate detection results
              trackerRef.current.update(detections, video.videoWidth || 640, video.videoHeight || 480);
              
              const newBoxAfterUpdate = trackerRef.current.getBox();
              console.log('🎯 TIMELINE AFTER tracker.update():', {
                newTrackerBox: newBoxAfterUpdate,
                coordinatesChanged: true,
                timestamp: Date.now()
              });
              
              // Update React state immediately
              safeSetCurrentBoxState(prev => {
                if (!prev || prev.x !== newBoxAfterUpdate.x || prev.y !== newBoxAfterUpdate.y) {
                  console.log('📦 TIMELINE SELECTION CURRENTBOX UPDATE:', {
                    from: prev ? `${prev.x.toFixed(3)}, ${prev.y.toFixed(3)}` : 'null',
                    to: `${newBoxAfterUpdate.x.toFixed(3)}, ${newBoxAfterUpdate.y.toFixed(3)}`,
                    timestamp: Date.now()
                  });
                  return newBoxAfterUpdate;
                }
                return prev;
              });
              
              safeSetStatus('tracking');
              console.log('✅ TIMELINE SELECTION: Immediate tracking activated!');
            } else {
              console.log('⚠️ TIMELINE SELECTION: No detections found at current position');
            }
          } catch (error) {
            console.error('❌ TIMELINE SELECTION: Immediate detection failed:', error);
          }
        }
      };
      
      // **FIX INFINITE LOOP**: Create unique selection key to prevent repeated detection
      // Use player ID if available, otherwise serialize anchor coordinates
      const selectionKey = selectedPlayer?.id 
        ? `player_${selectedPlayer.id}`
        : `manual_${selectionAnchor.x}_${selectionAnchor.y}`;
      
      if (lastPlayerSelectionRef.current !== selectionKey) {
        console.log('🎯 NEW SELECTION: Triggering immediate detection', {
          previousKey: lastPlayerSelectionRef.current,
          currentKey: selectionKey,
          hasPlayerId: !!selectedPlayer?.id
        });
        lastPlayerSelectionRef.current = selectionKey;
        triggerImmediateDetection();
      } else {
        console.log('🔒 SKIPPING DETECTION: Same selection already processed', {
          selectionKey: selectionKey
        });
      }
    } else if (!selectionAnchor) {
      // **MAINTAIN NON-NULL**: Keep default box when no selection
      safeSetStatus('idle');
      lastPlayerSelectionRef.current = null; // Reset when no selection
      console.log('📦 MAINTAINING DEFAULT BOX - no selection anchor');
    }

    return () => {
      // **CLEANUP**: Clear timers and reset state on unmount
      if (detectionSchedulerRef.current) {
        clearTimeout(detectionSchedulerRef.current);
        detectionSchedulerRef.current = null;
      }
      if (lastUpdateLoopRef.current) {
        cancelAnimationFrame(lastUpdateLoopRef.current);
        lastUpdateLoopRef.current = null;
      }
    };
  }, [selectionAnchor]); // Reverted: removed options.selectedPlayer?.id to prevent infinite loop

  // **IMMEDIATE TRACKING START**: Start tracking as soon as player is selected
  useEffect(() => {
    const video = videoRef.current;
    const tracker = trackerRef.current;
    
    if (!video || !tracker || !selectionAnchor) return;
    
    // **ENHANCED VIDEO ELEMENT IDENTITY VERIFICATION**
    const videoId = video.getAttribute('data-video-id') || `video-${Date.now()}`;
    if (!video.getAttribute('data-video-id')) {
      video.setAttribute('data-video-id', videoId);
    }
    
    console.log('🎬🔍 ENHANCED VIDEO IDENTITY VERIFICATION:', {
      videoId,
      videoElement: video,
      tagName: video.tagName,
      className: video.className,
      src: video.src,
      srcShort: video.src ? video.src.substring(video.src.lastIndexOf('/') + 1) : 'NO_SOURCE',
      duration: video.duration || 'unknown',
      videoWidth: video.videoWidth || 'unknown',
      videoHeight: video.videoHeight || 'unknown',
      readyState: video.readyState,
      currentTime: video.currentTime.toFixed(2),
      paused: video.paused,
      ended: video.ended,
      parentElement: video.parentElement?.tagName || 'NO_PARENT',
      isConnected: video.isConnected,
      componentName: options?.componentName || 'unknown'
    });
    
    // **DIRECT EVENT LISTENERS**: Verify video element receives events
    const handlePlay = () => {
      console.log('🎵 DIRECT VIDEO EVENT - PLAY:', {
        videoId,
        currentTime: video.currentTime.toFixed(2),
        paused: video.paused,
        timestamp: Date.now()
      });
    };
    
    const handlePause = () => {
      console.log('⏸️ DIRECT VIDEO EVENT - PAUSE:', {
        videoId,
        currentTime: video.currentTime.toFixed(2),
        paused: video.paused,
        timestamp: Date.now()
      });
    };
    
    const handleTimeUpdate = () => {
      console.log('⏰ DIRECT VIDEO EVENT - TIME UPDATE:', {
        videoId,
        currentTime: video.currentTime.toFixed(2),
        paused: video.paused,
        readyState: video.readyState,
        timestamp: Date.now()
      });
    };
    
    // Add direct event listeners to verify video element functionality
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    
    console.log('🎬 Player selected - checking video readiness before starting tracking');
    
    // **ARCHITECT PRESCRIBED FIX**: Only start tracking if video is ALREADY ready
    // Otherwise, the loadedmetadata handler will start it when ready
    if (video.readyState >= 1) {
      console.log('✅ Video already ready (readyState >= HAVE_METADATA) - starting tracking NOW');
      const cleanupTracking = startVideoTracking();
      if (cleanupTracking) {
        console.log('✅ Tracking loop started successfully on player selection');
      } else {
        console.warn('⚠️ Failed to start tracking loop - requirements not met');
      }
    } else {
      console.log('⏳ Video not ready yet (readyState < HAVE_METADATA) - waiting for loadedmetadata event');
    }
    
    // **PERFORMANCE FIX**: Disabled auto-rebind interval to prevent lag
    // Auto-rebind is triggered by user interactions and video events instead
    
    return () => {
      // **CLEANUP EVENT LISTENERS**: Remove direct video event listeners
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      
      // Clean up on unmount or dependency change
      if (detectionSchedulerRef.current) {
        clearTimeout(detectionSchedulerRef.current);
        detectionSchedulerRef.current = null;
      }
      if (lastUpdateLoopRef.current) {
        cancelAnimationFrame(lastUpdateLoopRef.current);
        lastUpdateLoopRef.current = null;
      }
    };
  }, [videoRef, selectionAnchor, startVideoTracking]);
  
  // **ARCHITECT PRESCRIBED FIX**: Watch for videoRef.current becoming available, then start rVFC loop
  useEffect(() => {
    const video = videoRef.current;
    
    if (!video) {
      console.log('⏳ Video element not yet available - waiting...');
      return;
    }
    
    console.log('🎬 ARCHITECT FIX: Video element detected, setting up rVFC loop on loadedmetadata');
    
    let cleanupTracking: (() => void) | null = null;
    
    const handleLoadedMetadata = () => {
      console.log('✅ ARCHITECT FIX: Video metadata loaded - checking readiness', {
        readyState: video.readyState,
        hasSelectionAnchor: !!selectionAnchor,
        externalMode: options.externalMode
      });
      
      // **ARCHITECT PRESCRIBED**: Only start tracking when video is ready AND player is selected
      if (!options.externalMode && selectionAnchor) {
        console.log('🚀 ARCHITECT FIX: Video ready + player selected - starting tracking NOW');
        const trackingCleanup = startVideoTracking();
        
        if (trackingCleanup) {
          cleanupTracking = trackingCleanup;
          console.log('✅ ARCHITECT FIX: rVFC loop successfully started - spotlight will track selected player');
        } else {
          console.warn('⚠️ ARCHITECT FIX: startVideoTracking returned no cleanup function');
        }
      } else if (!selectionAnchor) {
        console.log('⏳ ARCHITECT FIX: Video ready but no player selected yet - waiting for selection');
      } else {
        console.log('ℹ️ ARCHITECT FIX: Skipping rVFC start - external mode active');
      }
    };
    
    // **ARCHITECT FIX**: Check readyState >= 1 (HAVE_METADATA), not >= 2
    // loadedmetadata event fires when readyState reaches 1
    if (video.readyState >= 1) {
      console.log('✅ ARCHITECT FIX: Video metadata already loaded - checking player selection');
      handleLoadedMetadata();
    } else {
      console.log('⏳ ARCHITECT FIX: Waiting for loadedmetadata event...');
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
    }
    
    return () => {
      console.log('🧹 ARCHITECT FIX: Cleaning up video tracking on element change');
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      if (cleanupTracking) {
        cleanupTracking();
      }
    };
  }, [videoRef, selectionAnchor, options.externalMode, startVideoTracking]);
  
  // **rVFC REBINDING FIX**: Monitor dynamicVideoRef changes and update activeVideoElement
  useEffect(() => {
    const currentDynamicVideo = dynamicVideoRef.current;
    if (currentDynamicVideo && currentDynamicVideo !== activeVideoElement) {
      console.log('🔄 dynamicVideoRef changed - updating activeVideoElement state');
      safeSetActiveVideoElement(currentDynamicVideo);
    }
  }, [activeVideoElement]);

  // **VIDEO STATE MANAGEMENT**: Handle video play/pause/seek
  useEffect(() => {
    // **rVFC REBINDING FIX**: Use active video element from state for proper rebinding
    const video = activeVideoElement || dynamicVideoRef.current || videoRef.current;
    if (!video) return;
    
    console.log('🔗 ATTACHING VIDEO EVENT LISTENERS:', {
      videoId: video.id || 'NO_ID',
      src: video.src?.slice(-30) || 'NO_SOURCE',
      currentTime: video.currentTime.toFixed(3),
      activeVideoElement: !!activeVideoElement,
      dynamicVideoRef: !!dynamicVideoRef.current,
      videoRef: !!videoRef.current
    });

    const handlePause = () => {
      console.log('⏸️ Video paused - stopping tracking system', {
        videoCurrentTime: video.currentTime.toFixed(2),
        videoDuration: video.duration || 'unknown',
        hasSelection: !!selectionAnchor
      });
      if (detectionSchedulerRef.current) {
        clearTimeout(detectionSchedulerRef.current);
        detectionSchedulerRef.current = null;
      }
      if (lastUpdateLoopRef.current) {
        cancelAnimationFrame(lastUpdateLoopRef.current);
        lastUpdateLoopRef.current = null;
      }
      
      // **ARCHITECT FIX**: Reset HighlightLock prediction timebase to prevent drift
      if (highlightLockRef.current) {
        highlightLockRef.current.resetPredictionTimebase();
        console.log('🔄 HighlightLock prediction timebase reset after pause');
      }
    };

    const handlePlay = () => {
      console.log('▶️ Video resumed - restarting tracking system', {
        videoCurrentTime: video.currentTime.toFixed(2),
        videoDuration: video.duration || 'unknown',
        hasSelection: !!selectionAnchor,
        hasTracker: !!trackerRef.current,
        willStartDetection: !!(selectionAnchor && trackerRef.current)
      });
      
      // **ARCHITECT FIX**: Reset HighlightLock prediction timebase to prevent drift
      if (highlightLockRef.current) {
        highlightLockRef.current.resetPredictionTimebase();
        console.log('🔄 HighlightLock prediction timebase reset after play');
      }
      
      if (selectionAnchor && trackerRef.current) {
        console.log('🚀 Starting rVFC tracking loop immediately');
        const cleanupTracking = startVideoTracking();
        if (cleanupTracking) {
          console.log('✅ rVFC tracking restarted after video play');
        }
      } else {
        console.log('⚠️ Cannot start tracking - missing selection or tracker');
      }
    };

    const handleSeeked = () => {
      // **PERFORMANCE FIX**: Only log significant seeks to prevent lag
      const isSignificantSeek = video.currentTime > 0;
      if (isSignificantSeek) {
        // Silent - reduced logging for performance
      }
      lastDetectionTimeRef.current = 0; // Force immediate detection on seek
      
      // **ARCHITECT FIX**: Reset HighlightLock prediction timebase to prevent drift
      if (highlightLockRef.current) {
        highlightLockRef.current.resetPredictionTimebase();
      }
    };

    // **EVENT LISTENERS**: Respond to video state changes
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handlePause);
    video.addEventListener('seeked', handleSeeked);

    return () => {
      console.log('🗑️ REMOVING VIDEO EVENT LISTENERS:', {
        videoId: video.id || 'NO_ID',
        src: video.src?.slice(-30) || 'NO_SOURCE'
      });
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handlePause);
      video.removeEventListener('seeked', handleSeeked);
    };
  // **rVFC REBINDING FIX**: Depend on activeVideoElement state to trigger rebinding
  }, [videoRef, activeVideoElement, selectionAnchor, startVideoTracking]);

  // **HIGHLIGHTLOCK DETECTION INGESTION**: Process detection results with intelligent tracking
  const ingestDetections = useCallback((payload: { players: DetectedPlayer[]; frameWidth: number; frameHeight: number; timestampMs: number }) => {
    const { players, frameWidth, frameHeight, timestampMs } = payload;
    
    // **CRITICAL FIX**: Allow detections to continue if HighlightLock is already tracking
    // This enables continued tracking during video playback even without selectionAnchor
    if (!selectionAnchor && !highlightLockRef.current) {
      console.warn('🚨 Cannot ingest detections: no selection anchor and no active HighlightLock');
      return;
    }
    
    // Normalize detection results with provided frame dimensions
    const normalizedPlayers = normalizeDetections(players, frameWidth, frameHeight);
    console.log(`📥 HighlightLock: Ingested ${normalizedPlayers.length} players from external detection`);
    
    // Convert DetectedPlayer format to HighlightLock Detection format
    const detections: Detection[] = normalizedPlayers.map((player, index) => {
      const detection = {
        id: player.id,
        centerX: player.centerX,
        centerY: player.centerY,
        x: player.topLeftX,
        y: player.topLeftY,
        width: player.width,
        height: player.height,
        confidence: player.confidence,
        timestamp: timestampMs
      };
      
      // Log first detection to verify coordinate handshake
      if (index === 0) {
        console.log('🔍 HANDSHAKE CHECK (Backend → HighlightLock):', {
          playerId: player.id,
          backend: { 
            centerX: player.centerX?.toFixed(3), 
            centerY: player.centerY?.toFixed(3),
            topLeftX: player.topLeftX?.toFixed(3),
            topLeftY: player.topLeftY?.toFixed(3)
          },
          highlightLock: {
            centerX: detection.centerX?.toFixed(3),
            centerY: detection.centerY?.toFixed(3),
            x: detection.x?.toFixed(3),
            y: detection.y?.toFixed(3)
          },
          match: player.centerX === detection.centerX && player.topLeftX === detection.x
        });
      }
      
      return detection;
    });
    
    // **HIGHLIGHTLOCK INITIALIZATION**: Create lock on first detection if needed
    if (!highlightLockRef.current && detections.length > 0 && selectionAnchor) {
      // **ID-LOCK PRIORITY**: If we have a selected player ID, find that specific player first
      const selectedPlayerId = options.selectedPlayer?.id;
      let targetDetection = null;
      
      if (selectedPlayerId) {
        // **CRITICAL FIX**: Look for the exact player ID that was selected
        targetDetection = detections.find(detection => detection.id === selectedPlayerId);
        
        if (targetDetection) {
          console.log(`🎯 ID-LOCK INITIALIZATION: Found selected player ${selectedPlayerId} in detections`);
        } else {
          console.warn(`⚠️ Selected player ${selectedPlayerId} not found in current detections, falling back to proximity search`);
        }
      }
      
      // **FALLBACK**: If no ID match or no selected player, find closest to selection anchor
      if (!targetDetection) {
        const distances = detections.map(detection => {
          const dx = detection.centerX - selectionAnchor.x;
          const dy = detection.centerY - selectionAnchor.y;
          return { detection, distance: Math.sqrt(dx * dx + dy * dy) };
        });
        
        distances.sort((a, b) => a.distance - b.distance);
        const bestMatch = distances[0];
        
        if (bestMatch.distance < 0.2) { // 20% of frame size threshold
          targetDetection = bestMatch.detection;
        } else {
          console.warn('⚠️ No detection close enough to selection anchor:', {
            closestDistance: bestMatch.distance.toFixed(3),
            threshold: 0.2,
            selectionAnchor
          });
          return;
        }
      }
      
      if (targetDetection) {
        // **CRITICAL FIX**: Use the actual detection ID as masterId, not a generated one!
        // This allows HighlightLock to match future detections by ID
        const masterId = targetDetection.id;
        highlightLockRef.current = new HighlightLock(masterId, targetDetection);
        console.log('✅ HIGHLIGHTLOCK CREATED:', {
          masterId,
          initialBox: {
            x: targetDetection.x.toFixed(3),
            y: targetDetection.y.toFixed(3),
            width: targetDetection.width.toFixed(3),
            height: targetDetection.height.toFixed(3)
          },
          timestamp: timestampMs
        });
      } else {
        console.error('❌ HIGHLIGHTLOCK CREATION FAILED: No target detection found');
      }
    } else {
      if (highlightLockRef.current) {
        console.log('ℹ️ HighlightLock already exists, will update with new detections');
      }
    }
    
    // **HIGHLIGHTLOCK UPDATE**: Feed all detections to the intelligent tracker
    if (highlightLockRef.current) {
      // **ENSURE ID-LOCK CONFIGURATION**: HighlightLock tracks via detection matching
      const selectedPlayerId = options.selectedPlayer?.id;
      const previousActiveState = highlightLockRef.current.isActive;
      
      const beforeVel = (highlightLockRef.current as any).motionState;
      const masterId = (highlightLockRef.current as any).masterId;
      const detectionIds = detections.map(d => d.id).join(', ');
      
      const updatedBox = highlightLockRef.current.update(detections, timestampMs);
      const afterVel = (highlightLockRef.current as any).motionState;
      
      console.log(`📥 DETECTION UPDATE: masterId="${masterId}", detectionIds=[${detectionIds}], detections=${detections.length}, vel before=[${beforeVel?.velocityX?.toFixed(5)}, ${beforeVel?.velocityY?.toFixed(5)}], vel after=[${afterVel?.velocityX?.toFixed(5)}, ${afterVel?.velocityY?.toFixed(5)}]`);
      const newActiveState = highlightLockRef.current.isActive;
      
      safeSetStatus('tracking');
      safeSetLastDetectionAge(0);
      lastDetectionTimeRef.current = timestampMs;
      
      // **CRITICAL**: Update currentBox state with HighlightLock result
      // **🚨 ANTI-FLIP GUARD 🚨**: ALWAYS preserve centerX/centerY from HighlightLock
      if (updatedBox) {
        safeSetCurrentBoxState(prev => {
          const newBox = {
            x: updatedBox.x,
            y: updatedBox.y,
            width: updatedBox.width,
            height: updatedBox.height,
            centerX: updatedBox.centerX,  // **FIX**: Preserve backend centerX!
            centerY: updatedBox.centerY   // **FIX**: Preserve backend centerY!
          };
          
          // **🚨 VALIDATION 🚨**: Ensure centerX/centerY are preserved and not flipped
          assertCenterCoordinatesPresent(newBox, 'useSpotlightTracker.handleDetections() -> currentBoxState');
          validateNoFlip(newBox, 'useSpotlightTracker.handleDetections() -> currentBoxState');
          
          if (!prev || prev.x !== newBox.x || prev.y !== newBox.y || prev.width !== newBox.width || prev.height !== newBox.height) {
            return newBox;
          }
          return prev;
        });
      }
    }
    
    // **LEGACY COMPATIBILITY**: Also feed to old tracker if it exists
    if (trackerRef.current) {
      const selectedPlayerId = options.selectedPlayer?.id;
      const filteredPlayers = selectedPlayerId 
        ? normalizedPlayers.filter(player => player.id === selectedPlayerId)
        : normalizedPlayers;
      trackerRef.current.update(filteredPlayers, frameWidth, frameHeight);
      
      // **AUTO-EXIT MANUAL MODE**: Resume tracking when fresh detections arrive
      const trackerStatus = trackerRef.current.getEnhancedStatus();
      if (trackerStatus.mode === 'manual' && filteredPlayers.length > 0) {
        trackerRef.current.exitManualMode();
        console.log('🤖 AUTO-EXITED manual mode - fresh detections received');
      }
    }
  }, [selectionAnchor, options.selectedPlayer?.id]);

  // **MANUAL OVERRIDE**: Allow user to manually correct tracking position
  const manualOverride = useCallback((position: { x: number; y: number }) => {
    if (trackerRef.current) {
      trackerRef.current.setManualOverride(position);
      console.log('🎯 Manual override applied:', position);
    }
  }, []);

  // **CRITICAL FIX**: Enter manual mode for UI triggering
  const enterManualMode = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.enterManualMode();
    }
  }, []);

  // **NEW**: Exit manual mode and resume automatic tracking
  const exitManualMode = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.exitManualMode();
    }
  }, []);

  // **RESET TRACKING**: Reset tracker state
  const resetTracking = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.reset();
      safeSetStatus('idle');
      safeSetTrackingStatus({
        mode: 'idle',
        confidence: 0,
        fallbackActive: false,
        detectionAge: 0,
        trackingStability: 1.0,
        velocityMagnitude: 0,
        canManuallyOverride: false
      });
      console.log('🔄 Tracking reset');
    }
  }, []);

  // **ARCHITECT FIX**: Use reactive state for currentBox with guaranteed non-null fallback
  const currentBoxBase = currentBoxState || clampBox(DEFAULT_CENTER_X, DEFAULT_CENTER_Y, DEFAULT_BOX_WIDTH, DEFAULT_BOX_HEIGHT);
  
  // **SURGICAL FIX**: Merge trackingStatus.confidence into currentBox for SpotlightOverlay
  const currentBox = currentBoxBase ? {
    ...currentBoxBase,
    confidence: trackingStatus.confidence // Numeric 0-1, NOT formatted string
  } : null;
  
  // CurrentBox is guaranteed non-null via fallback
  prevBoxRef.current = currentBoxBase;
  
  // **ARCHITECT FIX**: Auto-rebind to playing video by comparing currentTime deltas  
  const autoRebindToActiveVideo = useCallback(() => {
    const allVideos = Array.from(document.querySelectorAll('video'));
    const currentVideo = dynamicVideoRef.current || videoRef.current;
    
    // Store previous time to detect advancement
    const now = performance.now();
    
    // Check all videos for time advancement
    const videoStates = allVideos.map((video, index) => {
      const lastTime = parseFloat(video.dataset.lastTrackedTime || '0');
      const lastCheck = parseFloat(video.dataset.lastCheckTimestamp || '0');
      const timeDelta = video.currentTime - lastTime;
      const timeSinceLastCheck = now - lastCheck;
      
      // Update tracking data
      video.dataset.lastTrackedTime = video.currentTime.toString();
      video.dataset.lastCheckTimestamp = now.toString();
      
      const isAdvancing = timeDelta > 0.01 && timeSinceLastCheck > 100; // Advanced and enough time passed
      const isPlaying = !video.paused && !video.ended && video.currentTime > 0;
      
      return {
        index,
        video,
        currentTime: video.currentTime,
        timeDelta: timeDelta.toFixed(3),
        isAdvancing,
        isPlaying,
        readyState: video.readyState,
        isCurrentlyTracked: video === currentVideo,
        score: (isAdvancing ? 2 : 0) + (isPlaying ? 1 : 0) + (video.readyState >= 3 ? 1 : 0)
      };
    });
    
    console.log('🔍 AUTO-REBIND SCAN:', {
      totalVideos: allVideos.length,
      currentVideoIndex: currentVideo ? allVideos.indexOf(currentVideo) : -1,
      videoStates: videoStates.map(s => ({
        index: s.index,
        currentTime: s.currentTime.toFixed(3),
        timeDelta: s.timeDelta,
        isAdvancing: s.isAdvancing,
        isPlaying: s.isPlaying,
        isTracked: s.isCurrentlyTracked,
        score: s.score
      })),
      timestamp: now
    });
    
    // Find best video candidate (highest score)
    const bestCandidate = videoStates.filter(s => s.score > 0).sort((a, b) => b.score - a.score)[0];
    
    if (bestCandidate && !bestCandidate.isCurrentlyTracked) {
      const oldVideo = currentVideo;
      dynamicVideoRef.current = bestCandidate.video;
      
      // **rVFC REBINDING FIX**: Update active video element state to trigger event listener rebinding
      safeSetActiveVideoElement(bestCandidate.video);
      
      console.log('✅ AUTO-REBIND SUCCESS: Rebinded to better video:', {
        oldVideo: oldVideo ? {
          index: allVideos.indexOf(oldVideo),
          currentTime: oldVideo.currentTime.toFixed(3),
          paused: oldVideo.paused
        } : null,
        newVideo: {
          index: bestCandidate.index,
          currentTime: bestCandidate.currentTime.toFixed(3),
          paused: bestCandidate.video.paused,
          src: bestCandidate.video.src?.slice(-30) || 'NO_SOURCE',
          score: bestCandidate.score,
          reason: bestCandidate.isAdvancing ? 'advancing' : 'playing'
        },
        rebindReason: 'automatic_time_delta_detection',
        timestamp: now
      });
      
      // **rVFC REBINDING FIX**: Restart rVFC loop on new video element
      if (selectionAnchor && trackerRef.current && typeof bestCandidate.video.requestVideoFrameCallback === 'function') {
        console.log('🔄 RESTARTING rVFC LOOP on new video element after rebind');
        const cleanupTracking = startVideoTracking();
        if (cleanupTracking) {
          console.log('✅ rVFC loop successfully restarted on new video element');
        } else {
          console.warn('⚠️ Failed to restart rVFC loop on new video element');
        }
      }
      
      // Trigger overlay refresh after rebind
      if (trackerRef.current) {
        console.log('🔄 TRIGGERING OVERLAY REFRESH after rebind');
        // Force immediate detection on new video
        lastDetectionTimeRef.current = 0;
      }
      
      return bestCandidate.video;
    } else if (bestCandidate?.isCurrentlyTracked) {
      console.log('✅ AUTO-REBIND: Already tracking best video:', {
        videoIndex: bestCandidate.index,
        score: bestCandidate.score
      });
    } else {
      console.log('⚠️ AUTO-REBIND: No suitable video found:', {
        allVideosCount: allVideos.length,
        playingCount: videoStates.filter(s => s.isPlaying).length,
        advancingCount: videoStates.filter(s => s.isAdvancing).length
      });
    }
    
    return currentVideo;
  }, []);
  
  // **LEGACY**: Keep force rebind for manual triggering
  const forceRebindToActiveVideo = useCallback(() => {
    console.log('🔄 FORCE REBIND: Manual trigger - delegating to auto-rebind');
    return autoRebindToActiveVideo();
  }, [autoRebindToActiveVideo]);
  
  const getCurrentVideoInfo = useCallback(() => {
    const currentVideo = dynamicVideoRef.current || videoRef.current;
    if (!currentVideo) return null;
    
    return {
      element: currentVideo,
      currentTime: currentVideo.currentTime,
      paused: currentVideo.paused,
      ended: currentVideo.ended,
      readyState: currentVideo.readyState,
      src: currentVideo.src,
      videoWidth: currentVideo.videoWidth,
      videoHeight: currentVideo.videoHeight,
      isDynamic: currentVideo === dynamicVideoRef.current
    };
  }, []);
  
  const getAllVideoInfo = useCallback(() => {
    const allVideos = Array.from(document.querySelectorAll('video'));
    return allVideos.map((video, index) => ({
      index,
      id: video.id || `video-${index}`,
      currentTime: video.currentTime,
      paused: video.paused,
      ended: video.ended,
      readyState: video.readyState,
      src: video.src,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      isOriginalRef: video === videoRef.current,
      isDynamicRef: video === dynamicVideoRef.current,
      parentContainer: video.parentElement?.className || 'NO_PARENT'
    }));
  }, []);

  // **CRITICAL LOGGING**: Track video element connection and monitor state changes
  useEffect(() => {
    const video = videoRef.current;
    
    // **CRITICAL FIX**: Scan ALL video elements in DOM to identify the multiple video issue
    const allVideos = Array.from(document.querySelectorAll('video'));
    console.log('🎥 ALL VIDEO ELEMENTS FOUND IN DOM:', allVideos.map((v, index) => ({
      index,
      id: v.id || 'NO_ID',
      className: v.className || 'NO_CLASS',
      src: v.src ? v.src.slice(-30) : 'NO_SOURCE',
      currentTime: v.currentTime.toFixed(2),
      duration: v.duration ? v.duration.toFixed(2) : 'UNKNOWN',
      paused: v.paused,
      ended: v.ended,
      readyState: v.readyState,
      videoWidth: v.videoWidth || 'NO_WIDTH',
      videoHeight: v.videoHeight || 'NO_HEIGHT',
      parentClass: v.parentElement?.className || 'NO_PARENT_CLASS',
      isConnectedToTracker: v === video,
      style: {
        display: getComputedStyle(v).display,
        visibility: getComputedStyle(v).visibility,
        position: getComputedStyle(v).position,
        zIndex: getComputedStyle(v).zIndex
      }
    })));
    
    if (video) {
      console.log('🎥🎥🎥 SPOTLIGHT TRACKER VIDEO ELEMENT CONNECTED 🎥🎥🎥:', {
        component: options.componentName || 'Unknown',
        totalVideosInDOM: allVideos.length,
        videoElement: {
          id: video.id || 'NO_ID_ASSIGNED',
          className: video.className || 'NO_CLASS_ASSIGNED',
          src: video.src || 'NO_SOURCE',
          srcShort: video.src ? video.src.substring(video.src.lastIndexOf('/') + 1) : 'NO_SOURCE',
          currentTime: video.currentTime.toFixed(2),
          duration: video.duration ? video.duration.toFixed(2) : 'UNKNOWN_DURATION',
          paused: video.paused,
          ended: video.ended,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          parentElementTag: video.parentElement?.tagName || 'NO_PARENT',
          parentElementClass: video.parentElement?.className || 'NO_PARENT_CLASS',
          elementIndex: allVideos.indexOf(video)
        },
        externalMode: options.externalMode || false,
        timestamp: Date.now()
      });
      
      // **ENHANCED VIDEO STATE MONITORING**: Track real-time video state changes + MULTIPLE VIDEO DETECTION
      let lastCurrentTime = video.currentTime;
      let lastPausedState = video.paused;
      let stateCheckCount = 0;
      
      const monitorVideoState = () => {
        stateCheckCount++;
        const currentTimeChanged = video.currentTime !== lastCurrentTime;
        const pausedStateChanged = video.paused !== lastPausedState;
        
        // **CRITICAL**: Every 5 checks, scan all video elements to find which one is actually playing
        if (stateCheckCount % 5 === 0) {
          const allVideos = Array.from(document.querySelectorAll('video'));
          const playingVideos = allVideos.filter(v => !v.paused && v.currentTime > 0);
          const advancingVideos = allVideos.filter(v => {
            const stored = v.dataset.lastTime ? parseFloat(v.dataset.lastTime) : v.currentTime;
            const isAdvancing = v.currentTime !== stored;
            v.dataset.lastTime = v.currentTime.toString();
            return isAdvancing && !v.paused;
          });
          
          console.log('🔍 MULTIPLE VIDEO ELEMENT DETECTION (During Playback):', {
            component: options.componentName || 'Unknown',
            totalVideos: allVideos.length,
            playingVideos: playingVideos.length,
            advancingVideos: advancingVideos.length,
            trackerConnectedTo: {
              currentTime: video.currentTime.toFixed(3),
              paused: video.paused,
              isAdvancing: currentTimeChanged,
              elementIndex: allVideos.indexOf(video)
            },
            allVideoStates: allVideos.map((v, idx) => ({
              index: idx,
              id: v.id || `video-${idx}`,
              currentTime: v.currentTime.toFixed(3),
              paused: v.paused,
              ended: v.ended,
              readyState: v.readyState,
              isTrackerVideo: v === video,
              parentContainer: v.parentElement?.className?.slice(0, 30) || 'NO_PARENT'
            })),
            activelyPlayingVideo: playingVideos.length > 0 ? {
              index: allVideos.indexOf(playingVideos[0]),
              currentTime: playingVideos[0].currentTime.toFixed(3),
              isTrackerVideo: playingVideos[0] === video
            } : null,
            shouldRebind: playingVideos.length > 0 && !playingVideos.includes(video)
          });
          
          // **CRITICAL FIX**: Auto-rebind if we detect tracker is connected to wrong video
          if (playingVideos.length > 0 && !playingVideos.includes(video)) {
            console.warn('🚨 TRACKER BOUND TO WRONG VIDEO! Auto-rebinding to playing video...');
            dynamicVideoRef.current = playingVideos[0];
            console.log('✅ Tracker rebinded to playing video:', {
              newVideo: {
                index: allVideos.indexOf(playingVideos[0]),
                currentTime: playingVideos[0].currentTime.toFixed(3),
                paused: playingVideos[0].paused
              }
            });
          }
        }
        
        if (currentTimeChanged || pausedStateChanged || stateCheckCount % 10 === 0) {
          console.log('📺 REAL-TIME VIDEO STATE MONITOR:', {
            component: options.componentName || 'Unknown',
            checkNumber: stateCheckCount,
            currentTime: video.currentTime.toFixed(2),
            currentTimeChanged,
            lastCurrentTime: lastCurrentTime.toFixed(2),
            isPaused: video.paused,
            pausedStateChanged,
            lastPausedState,
            isEnded: video.ended,
            readyState: video.readyState,
            srcShort: video.src ? video.src.substring(video.src.lastIndexOf('/') + 1) : 'NO_SOURCE',
            timestamp: Date.now()
          });
        }
        
        lastCurrentTime = video.currentTime;
        lastPausedState = video.paused;
      };
      
      // **PERFORMANCE FIX**: Disabled continuous monitoring to prevent lag
      // Video state changes are tracked via event listeners instead
      
      // **EVENT LISTENER DEBUGGING**: Monitor when video events fire
      const eventListeners = {
        play: (e: Event) => {
          console.log('🎬 VIDEO EVENT: PLAY fired on tracker video:', {
            component: options.componentName || 'Unknown',
            currentTime: video.currentTime.toFixed(2),
            paused: video.paused,
            srcShort: video.src ? video.src.substring(video.src.lastIndexOf('/') + 1) : 'NO_SOURCE',
            eventType: e.type,
            timestamp: Date.now()
          });
          
          // **EXTERNAL MODE FIX**: Skip loop restart in external mode
          if (options.externalMode) {
            console.log('🔌 VIDEO PLAY EVENT: Skipping rVFC restart (external mode - no internal loops)');
            return;
          }
          
          // **CRITICAL FIX**: Restart rVFC loop when video starts playing (internal mode only)
          console.log('🚀 VIDEO PLAY EVENT: Restarting rVFC tracking loop');
          if (video && !video.paused && video.readyState >= 2) {
            const restartedCleanup = startUnifiedTrackingLoop();
            if (typeof restartedCleanup === 'function') {
              // Update cleanup function for this video
              cleanupRef.current = restartedCleanup;
              console.log('✅ rVFC loop successfully restarted on PLAY event');
            }
          }
        },
        pause: (e: Event) => {
          console.log('⏸️ VIDEO EVENT: PAUSE fired on tracker video:', {
            component: options.componentName || 'Unknown',
            currentTime: video.currentTime.toFixed(2),
            paused: video.paused,
            srcShort: video.src ? video.src.substring(video.src.lastIndexOf('/') + 1) : 'NO_SOURCE',
            eventType: e.type,
            timestamp: Date.now()
          });
          
          // **PAUSE OPTIMIZATION**: Stop rVFC when paused to save resources
          console.log('⏸️ VIDEO PAUSE EVENT: Stopping rVFC, switching to fallback detection');
        },
        timeupdate: (e: Event) => {
          // **PERFORMANCE FIX**: Only log timeupdate events during active playback to prevent lag
          // Browsers fire timeupdate even when paused, causing excessive logging
          if (!video.paused && video.currentTime > 0) {
            // Silent - no logging during normal playback
          }
        }
      };
      
      // Add debug event listeners
      video.addEventListener('play', eventListeners.play);
      video.addEventListener('pause', eventListeners.pause);
      video.addEventListener('timeupdate', eventListeners.timeupdate);
      
      // **CRITICAL FIX**: Start tracking immediately if video is already playing
      // This handles the case where event listeners are added after video has started
      if (!options.externalMode && video && !video.paused && video.readyState >= 2) {
        console.log('🚀 VIDEO ALREADY PLAYING: Starting rVFC tracking loop immediately', {
          component: options.componentName || 'Unknown',
          currentTime: video.currentTime.toFixed(2),
          paused: video.paused,
          readyState: video.readyState,
          timestamp: Date.now()
        });
        const initialCleanup = startUnifiedTrackingLoop();
        if (typeof initialCleanup === 'function') {
          cleanupRef.current = initialCleanup;
          console.log('✅ rVFC loop started successfully on mount (video already playing)');
        }
      }
      
      return () => {
        if (videoElementDetectionRef.current) {
          clearInterval(videoElementDetectionRef.current);
        }
        video.removeEventListener('play', eventListeners.play);
        video.removeEventListener('pause', eventListeners.pause);
        video.removeEventListener('timeupdate', eventListeners.timeupdate);
      };
    } else {
      console.error('❌❌❌ SPOTLIGHT TRACKER: NO VIDEO ELEMENT CONNECTED! ❌❌❌', {
        component: options.componentName || 'Unknown',
        videoRefCurrent: videoRef.current,
        timestamp: Date.now()
      });
    }
  }, [videoRef, options.componentName, options.externalMode, options.deferAutoSeek]);
  
  // **ENHANCED ID LOOKUP WITH TEMPORAL STABILITY**: Store recent valid boxes for smoothing
  const lastValidBoxRef = useRef<{[playerId: string]: { box: BoundingBox; timestamp: number }}>({});
  const boxStabilityTimerRef = useRef<{[playerId: string]: number}>({});
  
  // **PER-FRAME ID LOOKUP**: Enhanced player tracking with temporal stability
  const getBoxByIdAtTime = useCallback((selectedPlayerId: string, sampleTime: number) => {
    const video = videoRef.current;
    if (!video) {
      return {
        box: null,
        boxTimestamp: null,
        timeDelta: 0,
        found: false,
        reason: 'no_video_element'
      };
    }

    const currentVideoTime = video.currentTime;
    const timeDelta = Math.abs(sampleTime - currentVideoTime);
    
    // **FIX: Backwards Prediction Bug (Oct 20, 2025)**
    // When video time is BEFORE detection time, use anchor coordinates directly
    // Velocity prediction backwards in time is wildly inaccurate and lands on wrong side of field!
    if (currentVideoTime < sampleTime && selectionAnchor) {
      // Use anchor center point with default dimensions (selectionAnchor only has x,y center coordinates)
      const anchorBox = {
        x: selectionAnchor.x - 0.025, // Convert center to top-left (assume ~5% width)
        y: selectionAnchor.y - 0.075, // Convert center to top-left (assume ~15% height)
        width: 0.05,
        height: 0.15,
        centerX: selectionAnchor.x, // Preserve canonical center coordinates
        centerY: selectionAnchor.y,
        id: selectedPlayerId
      };
      
      console.log(`🎯 getBoxByIdAtTime: USING ANCHOR (before detection time) for ${selectedPlayerId}:`, {
        sampleTime: sampleTime.toFixed(3),
        currentVideoTime: currentVideoTime.toFixed(3),
        timeDelta: timeDelta.toFixed(3),
        boxCoordinates: `(${anchorBox.x.toFixed(3)}, ${anchorBox.y.toFixed(3)})`,
        origin: 'selection_anchor_direct'
      });
      
      return {
        box: anchorBox,
        boxTimestamp: sampleTime,
        timeDelta: timeDelta,
        found: true,
        reason: 'anchor_direct'
      };
    }
    
    // **LIVE TIMEBASE**: Use current HighlightLock PREDICTED state (with velocity!)
    const highlightLock = highlightLockRef.current;
    if (highlightLock) {
      // **CRITICAL FIX**: Use tickPredict() to get LIVE predicted box with velocity
      const currentTime = Date.now();
      const predictedBox = highlightLock.tickPredict(currentTime);
      
      // **ID-LOCK MATCH**: Return current box if prediction available
      if (predictedBox) {
        const currentBox = predictedBox;
        // **COORDINATE CANONICALIZATION**: Ensure normalized top-left coordinates
        const canonicalBox = {
          x: Math.max(0, Math.min(1, currentBox.x)), // Clamp to [0,1] normalized
          y: Math.max(0, Math.min(1, currentBox.y)),
          width: Math.max(0, Math.min(1, currentBox.width)),
          height: Math.max(0, Math.min(1, currentBox.height)),
          centerX: currentBox.centerX, // Preserve canonical center coordinates
          centerY: currentBox.centerY,
          id: currentBox.id
        };
        
        // **STABILITY ENHANCEMENT**: Store as last valid box and reset stability timer
        lastValidBoxRef.current[selectedPlayerId] = {
          box: canonicalBox,
          timestamp: currentVideoTime
        };
        boxStabilityTimerRef.current[selectedPlayerId] = Date.now();
        
        console.log(`🎯 getBoxByIdAtTime: LIVE PREDICTION for ${selectedPlayerId}:`, {
          sampleTime: sampleTime.toFixed(3),
          currentVideoTime: currentVideoTime.toFixed(3),
          timeDelta: timeDelta.toFixed(3),
          boxCoordinates: `(${canonicalBox.x.toFixed(3)}, ${canonicalBox.y.toFixed(3)})`,
          centerCoords: `(${canonicalBox.centerX?.toFixed(3) || 'N/A'}, ${canonicalBox.centerY?.toFixed(3) || 'N/A'})`,
          origin: 'highlightlock_tickPredict_with_velocity'
        });
        
        const result = {
          box: canonicalBox,
          boxTimestamp: currentVideoTime,
          timeDelta,
          found: true
        };
        
        // Log handshake to SpotlightOverlay (throttled to reduce console spam)
        if (Math.random() < 0.05) { // Only log 5% of frames
          console.log('🔍 HANDSHAKE CHECK (HighlightLock → SpotlightOverlay):', {
            playerId: selectedPlayerId,
            highlightLock: {
              centerX: canonicalBox.centerX?.toFixed(3),
              centerY: canonicalBox.centerY?.toFixed(3),
              x: canonicalBox.x?.toFixed(3),
              y: canonicalBox.y?.toFixed(3),
              width: canonicalBox.width?.toFixed(3),
              height: canonicalBox.height?.toFixed(3)
            },
            sampleTime: sampleTime.toFixed(3),
            isPredicted: true
          });
        }
        
        return result;
      }
      
      // **TEMPORAL STABILITY FALLBACK**: Use last valid box if recently seen and within tolerance
      const lastValid = lastValidBoxRef.current[selectedPlayerId];
      const stabilityTimer = boxStabilityTimerRef.current[selectedPlayerId];
      const now = Date.now();
      
      if (lastValid && stabilityTimer && (now - stabilityTimer) < 1000) { // 1 second grace period
        const ageSeconds = (currentVideoTime - lastValid.timestamp);
        
        // **TEMPORAL TOLERANCE**: Allow up to 2 seconds of missing data
        if (Math.abs(ageSeconds) < 2.0) {
          console.log(`🔄 getBoxByIdAtTime: TEMPORAL FALLBACK for ${selectedPlayerId}:`, {
            selectedPlayerId,
            ageSeconds: ageSeconds.toFixed(3),
            fallbackCoords: `(${lastValid.box.x.toFixed(3)}, ${lastValid.box.y.toFixed(3)})`,
            reason: 'temporal_stability_fallback'
          });
          
          return {
            box: lastValid.box,
            boxTimestamp: lastValid.timestamp,
            timeDelta: Math.abs(sampleTime - lastValid.timestamp),
            found: true,
            reason: 'temporal_fallback'
          };
        }
      }
      
      // **NO PREDICTION AVAILABLE**: HighlightLock couldn't predict (confidence too low or missing data)
      console.log(`🚫 getBoxByIdAtTime: NO PREDICTION for ${selectedPlayerId}:`, {
        selectedPlayerId,
        sampleTime: sampleTime.toFixed(3),
        hasLastValid: !!lastValid,
        reason: 'prediction_unavailable'
      });
      
      return {
        box: null,
        boxTimestamp: null,
        timeDelta,
        found: false,
        reason: 'player_not_in_current_frame'
      };
    }
    
    return {
      box: null,
      boxTimestamp: null,
      timeDelta,
      found: false,
      reason: 'no_tracker_available'
    };
  }, [videoRef]);

  return {
    currentBox,
    status,
    trackingStatus,
    lastDetectionAge,
    ingestDetections,
    manualOverride,
    enterManualMode,
    exitManualMode,
    resetTracking,
    forceRebindToActiveVideo,
    autoRebindToActiveVideo,
    getCurrentVideoInfo,
    getAllVideoInfo,
    immediateTimelineDetection,
    debugDataFlowPipeline,
    getBoxByIdAtTime
  };
}