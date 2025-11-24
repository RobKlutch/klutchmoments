import { useEffect, useRef, useCallback, useState } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { renderSpotlightEffect, getEffectDisplayName, getColorDisplayName, type EffectSettings } from "@/lib/effectRenderer";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates } from '@/utils/safePlayerAccess';

// **STATIC PREVIEW COMPONENT**: Shows effects on a single frame without full video access
interface EffectStaticPreviewProps {
  previewFrameDataUrl: string;
  selectedPlayer: { x: number; y: number; width: number; height: number } | null;
  effect: string;
  effectSettings: EffectSettings;
  className?: string;
  showSettings?: boolean;
}

interface ImageRenderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function EffectStaticPreview({
  previewFrameDataUrl,
  selectedPlayer,
  effect,
  effectSettings,
  className = '',
  showSettings = true
}: EffectStaticPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  /**
   * **IMAGE RENDER BOX**: Calculate actual image render area within container
   * Similar to video render box but for images with object-contain scaling
   */
  const getImageRenderBox = useCallback((): ImageRenderBox | null => {
    const container = containerRef.current;
    const image = imageRef.current;
    
    if (!container || !image || !imageDimensions) {
      return null;
    }
    
    // Get container dimensions
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    // Calculate image aspect ratio
    const imageAspectRatio = imageDimensions.width / imageDimensions.height;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let renderWidth: number;
    let renderHeight: number;
    let renderX: number;
    let renderY: number;
    
    if (imageAspectRatio > containerAspectRatio) {
      // Image is wider - fit to container width, center vertically
      renderWidth = containerWidth;
      renderHeight = containerWidth / imageAspectRatio;
      renderX = 0;
      renderY = (containerHeight - renderHeight) / 2;
    } else {
      // Image is taller - fit to container height, center horizontally
      renderWidth = containerHeight * imageAspectRatio;
      renderHeight = containerHeight;
      renderX = (containerWidth - renderWidth) / 2;
      renderY = 0;
    }
    
    return { x: renderX, y: renderY, width: renderWidth, height: renderHeight };
  }, [imageDimensions]);

  // **SPOTLIGHT RENDERING**: Now uses shared effect renderer for consistency
  // Removed duplicated logic - all effect rendering is handled by shared utility

  /**
   * **RENDER LOOP**: Draw effect on canvas positioned over image
   */
  const renderEffect = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const image = imageRef.current;
    
    if (!canvas || !container || !image || !imageLoaded || !imageDimensions) {
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Get image render area
    const renderBox = getImageRenderBox();
    if (!renderBox) return;
    
    // **DYNAMIC ZOOM AS ADDITIVE TRANSFORM**: Apply zoom transformation if enabled
    const dynamicZoomSettings = effectSettings.dynamicZoom;
    let appliedZoom = false;
    let zoomCropInfo: { sx: number; sy: number; sourceWidth: number; sourceHeight: number } | null = null;
    
    if (dynamicZoomSettings?.enabled) {
      appliedZoom = true;
      
      // **ZOOM LEVEL MAPPING**: Convert intensity to actual zoom levels
      const zoomLevels = {
        'subtle': 1.3,
        'moderate': 1.8,
        'dramatic': 2.4
      };
      
      const currentZoom = zoomLevels[dynamicZoomSettings.intensity] || 1.8;
      
      // **PLAYER FOCUS**: Use player center for zoom focal point
      const safePlayer = createSafePlayer(selectedPlayer);
      let focusX = 0.5; // Default center
      let focusY = 0.5;
      
      if (safePlayer) {
        // **FIX**: Use centerX/centerY (not x/y which are top-left), with fallback
        focusX = safePlayer.centerX ?? (safePlayer.x + safePlayer.width / 2);
        focusY = safePlayer.centerY ?? (safePlayer.y + safePlayer.height / 2);
      }
      
      // **VISUAL ZOOM PREVIEW**: Draw zoomed image section to canvas
      const sourceWidth = imageDimensions.width / currentZoom;
      const sourceHeight = imageDimensions.height / currentZoom;
      
      // Calculate focal point in original image pixels
      const imageFocusX = focusX * imageDimensions.width;
      const imageFocusY = focusY * imageDimensions.height;
      
      // Clamp source rectangle to stay within image bounds
      const sx = Math.max(0, Math.min(imageFocusX - sourceWidth / 2, imageDimensions.width - sourceWidth));
      const sy = Math.max(0, Math.min(imageFocusY - sourceHeight / 2, imageDimensions.height - sourceHeight));
      
      // **CRITICAL**: Store crop info for overlay coordinate mapping
      zoomCropInfo = { sx, sy, sourceWidth, sourceHeight };
      
      // Draw the zoomed section to fill the entire render area
      ctx.drawImage(
        image,
        sx, sy, sourceWidth, sourceHeight,  // Source rectangle (zoomed area)
        renderBox.x, renderBox.y, renderBox.width, renderBox.height  // Destination
      );
      
      // Debug logging for zoom preview (reduced noise)
      if (Math.random() < 0.1) { // Log ~10% of renders to reduce noise
        console.log('🔍 Dynamic Zoom preview:', {
          intensity: dynamicZoomSettings.intensity,
          zoom: currentZoom,
          focus: { x: focusX.toFixed(3), y: focusY.toFixed(3) },
          crop: { sx: sx.toFixed(1), sy: sy.toFixed(1), sw: sourceWidth.toFixed(1), sh: sourceHeight.toFixed(1) }
        });
      }
      
      // Continue to render spotlight effects on top of zoomed image
    } else {
      // **NO ZOOM**: Draw regular unzoomed image first
      ctx.drawImage(
        image,
        0, 0, imageDimensions.width, imageDimensions.height,  // Source: full image
        renderBox.x, renderBox.y, renderBox.width, renderBox.height  // Destination
      );
    }
    
    // **SPOTLIGHT EFFECTS**: Render overlay effects on top of image (zoomed or unzoomed)
    if (!hasValidPlayer(selectedPlayer)) {
      return;
    }
    
    // **BULLETPROOF VALIDATION**: Use safe player validation
    const safePlayer = createSafePlayer(selectedPlayer);
    if (!safePlayer) {
      console.warn('⚠️ Invalid selectedPlayer, using safe access:', selectedPlayer);
      return;
    }
    
    // **COORDINATE CONVERSION**: Normalized [0,1] to pixel coordinates
    // **FIX**: Use centerX/centerY (not x/y which are top-left), with fallback
    const centerX = safePlayer.centerX ?? (safePlayer.x + safePlayer.width / 2);
    const centerY = safePlayer.centerY ?? (safePlayer.y + safePlayer.height / 2);
    
    let pixelCenterX: number;
    let pixelCenterY: number;
    
    if (zoomCropInfo) {
      // **ZOOM ACTIVE**: Map coordinates through the cropped region
      // Player center in original image pixels
      const playerImgX = centerX * imageDimensions.width;
      const playerImgY = centerY * imageDimensions.height;
      
      // Position relative to crop region [0,1]
      const relativeX = (playerImgX - zoomCropInfo.sx) / zoomCropInfo.sourceWidth;
      const relativeY = (playerImgY - zoomCropInfo.sy) / zoomCropInfo.sourceHeight;
      
      // Map to render box (clamped if player is outside crop)
      pixelCenterX = renderBox.x + (relativeX * renderBox.width);
      pixelCenterY = renderBox.y + (relativeY * renderBox.height);
    } else {
      // **NO ZOOM**: Direct mapping from normalized to pixel
      pixelCenterX = renderBox.x + (centerX * renderBox.width);
      pixelCenterY = renderBox.y + (centerY * renderBox.height);
    }
    
    // **DYNAMIC SIZING**: Calculate actual trackingBox pixel dimensions
    let trackingBoxPixels: { width: number; height: number };
    
    if (zoomCropInfo) {
      // **ZOOM ACTIVE**: Scale box dimensions by zoom factor
      // The crop makes the player appear larger, so the overlay box must scale too
      const zoomFactor = imageDimensions.width / zoomCropInfo.sourceWidth;
      trackingBoxPixels = {
        width: safePlayer.width * renderBox.width * zoomFactor,
        height: safePlayer.height * renderBox.height * zoomFactor
      };
    } else {
      // **NO ZOOM**: Direct mapping
      trackingBoxPixels = {
        width: safePlayer.width * renderBox.width,
        height: safePlayer.height * renderBox.height
      };
    }
    
    // **FIX**: Use shared effect renderer for consistency
    try {
      renderSpotlightEffect(ctx, pixelCenterX, pixelCenterY, effect, effectSettings, trackingBoxPixels);
    } catch (error) {
      console.error('🚨 Effect rendering failed:', error);
    }
  }, [imageLoaded, imageDimensions, selectedPlayer, effect, effectSettings, getImageRenderBox]);

  /**
   * **CANVAS SYNC**: Keep canvas dimensions matched to container
   */
  const updateCanvasSize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    
    if (!container || !canvas) return;
    
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas dimensions with device pixel ratio for crisp rendering
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    
    // **FIX**: Reset and scale context for high DPI displays (prevent transform compounding)
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to identity matrix
      ctx.scale(dpr, dpr); // Apply DPR scaling
    }
    
    // Re-render effect after size change
    renderEffect();
  }, [renderEffect]);

  // **IMAGE LOAD HANDLER**: Set dimensions and trigger initial render
  const handleImageLoad = useCallback(() => {
    const image = imageRef.current;
    if (!image) return;
    
    setImageDimensions({
      width: image.naturalWidth,
      height: image.naturalHeight
    });
    setImageLoaded(true);
    
    console.log('🖼️ Image loaded:', {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      aspectRatio: (image.naturalWidth / image.naturalHeight).toFixed(3)
    });
  }, []);

  // **EFFECTS**: Set up canvas sync and rendering
  useEffect(() => {
    updateCanvasSize();
  }, [updateCanvasSize]);

  useEffect(() => {
    if (imageLoaded) {
      renderEffect();
    }
  }, [imageLoaded, renderEffect]);

  // **LIVE UPDATES**: Re-render when effect properties change
  // This ensures the preview updates immediately when user adjusts settings
  useEffect(() => {
    if (imageLoaded) {
      renderEffect();
    }
  }, [effect, effectSettings, selectedPlayer, renderEffect, imageLoaded]);

  // **RESIZE OBSERVER**: Keep canvas synced to container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    
    resizeObserver.observe(container);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [updateCanvasSize]);

  // **CLEANUP ON UNMOUNT**: Clear canvas to prevent frozen spotlight artifacts
  useEffect(() => {
    return () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          console.log('🗑️ [EffectStaticPreview] Canvas cleared on unmount');
        }
      }
    };
  }, []);

  // **EFFECT NAME MAPPING**: Use shared utility for consistency
  // Removed duplicated mapping functions

  return (
    <Card className={`overflow-hidden ${className}`}>
      {/* Preview Container */}
      <div 
        ref={containerRef}
        className="relative w-full aspect-video bg-accent/20"
        data-testid="effect-static-preview-container"
      >
        {/* Loading State */}
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Skeleton className="w-16 h-16 rounded-full mx-auto" />
              <p className="text-sm text-muted-foreground">Loading preview...</p>
            </div>
          </div>
        )}
        
        {/* Base Image */}
        <img
          ref={imageRef}
          src={previewFrameDataUrl}
          alt="Effect Preview Frame"
          className="absolute inset-0 w-full h-full object-contain"
          onLoad={handleImageLoad}
          onError={() => console.error('🚨 Failed to load preview frame image')}
          data-testid="effect-preview-image"
        />
        
        {/* Effect Overlay Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none z-10"
          data-testid="effect-preview-canvas"
        />
      </div>
      
      {/* Effect Info */}
      {showSettings && (
        <div className="p-4 border-t bg-card space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium" data-testid="effect-preview-name">
              {getEffectDisplayName(effect)}
            </h4>
            <Badge variant="secondary" data-testid="effect-preview-color">
              {getColorDisplayName(effectSettings.color)}
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            {effect === 'dynamic-zoom' ? (
              <>
                <div>
                  <span className="text-muted-foreground">Zoom Level:</span>
                  <span className="ml-2 font-medium capitalize" data-testid="effect-preview-zoom-level">
                    {effectSettings.dynamicZoom?.intensity || 'Moderate'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span className="ml-2 font-medium" data-testid="effect-preview-zoom-status">
                    {effectSettings.dynamicZoom?.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className="text-muted-foreground">Intensity:</span>
                  <span className="ml-2 font-medium" data-testid="effect-preview-intensity">
                    {effectSettings.intensity}%
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Size:</span>
                  <span className="ml-2 font-medium" data-testid="effect-preview-size">
                    {effectSettings.size}%
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}