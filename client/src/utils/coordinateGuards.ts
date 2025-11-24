/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COORDINATE SYSTEM GUARDRAILS - PREVENT HORIZONTAL FLIPPING
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * CRITICAL RULE: COORDINATES MUST NEVER BE HORIZONTALLY FLIPPED
 * 
 * Our canonical coordinate system:
 * - Origin (0, 0) is at TOP-LEFT corner of video frame
 * - X-axis increases from LEFT → RIGHT
 * - Y-axis increases from TOP → BOTTOM
 * - All coordinates are normalized to [0, 1] range
 * 
 * COORDINATE DEFINITIONS:
 * - x, y: Top-left corner of bounding box (NOT center)
 * - centerX, centerY: Geometric center of bounding box
 * - width, height: Dimensions of bounding box
 * - topLeftX = x, topLeftY = y (redundant but explicit for clarity)
 * 
 * RELATIONSHIPS (MUST ALWAYS BE TRUE):
 * - centerX = x + (width / 2)
 * - centerY = y + (height / 2)
 * - topLeftX = x
 * - topLeftY = y
 * 
 * COORDINATE FLOW (1:1 handshake, NO transformations):
 * 1. Replicate Backend → returns centerX, centerY, topLeftX, topLeftY
 * 2. Backend Spatial Tracking → preserves all coordinates
 * 3. HighlightLock → preserves all coordinates
 * 4. useSpotlightTracker currentBoxState → preserves all coordinates
 * 5. SpotlightOverlay → renders using centerX/centerY directly
 * 
 * ⚠️ NEVER DO THIS:
 * - flippedX = 1 - x                    // ❌ WRONG! Creates opposite-side bug
 * - flippedCenterX = 1 - centerX        // ❌ WRONG! Creates opposite-side bug
 * - transform: scaleX(-1)               // ❌ WRONG! CSS flip
 * - Subtracting from 1, width, or 100   // ❌ WRONG! Any horizontal inversion
 * 
 * ✅ ALWAYS DO THIS:
 * - Use coordinates exactly as received from backend
 * - Preserve centerX, centerY through entire pipeline
 * - Convert normalized → pixels using: pixelX = renderBox.x + (normalizedX * renderBox.width)
 * - Never modify X coordinates during coordinate flow
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX?: number;
  centerY?: number;
  topLeftX?: number;
  topLeftY?: number;
}

/**
 * Validate that a bounding box has not been horizontally flipped
 * 
 * This function checks mathematical relationships between coordinates
 * to detect if flipping has occurred.
 * 
 * @param box - Bounding box to validate
 * @param stage - Pipeline stage for error reporting
 * @returns true if coordinates are valid, false if flipping detected
 */
export function validateNoFlip(box: BoundingBox, stage: string): boolean {
  // Skip validation if box is incomplete
  if (!box || box.x === undefined || box.width === undefined) {
    return true; // Can't validate, assume OK
  }

  const errors: string[] = [];
  
  // Check 1: Verify centerX = x + width/2 (within tolerance)
  if (box.centerX !== undefined) {
    const expectedCenterX = box.x + (box.width / 2);
    const tolerance = 0.01; // 1% tolerance for floating point errors
    
    if (Math.abs(box.centerX - expectedCenterX) > tolerance) {
      errors.push(
        `centerX mismatch: got ${box.centerX.toFixed(3)}, expected ${expectedCenterX.toFixed(3)} ` +
        `(x=${box.x.toFixed(3)} + width/2=${(box.width/2).toFixed(3)})`
      );
    }
  }
  
  // Check 2: Verify topLeftX matches x
  if (box.topLeftX !== undefined) {
    if (Math.abs(box.topLeftX - box.x) > 0.001) {
      errors.push(
        `topLeftX ≠ x: topLeftX=${box.topLeftX.toFixed(3)}, x=${box.x.toFixed(3)}`
      );
    }
  }
  
  // Check 3: Detect suspicious coordinate inversions
  // If centerX > 0.9 but x < 0.1, likely flipped (or vice versa)
  if (box.centerX !== undefined) {
    const centerIsLeft = box.centerX < 0.1;
    const centerIsRight = box.centerX > 0.9;
    const topLeftIsLeft = box.x < 0.1;
    const topLeftIsRight = box.x > 0.9;
    
    if ((centerIsLeft && topLeftIsRight) || (centerIsRight && topLeftIsLeft)) {
      errors.push(
        `Suspicious: centerX and x on opposite sides! ` +
        `centerX=${box.centerX.toFixed(3)}, x=${box.x.toFixed(3)}`
      );
    }
  }
  
  // Report errors
  if (errors.length > 0) {
    console.error(`🚨 COORDINATE FLIP DETECTED at stage: ${stage}`);
    console.error('📊 Box data:', {
      x: box.x?.toFixed(3),
      y: box.y?.toFixed(3),
      width: box.width?.toFixed(3),
      height: box.height?.toFixed(3),
      centerX: box.centerX?.toFixed(3),
      centerY: box.centerY?.toFixed(3),
      topLeftX: box.topLeftX?.toFixed(3),
      topLeftY: box.topLeftY?.toFixed(3)
    });
    console.error('❌ Validation errors:', errors);
    console.error('⚠️ HORIZONTAL FLIP DETECTED! Coordinates have been transformed incorrectly!');
    console.error('⚠️ Review code at stage:', stage);
    
    return false;
  }
  
  return true;
}

/**
 * Assert that centerX/centerY are present in a bounding box
 * 
 * The backend provides centerX/centerY. If they're missing, it means
 * they were stripped somewhere in the pipeline.
 * 
 * @param box - Bounding box to check
 * @param stage - Pipeline stage for error reporting
 */
export function assertCenterCoordinatesPresent(box: BoundingBox | null | undefined, stage: string): void {
  if (!box) return;
  
  if (box.centerX === undefined || box.centerY === undefined) {
    console.warn(`⚠️ CENTER COORDINATES MISSING at stage: ${stage}`);
    console.warn('📊 Box data:', {
      hasCenterX: box.centerX !== undefined,
      hasCenterY: box.centerY !== undefined,
      hasX: box.x !== undefined,
      hasY: box.y !== undefined,
      hasWidth: box.width !== undefined,
      hasHeight: box.height !== undefined
    });
    console.warn('⚠️ centerX/centerY should be preserved from backend through entire pipeline!');
    console.warn('⚠️ Check code at stage:', stage);
  }
}

/**
 * Create a properly formatted bounding box with all coordinate fields
 * 
 * Ensures centerX, centerY, topLeftX, topLeftY are calculated correctly
 * from x, y, width, height if they're missing.
 * 
 * @param box - Input box (may have partial coordinates)
 * @returns Complete box with all coordinate fields
 */
export function ensureCompleteBox(box: BoundingBox): Required<BoundingBox> {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    centerX: box.centerX ?? (box.x + box.width / 2),
    centerY: box.centerY ?? (box.y + box.height / 2),
    topLeftX: box.topLeftX ?? box.x,
    topLeftY: box.topLeftY ?? box.y
  };
}

/**
 * Log coordinate handshake between pipeline stages
 * 
 * Use this to trace coordinates through the system and verify
 * they're not being transformed or flipped.
 * 
 * @param fromStage - Source stage name
 * @param toStage - Destination stage name
 * @param box - Bounding box being passed
 */
export function logCoordinateHandshake(
  fromStage: string,
  toStage: string,
  box: BoundingBox | null
): void {
  if (!box) {
    console.log(`🔗 HANDSHAKE: ${fromStage} → ${toStage}: null`);
    return;
  }
  
  console.log(`🔗 HANDSHAKE: ${fromStage} → ${toStage}:`, {
    topLeft: `(${box.x?.toFixed(3)}, ${box.y?.toFixed(3)})`,
    center: `(${box.centerX?.toFixed(3) || 'N/A'}, ${box.centerY?.toFixed(3) || 'N/A'})`,
    dimensions: `${box.width?.toFixed(3)}×${box.height?.toFixed(3)}`,
    complete: box.centerX !== undefined && box.topLeftX !== undefined
  });
  
  // Auto-validate
  validateNoFlip(box, `${fromStage}→${toStage}`);
}
