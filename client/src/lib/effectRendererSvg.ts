/**
 * **SVG EFFECT RENDERER**: Cross-browser compatible SVG-based spotlight effects
 * Provides same visual effects as canvas version with reliable compatibility
 * Replaces problematic canvas system for live video preview
 */

// Re-export shared interfaces and utilities for API compatibility
export interface EffectSettings {
  intensity: number; // 0-100% as displayed in UI
  size: number;      // 0-200% size multiplier  
  color: string;     // hex color value
}

export interface TrackingBoxPixels {
  width: number;
  height: number;
}

/**
 * **HEX TO RGB**: Convert hex color to RGB components for consistent color formatting
 * Same implementation as canvas version for visual consistency
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substr(0, 2), 16);
  const g = parseInt(cleanHex.substr(2, 2), 16);
  const b = parseInt(cleanHex.substr(4, 2), 16);
  return { r, g, b };
}

/**
 * **CREATE RGBA**: Generate consistent rgba() color string for SVG
 */
function createRgba(hexColor: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hexColor);
  const alphaDecimal = Math.max(0, Math.min(1, alpha / 255));
  return `rgba(${r}, ${g}, ${b}, ${alphaDecimal})`;
}

/**
 * **NORMALIZE INTENSITY**: Convert UI percentage (0-100%) to alpha value (0-255)
 * Same implementation as canvas version for consistency
 */
export function normalizeIntensity(intensityPercent: number): number {
  const clamped = Math.max(0, Math.min(100, intensityPercent));
  return Math.round((clamped / 100) * 255);
}

/**
 * **CALCULATE EFFECT SIZE**: Dynamic sizing based on actual player dimensions
 * Same implementation as canvas version for visual consistency
 */
export function calculateEffectSize(
  settings: EffectSettings,
  trackingBoxPixels: TrackingBoxPixels | undefined,
  fallbackCanvasSize: { width: number; height: number }
): number {
  const { size } = settings;
  
  if (trackingBoxPixels) {
    const playerDimension = Math.max(trackingBoxPixels.width, trackingBoxPixels.height);
    const baseSize = playerDimension * (size / 100);
    console.log(`🎯 SVG Dynamic sizing: player=${playerDimension.toFixed(1)}px, multiplier=${size/100}, result=${baseSize.toFixed(1)}px`);
    return baseSize;
  } else {
    const baseSize = Math.min(fallbackCanvasSize.width, fallbackCanvasSize.height) * (size / 100) * 0.15;
    console.log(`⚠️ SVG Fallback sizing: ${baseSize.toFixed(1)}px`);
    return baseSize;
  }
}

/**
 * **CREATE SVG NAMESPACE ELEMENT**: Helper to create SVG elements with proper namespace
 */
function createSvgElement(tagName: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', tagName);
}

/**
 * **GENERATE UNIQUE ID**: Create unique IDs for SVG gradients and filters
 */
function generateUniqueId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
}

/**
 * **RENDER SPOTLIGHT EFFECT SVG**: Main SVG effect rendering function
 * Same API as canvas version but returns SVG element instead of drawing on context
 */
export function renderSpotlightEffectSvg(
  containerWidth: number,
  containerHeight: number,
  centerX: number,
  centerY: number,
  effect: string,
  settings: EffectSettings,
  trackingBoxPixels?: TrackingBoxPixels
): SVGElement {
  const { color } = settings;
  
  // Normalize intensity and calculate size same as canvas version
  const alpha = normalizeIntensity(settings.intensity);
  const baseSize = calculateEffectSize(settings, trackingBoxPixels, {
    width: containerWidth,
    height: containerHeight
  });
  
  // Parse color for gradient (default to blue if invalid)
  const spotlightColor = color || '#3b82f6';
  
  // Create main SVG container
  const svg = createSvgElement('svg') as SVGSVGElement;
  svg.setAttribute('width', containerWidth.toString());
  svg.setAttribute('height', containerHeight.toString());
  svg.setAttribute('viewBox', `0 0 ${containerWidth} ${containerHeight}`);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '10';
  
  // Create definitions for gradients and filters
  const defs = createSvgElement('defs');
  svg.appendChild(defs);
  
  // Render effect based on type
  switch (effect.toLowerCase()) {
    case 'beam':
      renderBeamEffectSvg(svg, defs, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'circle':
    case 'spotlight':
    case 'spotlight ring':
      renderCircleEffectSvg(svg, defs, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'square':
      renderSquareEffectSvg(svg, defs, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'footdisk':
      renderFootDiskEffectSvg(svg, defs, centerX, centerY, baseSize, alpha, spotlightColor, { size: settings.size });
      break;
      
    case 'aura':
      renderAuraEffectSvg(svg, defs, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
      
    case 'focuscircle':
      renderFocusCircleEffectSvg(svg, defs, centerX, centerY, baseSize, alpha, spotlightColor, containerWidth, containerHeight);
      break;
      
    default:
      // Default fallback to circle
      renderDefaultEffectSvg(svg, defs, centerX, centerY, baseSize, alpha, spotlightColor);
      break;
  }
  
  return svg;
}

/**
 * **BEAM EFFECT SVG**: Circular spotlight with white ring and colored glow
 * Matches canvas beam effect visual appearance
 */
function renderBeamEffectSvg(
  svg: SVGSVGElement,
  defs: SVGElement,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const spotlightRadius = baseSize * 0.9;
  
  // Create outer glow gradient
  const outerGradientId = generateUniqueId('beam-outer-glow');
  const outerGradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  outerGradient.setAttribute('id', outerGradientId);
  outerGradient.setAttribute('cx', '50%');
  outerGradient.setAttribute('cy', '50%');
  outerGradient.setAttribute('r', '50%');
  
  // Outer gradient stops - colored ring
  const outerStops = [
    { offset: '0%', color: 'rgba(255, 255, 255, 0)' },
    { offset: '40%', color: createRgba(color, alpha * 0.6) },
    { offset: '70%', color: createRgba(color, alpha * 0.8) },
    { offset: '90%', color: createRgba(color, alpha * 0.4) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  outerStops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    outerGradient.appendChild(stopElement);
  });
  
  defs.appendChild(outerGradient);
  
  // Create outer glow circle
  const outerCircle = createSvgElement('circle');
  outerCircle.setAttribute('cx', centerX.toString());
  outerCircle.setAttribute('cy', centerY.toString());
  outerCircle.setAttribute('r', (spotlightRadius * 1.4).toString());
  outerCircle.setAttribute('fill', `url(#${outerGradientId})`);
  svg.appendChild(outerCircle);
  
  // Create bright white ring gradient
  const ringGradientId = generateUniqueId('beam-ring');
  const ringGradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  ringGradient.setAttribute('id', ringGradientId);
  ringGradient.setAttribute('cx', '50%');
  ringGradient.setAttribute('cy', '50%');
  ringGradient.setAttribute('r', '50%');
  
  // Ring gradient stops - bright white core
  const ringStops = [
    { offset: '0%', color: 'rgba(255, 255, 255, 0)' },
    { offset: '60%', color: createRgba('#ffffff', alpha * 0.9) },
    { offset: '80%', color: createRgba('#ffffff', alpha * 1.2) },
    { offset: '95%', color: createRgba('#ffffff', alpha * 0.6) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  ringStops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    ringGradient.appendChild(stopElement);
  });
  
  defs.appendChild(ringGradient);
  
  // Create bright white ring circle
  const ringCircle = createSvgElement('circle');
  ringCircle.setAttribute('cx', centerX.toString());
  ringCircle.setAttribute('cy', centerY.toString());
  ringCircle.setAttribute('r', spotlightRadius.toString());
  ringCircle.setAttribute('fill', `url(#${ringGradientId})`);
  svg.appendChild(ringCircle);
}

/**
 * **CIRCLE EFFECT SVG**: Radial glow around player
 * Matches canvas circle effect visual appearance
 */
function renderCircleEffectSvg(
  svg: SVGSVGElement,
  defs: SVGElement,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const radius = baseSize;
  
  // Create radial gradient
  const gradientId = generateUniqueId('circle-gradient');
  const gradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  gradient.setAttribute('id', gradientId);
  gradient.setAttribute('cx', '50%');
  gradient.setAttribute('cy', '50%');
  gradient.setAttribute('r', '50%');
  
  // Gradient stops matching canvas version
  const stops = [
    { offset: '0%', color: createRgba('#ffffff', alpha) },
    { offset: '30%', color: createRgba(color, alpha * 0.9) },
    { offset: '70%', color: createRgba(color, alpha * 0.4) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  stops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    gradient.appendChild(stopElement);
  });
  
  defs.appendChild(gradient);
  
  // Create circle with gradient fill
  const circle = createSvgElement('circle');
  circle.setAttribute('cx', centerX.toString());
  circle.setAttribute('cy', centerY.toString());
  circle.setAttribute('r', radius.toString());
  circle.setAttribute('fill', `url(#${gradientId})`);
  svg.appendChild(circle);
}

/**
 * **SQUARE EFFECT SVG**: Square highlight with gradient
 * Matches canvas square effect visual appearance
 */
function renderSquareEffectSvg(
  svg: SVGSVGElement,
  defs: SVGElement,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const squareSize = baseSize * 1.4;
  
  // Create linear gradient
  const gradientId = generateUniqueId('square-gradient');
  const gradient = createSvgElement('linearGradient') as SVGLinearGradientElement;
  gradient.setAttribute('id', gradientId);
  gradient.setAttribute('x1', '0%');
  gradient.setAttribute('y1', '0%');
  gradient.setAttribute('x2', '100%');
  gradient.setAttribute('y2', '100%');
  
  // Gradient stops matching canvas version
  const stops = [
    { offset: '0%', color: createRgba(color, alpha * 0.6) },
    { offset: '50%', color: createRgba(color, alpha) },
    { offset: '100%', color: createRgba(color, alpha * 0.6) }
  ];
  
  stops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    gradient.appendChild(stopElement);
  });
  
  defs.appendChild(gradient);
  
  // Create square with gradient fill
  const square = createSvgElement('rect');
  square.setAttribute('x', (centerX - squareSize / 2).toString());
  square.setAttribute('y', (centerY - squareSize / 2).toString());
  square.setAttribute('width', squareSize.toString());
  square.setAttribute('height', squareSize.toString());
  square.setAttribute('fill', `url(#${gradientId})`);
  svg.appendChild(square);
}

/**
 * **FOOT DISK EFFECT SVG**: Elliptical highlight at ground level
 * Matches canvas foot disk effect visual appearance
 */
function renderFootDiskEffectSvg(
  svg: SVGSVGElement,
  defs: SVGElement,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string,
  settings?: { size?: number }
): void {
  const h = baseSize;
  const size = settings?.size || 100;
  
  // Ground positioning - same calculation as canvas version
  const groundY = centerY + h * 0.5 - h * 0.03;
  
  // Professional dimensions - same calculation as canvas version
  const sizeMultiplier = Math.max(0, Math.min(1, (size - 60) / 100));
  const rx = Math.max(h * (1.2 + sizeMultiplier * 0.8), 60);
  const ry = rx * 0.14;
  
  // Create core spotlight gradient
  const coreGradientId = generateUniqueId('footdisk-core');
  const coreGradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  coreGradient.setAttribute('id', coreGradientId);
  coreGradient.setAttribute('cx', '50%');
  coreGradient.setAttribute('cy', '50%');
  coreGradient.setAttribute('r', '50%');
  
  const normalizedAlpha = Math.min(1, alpha / 255);
  const coreStops = [
    { offset: '0%', color: createRgba('#ffffff', Math.floor(255 * normalizedAlpha * 0.35)) },
    { offset: '15%', color: createRgba(color, Math.floor(255 * normalizedAlpha * 1.0)) },
    { offset: '55%', color: createRgba(color, Math.floor(255 * normalizedAlpha * 0.4)) },
    { offset: '85%', color: createRgba(color, Math.floor(255 * normalizedAlpha * 0.12)) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  coreStops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    coreGradient.appendChild(stopElement);
  });
  
  defs.appendChild(coreGradient);
  
  // Create core ellipse with screen blend mode
  const coreEllipse = createSvgElement('ellipse');
  coreEllipse.setAttribute('cx', centerX.toString());
  coreEllipse.setAttribute('cy', groundY.toString());
  coreEllipse.setAttribute('rx', rx.toString());
  coreEllipse.setAttribute('ry', ry.toString());
  coreEllipse.setAttribute('fill', `url(#${coreGradientId})`);
  coreEllipse.style.mixBlendMode = 'screen';
  svg.appendChild(coreEllipse);
  
  // Create outer bloom gradient
  const bloomGradientId = generateUniqueId('footdisk-bloom');
  const bloomGradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  bloomGradient.setAttribute('id', bloomGradientId);
  bloomGradient.setAttribute('cx', '50%');
  bloomGradient.setAttribute('cy', '50%');
  bloomGradient.setAttribute('r', '50%');
  
  const bloomStops = [
    { offset: '0%', color: createRgba(color, Math.floor(255 * normalizedAlpha * 0.22)) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  bloomStops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    bloomGradient.appendChild(stopElement);
  });
  
  defs.appendChild(bloomGradient);
  
  // Create bloom ellipse
  const rxb = rx * 1.35;
  const ryb = ry * 0.55;
  const bloomEllipse = createSvgElement('ellipse');
  bloomEllipse.setAttribute('cx', centerX.toString());
  bloomEllipse.setAttribute('cy', groundY.toString());
  bloomEllipse.setAttribute('rx', rxb.toString());
  bloomEllipse.setAttribute('ry', ryb.toString());
  bloomEllipse.setAttribute('fill', `url(#${bloomGradientId})`);
  bloomEllipse.style.mixBlendMode = 'screen';
  svg.appendChild(bloomEllipse);
}

/**
 * **AURA EFFECT SVG**: Multi-layer glowing outline
 * Matches canvas aura effect visual appearance
 */
function renderAuraEffectSvg(
  svg: SVGSVGElement,
  defs: SVGElement,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  // Multi-layer aura - same as canvas version
  const auraLayers = [
    { radius: baseSize * 1.5, intensity: alpha * 0.2 },
    { radius: baseSize * 1.2, intensity: alpha * 0.4 },
    { radius: baseSize * 0.9, intensity: alpha * 0.7 },
    { radius: baseSize * 0.6, intensity: alpha * 0.3 }
  ];
  
  // Render layers from outside to inside
  auraLayers.forEach((layer, index) => {
    const gradientId = generateUniqueId(`aura-layer-${index}`);
    const gradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('cx', '50%');
    gradient.setAttribute('cy', '50%');
    gradient.setAttribute('r', '50%');
    
    let stops;
    if (index === auraLayers.length - 1) {
      // Core layer - bright white center with colored edge
      stops = [
        { offset: '0%', color: createRgba('#ffffff', layer.intensity * 0.8) },
        { offset: '40%', color: createRgba('#ffffff', layer.intensity * 0.5) },
        { offset: '80%', color: createRgba(color, layer.intensity) },
        { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
      ];
    } else {
      // Outer layers - colored gradient with soft falloff
      stops = [
        { offset: '0%', color: createRgba(color, layer.intensity * 0.3) },
        { offset: '50%', color: createRgba(color, layer.intensity) },
        { offset: '80%', color: createRgba(color, layer.intensity * 0.5) },
        { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
      ];
    }
    
    stops.forEach(stop => {
      const stopElement = createSvgElement('stop');
      stopElement.setAttribute('offset', stop.offset);
      stopElement.setAttribute('stop-color', stop.color);
      gradient.appendChild(stopElement);
    });
    
    defs.appendChild(gradient);
    
    // Create layer circle
    const circle = createSvgElement('circle');
    circle.setAttribute('cx', centerX.toString());
    circle.setAttribute('cy', centerY.toString());
    circle.setAttribute('r', layer.radius.toString());
    circle.setAttribute('fill', `url(#${gradientId})`);
    svg.appendChild(circle);
  });
}

/**
 * **FOCUS CIRCLE EFFECT SVG**: Dark overlay with bright circular cutout
 * Matches canvas focus circle effect visual appearance
 */
function renderFocusCircleEffectSvg(
  svg: SVGSVGElement,
  defs: SVGElement,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string,
  containerWidth: number,
  containerHeight: number
): void {
  const focusRadius = baseSize * 2.5;
  
  // Create mask for the cutout effect
  const maskId = generateUniqueId('focus-mask');
  const mask = createSvgElement('mask');
  mask.setAttribute('id', maskId);
  
  // White background for mask (visible area)
  const maskBg = createSvgElement('rect');
  maskBg.setAttribute('x', '0');
  maskBg.setAttribute('y', '0');
  maskBg.setAttribute('width', containerWidth.toString());
  maskBg.setAttribute('height', containerHeight.toString());
  maskBg.setAttribute('fill', 'white');
  mask.appendChild(maskBg);
  
  // Create gradient for smooth cutout edge
  const cutoutGradientId = generateUniqueId('focus-cutout');
  const cutoutGradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  cutoutGradient.setAttribute('id', cutoutGradientId);
  cutoutGradient.setAttribute('cx', '50%');
  cutoutGradient.setAttribute('cy', '50%');
  cutoutGradient.setAttribute('r', '50%');
  
  const cutoutStops = [
    { offset: '0%', color: 'black' },
    { offset: '60%', color: 'black' },
    { offset: '90%', color: 'rgba(0, 0, 0, 0.3)' },
    { offset: '100%', color: 'rgba(0, 0, 0, 0)' }
  ];
  
  cutoutStops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    cutoutGradient.appendChild(stopElement);
  });
  
  defs.appendChild(cutoutGradient);
  
  // Black circle for cutout (invisible area in mask)
  const cutoutCircle = createSvgElement('circle');
  cutoutCircle.setAttribute('cx', centerX.toString());
  cutoutCircle.setAttribute('cy', centerY.toString());
  cutoutCircle.setAttribute('r', (focusRadius * 1.2).toString());
  cutoutCircle.setAttribute('fill', `url(#${cutoutGradientId})`);
  mask.appendChild(cutoutCircle);
  
  defs.appendChild(mask);
  
  // Create dimmed overlay with mask
  const dimAlpha = Math.max(0.3, Math.min(0.8, alpha / 255 * 0.6));
  const overlay = createSvgElement('rect');
  overlay.setAttribute('x', '0');
  overlay.setAttribute('y', '0');
  overlay.setAttribute('width', containerWidth.toString());
  overlay.setAttribute('height', containerHeight.toString());
  overlay.setAttribute('fill', `rgba(0, 0, 0, ${dimAlpha})`);
  overlay.setAttribute('mask', `url(#${maskId})`);
  svg.appendChild(overlay);
  
  // Add bright enhancement in focus area
  const brightGradientId = generateUniqueId('focus-bright');
  const brightGradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  brightGradient.setAttribute('id', brightGradientId);
  brightGradient.setAttribute('cx', '50%');
  brightGradient.setAttribute('cy', '50%');
  brightGradient.setAttribute('r', '50%');
  
  const normalizedAlpha = Math.min(1, alpha / 255);
  const brightStops = [
    { offset: '0%', color: createRgba('#ffffff', Math.floor(120 * normalizedAlpha)) },
    { offset: '30%', color: createRgba(color, Math.floor(80 * normalizedAlpha)) },
    { offset: '70%', color: createRgba(color, Math.floor(40 * normalizedAlpha)) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  brightStops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    brightGradient.appendChild(stopElement);
  });
  
  defs.appendChild(brightGradient);
  
  // Bright enhancement circle with screen blend mode
  const brightCircle = createSvgElement('circle');
  brightCircle.setAttribute('cx', centerX.toString());
  brightCircle.setAttribute('cy', centerY.toString());
  brightCircle.setAttribute('r', (focusRadius * 0.8).toString());
  brightCircle.setAttribute('fill', `url(#${brightGradientId})`);
  brightCircle.style.mixBlendMode = 'screen';
  svg.appendChild(brightCircle);
  
  // Add rim lighting for professional finish
  const rimGradientId = generateUniqueId('focus-rim');
  const rimGradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  rimGradient.setAttribute('id', rimGradientId);
  rimGradient.setAttribute('cx', '50%');
  rimGradient.setAttribute('cy', '50%');
  rimGradient.setAttribute('r', '50%');
  
  const rimStops = [
    { offset: '0%', color: 'rgba(255, 255, 255, 0)' },
    { offset: '50%', color: createRgba(color, Math.floor(60 * normalizedAlpha)) },
    { offset: '80%', color: createRgba('#ffffff', Math.floor(80 * normalizedAlpha)) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  rimStops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    rimGradient.appendChild(stopElement);
  });
  
  defs.appendChild(rimGradient);
  
  // Rim lighting circle
  const rimCircle = createSvgElement('circle');
  rimCircle.setAttribute('cx', centerX.toString());
  rimCircle.setAttribute('cy', centerY.toString());
  rimCircle.setAttribute('r', (focusRadius * 0.95).toString());
  rimCircle.setAttribute('fill', `url(#${rimGradientId})`);
  svg.appendChild(rimCircle);
}

/**
 * **DEFAULT EFFECT SVG**: Simple circle fallback
 * Matches canvas default effect visual appearance
 */
function renderDefaultEffectSvg(
  svg: SVGSVGElement,
  defs: SVGElement,
  centerX: number,
  centerY: number,
  baseSize: number,
  alpha: number,
  color: string
): void {
  const radius = baseSize;
  
  // Create simple radial gradient
  const gradientId = generateUniqueId('default-gradient');
  const gradient = createSvgElement('radialGradient') as SVGRadialGradientElement;
  gradient.setAttribute('id', gradientId);
  gradient.setAttribute('cx', '50%');
  gradient.setAttribute('cy', '50%');
  gradient.setAttribute('r', '50%');
  
  const stops = [
    { offset: '0%', color: createRgba('#ffffff', alpha) },
    { offset: '100%', color: 'rgba(255, 255, 255, 0)' }
  ];
  
  stops.forEach(stop => {
    const stopElement = createSvgElement('stop');
    stopElement.setAttribute('offset', stop.offset);
    stopElement.setAttribute('stop-color', stop.color);
    gradient.appendChild(stopElement);
  });
  
  defs.appendChild(gradient);
  
  // Create simple circle
  const circle = createSvgElement('circle');
  circle.setAttribute('cx', centerX.toString());
  circle.setAttribute('cy', centerY.toString());
  circle.setAttribute('r', radius.toString());
  circle.setAttribute('fill', `url(#${gradientId})`);
  svg.appendChild(circle);
}

// Re-export display name functions for API compatibility
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