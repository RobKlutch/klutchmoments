/**
 * **SHARED EFFECT RENDERER**: Common spotlight effect utilities
 * Used by both SpotlightOverlay (live video) and EffectStaticPreview (static image)
 * Ensures visual consistency and prevents code duplication
 */

export interface SlowMotionSegment {
  id: string;
  startTime: number;    // Start time in seconds
  endTime: number;      // End time in seconds
  speedFactor: number;  // Speed multiplier (0.1 = 10% speed, 0.5 = 50% speed, etc.)
  name?: string;        // Optional name for the segment
}

export interface DynamicZoomSettings {
  enabled: boolean;
  intensity: 'subtle' | 'moderate' | 'dramatic';
  playerFocused: boolean;
  actionTriggered: boolean;
  contextAware: boolean;
  multiPlayerSupport: boolean;
  zoomInLevel: number;     // 1.0 to 3.0 (100% to 300%)
  zoomOutLevel: number;    // 0.5 to 1.0 (50% to 100%)
  transitionDuration: number; // seconds for smooth transitions
  triggerSensitivity: number; // 0.1 to 1.0 (how sensitive to triggers)
}

export interface EffectSettings {
  intensity: number; // 0-100% as displayed in UI
  size: number;      // 0-200% size multiplier  
  color: string;     // hex color value
  slowMotionSegments?: SlowMotionSegment[]; // Slow-motion replay segments
  dynamicZoom?: DynamicZoomSettings; // Dynamic zoom configuration
}

export interface TrackingBoxPixels {
  width: number;
  height: number;
}

/**
 * **HEX TO RGB**: Convert hex color to RGB components for consistent rgba() formatting
 * Fixes rendering issues caused by mixing rgba() and invalid hex-alpha formats
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace('#', '');
  
  // Parse RGB components
  const r = parseInt(cleanHex.substr(0, 2), 16);
  const g = parseInt(cleanHex.substr(2, 2), 16);
  const b = parseInt(cleanHex.substr(4, 2), 16);
  
  return { r, g, b };
}

/**
 * **CREATE RGBA**: Generate consistent rgba() color string
 * Ensures all gradient colors use the same format for reliable rendering
 */
function createRgba(hexColor: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hexColor);
  // Convert alpha from 0-255 to 0-1 range for CSS rgba
  const alphaDecimal = Math.max(0, Math.min(1, alpha / 255));
  return `rgba(${r}, ${g}, ${b}, ${alphaDecimal})`;
}

/**
 * **NORMALIZE INTENSITY**: Convert UI percentage (0-100%) to alpha value (0-255)
 * Fixes the intensity scale mismatch where UI shows percentages but internal calculations mixed scales
 */
export function normalizeIntensity(intensityPercent: number): number {
  // Clamp to valid range and convert percentage to 0-255 alpha
  const clamped = Math.max(0, Math.min(100, intensityPercent));
  return Math.round((clamped / 100) * 255);
}

/**
 * **CALCULATE EFFECT SIZE**: Dynamic sizing based on actual player dimensions
 * settings.size becomes a multiplier (70 = 0.7x player size, 100 = 1.0x player size, 150 = 1.5x larger)
 */
export function calculateEffectSize(
  settings: EffectSettings,
  trackingBoxPixels: TrackingBoxPixels | undefined,
  fallbackCanvasSize: { width: number; height: number }
): number {
  const { size } = settings;
  
  if (trackingBoxPixels) {
    // **PREFERRED**: Use actual player dimensions scaled by size multiplier
    const playerDimension = Math.max(trackingBoxPixels.width, trackingBoxPixels.height);
    const baseSize = playerDimension * (size / 100);
    console.log(`🎯 Dynamic sizing: player=${playerDimension.toFixed(1)}px, multiplier=${size/100}, result=${baseSize.toFixed(1)}px`);
    return baseSize;
  } else {
    // **FALLBACK**: Legacy method for backwards compatibility
    const baseSize = Math.min(fallbackCanvasSize.width, fallbackCanvasSize.height) * (size / 100) * 0.15;
    console.log(`⚠️ Fallback sizing: ${baseSize.toFixed(1)}px`);
    return baseSize;
  }
}

/**
 * **RENDER SPOTLIGHT EFFECT**: Main effect rendering function
 * Shared logic used by both video overlay and static preview
 */
export function renderSpotlightEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  effect: string,
  settings: EffectSettings,
  trackingBoxPixels?: TrackingBoxPixels
): void {
  const { color } = settings;
  
  // **FIX**: Normalize intensity from UI percentage (0-100%) to alpha (0-255)
  const alpha = normalizeIntensity(settings.intensity);
  
  // **DYNAMIC SIZING**: Calculate baseSize from actual trackingBox dimensions
  const baseSize = calculateEffectSize(settings, trackingBoxPixels, {
    width: ctx.canvas.width,
    height: ctx.canvas.height
  });
  
  // Parse color for gradient (default to blue if invalid)
  const spotlightColor = color || '#3b82f6';
  
  switch (effect.toLowerCase()) {
    case 'beam':
      renderBeamEffect(ctx, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'circle':
    case 'spotlight':
      renderCircleEffect(ctx, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'square':
      renderSquareEffect(ctx, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'footdisk':
      renderFootDiskEffect(ctx, centerX, centerY, baseSize, alpha, spotlightColor, { size: settings.size });
      break;
      
    case 'aura':
      renderAuraEffect(ctx, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'focuscircle':
      renderFocusCircleEffect(ctx, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    default:
      // **DEFAULT**: Fallback to circle
      renderDefaultEffect(ctx, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
  }
  
}

/**
 * **SPOTLIGHT BEAM EFFECT**: Circular spotlight around player (like reference image)
 * Creates a bright white ring with colored glow around the player
 */
function renderBeamEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const spotlightRadius = baseSize * 0.9;
  
  // **OUTER GLOW**: Colored ring around the spotlight
  const outerGradient = ctx.createRadialGradient(
    centerX, centerY, spotlightRadius * 0.6,
    centerX, centerY, spotlightRadius * 1.4
  );
  
  outerGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  outerGradient.addColorStop(0.4, createRgba(color, alpha * 0.6));
  outerGradient.addColorStop(0.7, createRgba(color, alpha * 0.8));
  outerGradient.addColorStop(0.9, createRgba(color, alpha * 0.4));
  outerGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = outerGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, spotlightRadius * 1.4, 0, Math.PI * 2);
  ctx.fill();
  
  // **BRIGHT WHITE RING**: Core spotlight effect
  const ringGradient = ctx.createRadialGradient(
    centerX, centerY, spotlightRadius * 0.3,
    centerX, centerY, spotlightRadius
  );
  
  ringGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  ringGradient.addColorStop(0.6, createRgba('#ffffff', alpha * 0.9));
  ringGradient.addColorStop(0.8, createRgba('#ffffff', alpha * 1.2));
  ringGradient.addColorStop(0.95, createRgba('#ffffff', alpha * 0.6));
  ringGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = ringGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, spotlightRadius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * **CIRCULAR SPOTLIGHT EFFECT**: Radial glow around player
 */
function renderCircleEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const radius = baseSize;
  const radialGradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, radius
  );
  
  // **FIX**: Use consistent rgba() formatting for all gradient stops
  radialGradient.addColorStop(0, createRgba('#ffffff', alpha));
  radialGradient.addColorStop(0.3, createRgba(color, alpha * 0.9));
  radialGradient.addColorStop(0.7, createRgba(color, alpha * 0.4));
  radialGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = radialGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * **SQUARE SPOTLIGHT EFFECT**: Square highlight around player
 */
function renderSquareEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const squareSize = baseSize * 1.4;
  const squareGradient = ctx.createLinearGradient(
    centerX - squareSize / 2, centerY - squareSize / 2,
    centerX + squareSize / 2, centerY + squareSize / 2
  );
  
  // **FIX**: Use consistent rgba() formatting for all gradient stops
  squareGradient.addColorStop(0, createRgba(color, alpha * 0.6));
  squareGradient.addColorStop(0.5, createRgba(color, alpha));
  squareGradient.addColorStop(1, createRgba(color, alpha * 0.6));
  
  ctx.fillStyle = squareGradient;
  ctx.fillRect(
    centerX - squareSize / 2,
    centerY - squareSize / 2,
    squareSize,
    squareSize
  );
}

/**
 * **FOOT DISK EFFECT**: Flat disk at ground level below player's feet
 * Positioned at the bottom of the player tracking box for realistic ground-level effect
 */
function renderFootDiskEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string,
  settings?: { size?: number }
): void {
  // **PROFESSIONAL SIZING**: Base on tracking box height, not generic baseSize
  const h = baseSize; // Using baseSize as height reference
  const size = settings?.size || 100;
  
  // **GROUND POSITIONING**: Precise placement at player's feet
  const groundY = centerY + h * 0.5 - h * 0.03; // Just below tracking box
  
  // **PROFESSIONAL DIMENSIONS**: Match reference image proportions
  const sizeMultiplier = Math.max(0, Math.min(1, (size - 60) / 100)); // Normalize size setting
  const rx = Math.max(h * (1.2 + sizeMultiplier * 0.8), 60); // 1.2x to 2.0x player height, min 60px
  const ry = rx * 0.14; // Dramatically flattened for ground projection effect
  
  ctx.save();
  
  // **PASS A**: Core projected spotlight with screen blending
  ctx.globalCompositeOperation = 'screen'; // Projected light effect
  
  // Create clipping path for ellipse
  ctx.beginPath();
  ctx.ellipse(centerX, groundY, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  
  // Core spotlight gradient
  const coreGradient = ctx.createRadialGradient(
    centerX, groundY, 0,
    centerX, groundY, rx
  );
  const normalizedAlpha = Math.min(1, alpha / 255);
  coreGradient.addColorStop(0, createRgba('#ffffff', Math.floor(255 * normalizedAlpha * 0.35)));
  coreGradient.addColorStop(0.15, createRgba(color, Math.floor(255 * normalizedAlpha * 1.0)));
  coreGradient.addColorStop(0.55, createRgba(color, Math.floor(255 * normalizedAlpha * 0.4)));
  coreGradient.addColorStop(0.85, createRgba(color, Math.floor(255 * normalizedAlpha * 0.12)));
  coreGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = coreGradient;
  ctx.fillRect(centerX - rx, groundY - ry, rx * 2, ry * 2);
  
  ctx.restore();
  
  // **PASS B**: Outer bloom for professional finish
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  
  const rxb = rx * 1.35; // Larger outer bloom
  const ryb = ry * 0.55; // Softer vertical spread
  
  const bloomGradient = ctx.createRadialGradient(
    centerX, groundY, 0,
    centerX, groundY, rxb
  );
  bloomGradient.addColorStop(0, createRgba(color, Math.floor(255 * normalizedAlpha * 0.22)));
  bloomGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = bloomGradient;
  ctx.beginPath();
  ctx.ellipse(centerX, groundY, rxb, ryb, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

/**
 * **PLAYER AURA EFFECT**: Glowing outline around player shape
 * Creates a multi-layered glow that follows the player's silhouette
 */
function renderAuraEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  // **MULTI-LAYER AURA**: Create multiple concentric glows for depth
  const auraLayers = [
    { radius: baseSize * 1.5, intensity: alpha * 0.2 }, // Outermost soft glow
    { radius: baseSize * 1.2, intensity: alpha * 0.4 }, // Medium glow
    { radius: baseSize * 0.9, intensity: alpha * 0.7 }, // Inner bright glow
    { radius: baseSize * 0.6, intensity: alpha * 0.3 }  // Core highlight
  ];
  
  // **RENDER LAYERS**: Draw from outside to inside
  auraLayers.forEach((layer, index) => {
    const layerGradient = ctx.createRadialGradient(
      centerX, centerY, layer.radius * 0.3,
      centerX, centerY, layer.radius
    );
    
    if (index === auraLayers.length - 1) {
      // **CORE LAYER**: Bright white center with colored edge
      layerGradient.addColorStop(0, createRgba('#ffffff', layer.intensity * 0.8));
      layerGradient.addColorStop(0.4, createRgba('#ffffff', layer.intensity * 0.5));
      layerGradient.addColorStop(0.8, createRgba(color, layer.intensity));
      layerGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    } else {
      // **OUTER LAYERS**: Colored gradient with soft falloff
      layerGradient.addColorStop(0, createRgba(color, layer.intensity * 0.3));
      layerGradient.addColorStop(0.5, createRgba(color, layer.intensity));
      layerGradient.addColorStop(0.8, createRgba(color, layer.intensity * 0.5));
      layerGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    }
    
    ctx.fillStyle = layerGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, layer.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * **FOCUS CIRCLE EFFECT**: Professional broadcast-style focus effect
 * Creates a bright circular area centered on the player with dimmed surroundings
 * Mimics professional sports broadcast highlighting techniques
 */
function renderFocusCircleEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  // **FOCUS RADIUS**: Calculate the focus circle radius based on player size
  const focusRadius = baseSize * 2.5; // Larger than player for comfortable focus area
  
  ctx.save();
  
  // **STEP 1**: Create full-canvas dimmed overlay
  const dimAlpha = Math.max(0.3, Math.min(0.8, alpha / 255 * 0.6)); // Controlled dimming
  ctx.fillStyle = `rgba(0, 0, 0, ${dimAlpha})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  
  // **STEP 2**: Set up circular clipping path for the bright area
  ctx.globalCompositeOperation = 'destination-out'; // Cut out the bright circle
  
  // Create smooth circular cutout with gradient edge
  const cutoutGradient = ctx.createRadialGradient(
    centerX, centerY, focusRadius * 0.7,
    centerX, centerY, focusRadius * 1.2
  );
  cutoutGradient.addColorStop(0, 'rgba(0, 0, 0, 1)'); // Full cutout in center
  cutoutGradient.addColorStop(0.6, 'rgba(0, 0, 0, 1)'); // Sharp edge
  cutoutGradient.addColorStop(0.9, 'rgba(0, 0, 0, 0.3)'); // Soft transition
  cutoutGradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // No cutout at edge
  
  ctx.fillStyle = cutoutGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, focusRadius * 1.2, 0, Math.PI * 2);
  ctx.fill();
  
  // **STEP 3**: Add bright enhancement in the focus area
  ctx.globalCompositeOperation = 'screen'; // Brightening blend mode
  
  // Inner bright gradient for enhanced visibility
  const brightGradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, focusRadius * 0.8
  );
  
  const normalizedAlpha = Math.min(1, alpha / 255);
  brightGradient.addColorStop(0, createRgba('#ffffff', Math.floor(120 * normalizedAlpha))); // Bright center
  brightGradient.addColorStop(0.3, createRgba(color, Math.floor(80 * normalizedAlpha))); // Colored middle
  brightGradient.addColorStop(0.7, createRgba(color, Math.floor(40 * normalizedAlpha))); // Soft edge
  brightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Transparent edge
  
  ctx.fillStyle = brightGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, focusRadius * 0.8, 0, Math.PI * 2);
  ctx.fill();
  
  // **STEP 4**: Add subtle rim lighting for professional finish
  ctx.globalCompositeOperation = 'source-over';
  
  const rimGradient = ctx.createRadialGradient(
    centerX, centerY, focusRadius * 0.75,
    centerX, centerY, focusRadius * 0.95
  );
  
  rimGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  rimGradient.addColorStop(0.5, createRgba(color, Math.floor(60 * normalizedAlpha)));
  rimGradient.addColorStop(0.8, createRgba('#ffffff', Math.floor(80 * normalizedAlpha)));
  rimGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = rimGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, focusRadius * 0.95, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

/**
 * **DEFAULT EFFECT**: Simple circle fallback
 */
function renderDefaultEffect(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const radius = baseSize;
  const gradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, radius
  );
  
  // **FIX**: Use consistent rgba() formatting
  gradient.addColorStop(0, createRgba('#ffffff', alpha));
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * **EFFECT NAME MAPPING**: Display friendly names for effects
 */
export function getEffectDisplayName(effectId: string): string {
  switch (effectId.toLowerCase()) {
    case 'spotlight':
    case 'circle':
      return 'Spotlight Beam';
    case 'beam':
      return 'Spotlight Beam';
    case 'footdisk':
      return 'Foot Disk';
    case 'square':
      return 'Square Highlight';
    case 'aura':
      return 'Player Aura';
    case 'focuscircle':
      return 'Focus Circle';
    default:
      return 'Custom Effect';
  }
}

/**
 * **COLOR NAME MAPPING**: Display friendly color names
 */
export function getColorDisplayName(colorValue: string): string {
  const colorMap: Record<string, string> = {
    '#3b82f6': 'Electric Blue',
    '#10b981': 'Bright Green', 
    '#f59e0b': 'Golden Yellow',
    '#ef4444': 'Vibrant Red',
    '#000000': 'Black',
    '#ffffff': 'White Beam'
  };
  return colorMap[colorValue.toLowerCase()] || 'Custom Color';
}