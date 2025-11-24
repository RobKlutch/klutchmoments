/**
 * Centralized Coordinate Transformation Utility
 * 
 * Handles all bounding box to canvas conversions with proper letterboxing,
 * aspect ratio handling, and device pixel ratio support.
 * 
 * This eliminates fragmented coordinate math across Timeline, SpotlightOverlay,
 * and VideoPreviewPlayer to prevent "opposite side rendering" and drift issues.
 */

export interface VideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedBBox {
  x: number;      // Normalized [0, 1]
  y: number;      // Normalized [0, 1]
  width: number;  // Normalized [0, 1]
  height: number; // Normalized [0, 1]
}

export interface PixelBBox {
  x: number;      // Pixels
  y: number;      // Pixels
  width: number;  // Pixels
  height: number; // Pixels
}

/**
 * Calculate the rendered video rectangle within a container with object-fit: contain
 * 
 * @param videoWidth - Native video width in pixels
 * @param videoHeight - Native video height in pixels
 * @param containerWidth - Container width in pixels
 * @param containerHeight - Container height in pixels
 * @returns Rectangle describing where video is rendered (with letterboxing/pillarboxing)
 */
export function calculateVideoRenderRect(
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  containerHeight: number
): VideoRect {
  if (videoWidth === 0 || videoHeight === 0 || containerWidth === 0 || containerHeight === 0) {
    console.warn('⚠️ calculateVideoRenderRect: Zero dimension detected', {
      videoWidth, videoHeight, containerWidth, containerHeight
    });
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const videoAspectRatio = videoWidth / videoHeight;
  const containerAspectRatio = containerWidth / containerHeight;
  
  let renderWidth: number;
  let renderHeight: number;
  let renderX: number;
  let renderY: number;
  
  if (videoAspectRatio > containerAspectRatio) {
    // Video is wider - fit to container width, letterbox top/bottom
    renderWidth = containerWidth;
    renderHeight = containerWidth / videoAspectRatio;
    renderX = 0;
    renderY = (containerHeight - renderHeight) / 2;
  } else {
    // Video is taller - fit to container height, pillarbox left/right
    renderWidth = containerHeight * videoAspectRatio;
    renderHeight = containerHeight;
    renderX = (containerWidth - renderWidth) / 2;
    renderY = 0;
  }
  
  return { x: renderX, y: renderY, width: renderWidth, height: renderHeight };
}

/**
 * Convert normalized [0, 1] bounding box to pixel coordinates in the rendered video
 * 
 * @param normalizedBox - Bounding box in normalized coordinates [0, 1]
 * @param videoRenderRect - The rendered video rectangle (from calculateVideoRenderRect)
 * @returns Bounding box in pixel coordinates relative to container
 */
export function normalizedToPixels(
  normalizedBox: NormalizedBBox,
  videoRenderRect: VideoRect
): PixelBBox {
  return {
    x: videoRenderRect.x + (normalizedBox.x * videoRenderRect.width),
    y: videoRenderRect.y + (normalizedBox.y * videoRenderRect.height),
    width: normalizedBox.width * videoRenderRect.width,
    height: normalizedBox.height * videoRenderRect.height
  };
}

/**
 * Convert pixel coordinates to normalized [0, 1] coordinates
 * 
 * @param pixelBox - Bounding box in pixel coordinates relative to container
 * @param videoRenderRect - The rendered video rectangle (from calculateVideoRenderRect)
 * @returns Bounding box in normalized coordinates [0, 1]
 */
export function pixelsToNormalized(
  pixelBox: PixelBBox,
  videoRenderRect: VideoRect
): NormalizedBBox {
  if (videoRenderRect.width === 0 || videoRenderRect.height === 0) {
    console.warn('⚠️ pixelsToNormalized: Zero render dimension', videoRenderRect);
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: (pixelBox.x - videoRenderRect.x) / videoRenderRect.width,
    y: (pixelBox.y - videoRenderRect.y) / videoRenderRect.height,
    width: pixelBox.width / videoRenderRect.width,
    height: pixelBox.height / videoRenderRect.height
  };
}

/**
 * Convert a click position (in container coordinates) to normalized [0, 1] video coordinates
 * 
 * @param clickX - Click X position in container pixels
 * @param clickY - Click Y position in container pixels
 * @param videoRenderRect - The rendered video rectangle (from calculateVideoRenderRect)
 * @returns Normalized coordinates [0, 1], clamped to video bounds
 */
export function clickToNormalized(
  clickX: number,
  clickY: number,
  videoRenderRect: VideoRect
): { x: number; y: number } {
  if (videoRenderRect.width === 0 || videoRenderRect.height === 0) {
    console.warn('⚠️ clickToNormalized: Zero render dimension', videoRenderRect);
    return { x: 0, y: 0 };
  }

  // Convert to video-relative coordinates
  const videoRelativeX = clickX - videoRenderRect.x;
  const videoRelativeY = clickY - videoRenderRect.y;
  
  // Normalize and clamp to [0, 1]
  const normalizedX = Math.max(0, Math.min(1, videoRelativeX / videoRenderRect.width));
  const normalizedY = Math.max(0, Math.min(1, videoRelativeY / videoRenderRect.height));
  
  return { x: normalizedX, y: normalizedY };
}

/**
 * Check if a point is inside the rendered video area
 * 
 * @param x - X coordinate in container pixels
 * @param y - Y coordinate in container pixels
 * @param videoRenderRect - The rendered video rectangle
 * @returns true if point is inside rendered video area
 */
export function isPointInVideoRect(
  x: number,
  y: number,
  videoRenderRect: VideoRect
): boolean {
  return (
    x >= videoRenderRect.x &&
    x <= videoRenderRect.x + videoRenderRect.width &&
    y >= videoRenderRect.y &&
    y <= videoRenderRect.y + videoRenderRect.height
  );
}

/**
 * Get the center point of a normalized bounding box
 * 
 * @param box - Normalized bounding box
 * @returns Center coordinates in normalized space
 */
export function getNormalizedCenter(box: NormalizedBBox): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

/**
 * Comprehensive coordinate transformation for a complete pipeline:
 * Video → Container → Normalized coordinates
 * 
 * @param video - HTML video element
 * @param container - Container element, DOMRect, or DOMRectReadOnly
 * @returns Video render rectangle for use in subsequent transforms
 */
export function getVideoRenderRectFromElements(
  video: HTMLVideoElement,
  container: HTMLElement | DOMRect | DOMRectReadOnly
): VideoRect {
  // Handle both HTMLElement and rect objects (DOMRect/DOMRectReadOnly)
  const containerRect = ('width' in container && 'height' in container)
    ? container
    : container.getBoundingClientRect();
  
  return calculateVideoRenderRect(
    video.videoWidth,
    video.videoHeight,
    containerRect.width,
    containerRect.height
  );
}
