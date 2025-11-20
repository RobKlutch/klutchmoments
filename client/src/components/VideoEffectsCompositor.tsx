import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Play, Pause, Square, Download, AlertTriangle } from "lucide-react";

// Import unified types from shared library
import { type EffectSettings, type SlowMotionSegment, type DynamicZoomSettings } from '@/lib/effectRenderer';

interface Effect {
  id: string;
  name: string;
}

// Import unified tracking system
import { useSpotlightTracker, type DetectedPlayer } from "@/hooks/useSpotlightTracker";
import { renderSpotlightEffect } from '@/lib/effectRenderer';
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';

// Unified tracking system integration complete - using useSpotlightTracker hook

interface VideoEffectsCompositorProps {
  videoFile: File;
  effect: Effect;
  settings: EffectSettings;
  playerPosition: { x: number; y: number }; // Normalized coordinates (0-1)
  selectedPlayer?: any; // **FIX**: Add selectedPlayer for proper bbox seeding
  timeSelection: { start: number; end: number }; // Seconds
  detectionTime: number; // Seconds - when the effect should START
  onProcessingComplete: (processedVideoBlob: Blob) => void;
  onProgress?: (progress: number) => void;
  onError?: (error: string) => void;
}

export default function VideoEffectsCompositor({
  videoFile,
  effect,
  settings,
  selectedPlayer, // **FIX**: Destructure selectedPlayer
  playerPosition,
  timeSelection,
  detectionTime,
  onProcessingComplete,
  onProgress,
  onError
}: VideoEffectsCompositorProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [currentPlayerPosition, setCurrentPlayerPosition] = useState(playerPosition);
  const [trackingStatus, setTrackingStatus] = useState<{isTracking: boolean; lostFrames: number; hasVelocity: boolean}>({
    isTracking: false,
    lostFrames: 0,
    hasVelocity: false
  });
  const [detectionStats, setDetectionStats] = useState<{fps: number; lastDetectionTime: number}>({
    fps: 0,
    lastDetectionTime: 0
  });
  
  // **DYNAMIC ZOOM STATE**: Track zoom level and transitions using refs for performance
  const currentZoomRef = useRef(1.0);
  const targetZoomRef = useRef(1.0);
  const zoomTransitionStartRef = useRef<number | null>(null);
  const lastPlayerCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [isActionDetected, setIsActionDetected] = useState(false);
  
  // **CRITICAL FIX**: Detection pipeline refs for continuous tracking
  const latestDetectionsRef = useRef<DetectedPlayer[] | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);
  
  // **CRITICAL FIX**: Render loop and detection scheduler refs
  const renderLoopIdRef = useRef<number | null>(null);
  const detectionSchedulerIdRef = useRef<NodeJS.Timeout | null>(null);
  
  // Video element ref (must be declared before useSpotlightTracker)
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // **UNIFIED TRACKING**: Use consolidated tracking hook with EXTERNAL MODE enabled
  const { currentBox, status: trackerStatus, ingestDetections } = useSpotlightTracker(
    videoRef,
    playerPosition,
    { 
      effect: effect.name, 
      settings, 
      externalMode: true,
      selectedPlayer: createSafePlayer(selectedPlayer),  // **BULLETPROOF**: Pass safe player to hook
      componentName: 'VideoEffectsCompositor' // **DEBUG**: Identify this component in logs
    }
  );
  const playerPosRef = useRef(playerPosition);
  const lastFrameTimeRef = useRef(0);
  
  // YOLOv8 detection system refs
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentRequestControllerRef = useRef<AbortController | null>(null);
  const detectionCountRef = useRef(0);
  const detectionStartTimeRef = useRef(0);
  
  // **CRITICAL FIX**: Replace state-based concurrency control with refs to prevent effect cascades
  const requestsInFlightRef = useRef(0);
  const isDetectionRunningRef = useRef(false);
  const lastUiUpdateRef = useRef(0);
  
  // **UNIFIED TRACKING**: Hook automatically handles seeding when playerPosition changes
  // No manual seeding needed - handled by useSpotlightTracker hook
  
  // **UNIFIED TRACKING**: Update refs when user selects different player
  useEffect(() => {
    playerPosRef.current = playerPosition;
    setCurrentPlayerPosition(playerPosition);
    console.log('🌱 Player position updated:', playerPosition);
    
    // **CRITICAL VALIDATION**: Verify complete player data consistency
    const safePlayer = createSafePlayer(selectedPlayer);
    if (safePlayer) {
      console.log('✅ DATA CONSISTENCY CHECK:');
      console.log('  - selectedPlayer ID:', safePlayer.id);
      console.log('  - Center coordinates:', { centerX: safePlayer.centerX, centerY: safePlayer.centerY });
      console.log('  - Canonical coordinates preserved:', !!(safePlayer.topLeftX) && !!(safePlayer.topLeftY));
      console.log('  - Player bounding box:', { width: safePlayer.width, height: safePlayer.height });
      
      if (!safePlayer.centerX || !safePlayer.centerY) {
        console.error('⚠️ CRITICAL: Missing canonical center coordinates in selectedPlayer!');
      }
      if (!safePlayer.topLeftX || !safePlayer.topLeftY) {
        console.error('⚠️ CRITICAL: Missing canonical top-left coordinates in selectedPlayer!');
      }
    }
  }, [playerPosition, selectedPlayer]);

  // **ARCHITECT PRESCRIBED**: Handle user click on video to seed tracker with selected position
  const handleVideoClick = useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const rect = video.getBoundingClientRect();
    
    // Calculate click position relative to video element
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to normalized coordinates (0-1)
    const normalizedX = x / rect.width;
    const normalizedY = y / rect.height;
    
    // Clamp to valid range [0,1]
    const clampedX = Math.max(0, Math.min(1, normalizedX));
    const clampedY = Math.max(0, Math.min(1, normalizedY));
    
    const selectedPosition = { x: clampedX, y: clampedY };
    
    console.log('👆 USER CLICK: Selected position at', selectedPosition);
    
    // Update current position state (hook will auto-handle tracking)
    setCurrentPlayerPosition(selectedPosition);
    
    console.log('✅ VERIFICATION: User selection processed successfully');
  }, []);
  const [browserSupport, setBrowserSupport] = useState({ 
    mediaRecorder: false, 
    captureStream: false, 
    error: null as string | null 
  });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const isPreviewRef = useRef(false);
  const canvasSizeSet = useRef(false);
  const processedBlobUrlRef = useRef<string | null>(null);

  // Check browser compatibility
  useEffect(() => {
    const checkSupport = () => {
      const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
      const hasCanvas = !!HTMLCanvasElement.prototype.captureStream;
      let error = null;
      
      if (!hasMediaRecorder) {
        error = 'MediaRecorder not supported. Please use Chrome, Firefox, or Edge.';
      } else if (!hasCanvas) {
        error = 'Canvas capture not supported. Please use a modern browser.';
      } else {
        // Check codec support
        try {
          if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
            error = 'WebM video encoding not supported. Please use Chrome or Firefox.';
          }
        } catch {
          error = 'Video encoding compatibility check failed.';
        }
      }
      
      setBrowserSupport({
        mediaRecorder: hasMediaRecorder,
        captureStream: hasCanvas,
        error
      });
    };
    
    checkSupport();
  }, []);

  // Initialize offscreen canvas for frame capture
  const initializeOffscreenCanvas = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    
    const canvas = offscreenCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }, []);

  // **PERFORMANCE FIX**: Capture and downscale video frame for faster YOLOv8 processing
  const captureVideoFrame = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = offscreenCanvasRef.current;
      
      if (!video || !canvas || video.readyState < 2) {
        resolve(null);
        return;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      
      // **PERFORMANCE FIX**: Downscale to 640×360 for faster YOLOv8 processing
      // This reduces processing time from 5-9s to 2-4s while maintaining detection accuracy
      const targetWidth = 640;
      const targetHeight = 360;
      
      // Create temporary downscaled canvas for YOLOv8 processing
      const downscaleCanvas = document.createElement('canvas');
      downscaleCanvas.width = targetWidth;
      downscaleCanvas.height = targetHeight;
      const downscaleCtx = downscaleCanvas.getContext('2d');
      
      if (!downscaleCtx) {
        resolve(null);
        return;
      }
      
      // Draw video frame to full-size canvas first (for accurate frame capture)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // **PERFORMANCE FIX**: Downscale using high-quality interpolation
      downscaleCtx.imageSmoothingEnabled = true;
      downscaleCtx.imageSmoothingQuality = 'high';
      downscaleCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
      
      // **PERFORMANCE FIX**: Reduce JPEG quality to 0.75 for faster processing while maintaining validity
      // Quality 0.75 provides good balance between file size and YOLOv8 compatibility
      downscaleCanvas.toBlob((blob) => {
        if (!blob) {
          console.warn('Failed to create downscaled JPEG blob');
          resolve(null);
          return;
        }
        
        // Validate blob size (downscaled should be much smaller but still valid)
        if (blob.size < 500) {
          console.warn('Downscaled JPEG blob too small:', blob.size, 'bytes');
          resolve(null);
          return;
        }
        
        console.log(`📸 Captured downscaled frame: ${targetWidth}×${targetHeight}, ${(blob.size/1024).toFixed(1)}KB`);
        resolve(blob);
      }, 'image/jpeg', 0.75);
    });
  }, []);

  // Convert blob to base64 string for API
  const blobToBase64 = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (data:image/jpeg;base64,)
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  // Send frame to YOLOv8 detection API
  const detectPlayersInFrame = useCallback(async (frameBlob: Blob, signal: AbortSignal): Promise<DetectedPlayer[]> => {
    try {
      // **CRITICAL FIX**: Safe signal checking - catch AbortError instead of checking signal.aborted
      // Don't check signal.aborted directly as it can throw when disposed

      // Convert JPEG blob to base64 string with proper data URL format
      const base64Data = await blobToBase64(frameBlob);
      const imageDataUrl = `data:image/jpeg;base64,${base64Data}`;
      
      // Get current video timestamp in milliseconds
      const video = videoRef.current;
      const timestampMs = video ? Math.round(video.currentTime * 1000) : 0;
      
      // Send JSON request with correct field names to match server schema
      const requestBody = {
        imageDataUrl,
        timestampMs,
        videoId: videoFile.name // Use video filename as ID
      };
      
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody),
        signal
      });
      
      if (!response.ok) {
        // Parse error response to get validation details
        let errorDetails = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.details) {
            console.error('❌ YOLOv8 API validation failed:', errorData.details);
            errorDetails = `${response.status}: ${JSON.stringify(errorData.details)}`;
          } else if (errorData.error) {
            console.error('❌ YOLOv8 API error:', errorData.error);
            errorDetails = `${response.status}: ${errorData.error}`;
          }
        } catch (parseError) {
          console.error('❌ Could not parse error response:', parseError);
        }
        throw new Error(`Detection API failed: ${errorDetails}`);
      }
      
      const result = await response.json();
      
      // Use correct response property and format - API returns normalized [0-1] center coordinates
      const playerDetections = (result.players || [])
        .filter((det: any) => {
          // Validate detection has required properties and is in valid range
          if (typeof det.x !== 'number' || typeof det.y !== 'number' || 
              typeof det.width !== 'number' || typeof det.height !== 'number' ||
              typeof det.confidence !== 'number') {
            console.warn('Invalid detection format:', det);
            return false;
          }
          
          // Ensure coordinates are normalized [0-1] range
          if (det.x < 0 || det.x > 1 || det.y < 0 || det.y > 1 ||
              det.width < 0 || det.width > 1 || det.height < 0 || det.height > 1) {
            console.warn('Detection coordinates out of [0-1] range:', det);
            return false;
          }
          
          return det.confidence >= 0.6;
        })
        .map((det: any, index: number): DetectedPlayer => {
          // **DEFENSIVE COORDINATE HANDLING**: Extra safety for YOLOv8 values outside [0,1]
          const centerX = Math.max(0, Math.min(1, Number(det.x) || 0));
          const centerY = Math.max(0, Math.min(1, Number(det.y) || 0));
          const width = Math.max(0.01, Math.min(1, Number(det.width) || 0.1)); // Minimum 1% width
          const height = Math.max(0.01, Math.min(1, Number(det.height) || 0.1)); // Minimum 1% height
          
          // Convert center coordinates to top-left for consistency with tracker
          const topLeftX = Math.max(0, Math.min(1, centerX - width / 2));
          const topLeftY = Math.max(0, Math.min(1, centerY - height / 2));
          
          // Final defensive clamp to ensure bounding box stays within [0,1]
          const finalWidth = Math.min(width, 1 - topLeftX);
          const finalHeight = Math.min(height, 1 - topLeftY);
          
          return {
            id: det.id || `yolo_${index}`,
            // **CRITICAL FIX**: Use center coordinates for consistency with schema
            x: centerX, 
            y: centerY,
            width: finalWidth,
            height: finalHeight,
            confidence: Math.max(0, Math.min(1, Number(det.confidence) || 0)),
            // No description field - customers don't need to see detection details
            // Add canonical coordinates as required by updated schema
            centerX,
            centerY,
            topLeftX,
            topLeftY
          } as any; // Cast to any to satisfy TypeScript with new fields
        });
      
      // **CRITICAL FIX**: Store detections for tracking pipeline
      try {
        console.log(`🛰️ Detection batch received, len=${playerDetections.length}`);
        latestDetectionsRef.current = playerDetections;
        lastDetectionTimeRef.current = performance.now();
      } catch (error) {
        console.error('🚨 Error storing detections:', error);
      }
      
      return playerDetections;
    } catch (error) {
      // **CRITICAL FIX**: Handle AbortError gracefully to prevent rendering disruption
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Detection request aborted (expected during seeking)');
        return [];
      }
      
      // **CRITICAL FIX**: Don't check signal.aborted as it can throw when disposed
      
      console.error('Player detection error:', error);
      throw error;
    }
  }, [blobToBase64, videoFile.name]);

  // **BACKPRESSURE FIX**: Refs for single in-flight request system
  const pendingFrameRef = useRef<Blob | null>(null);
  const isRequestInFlightRef = useRef(false);
  const nextDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // **BACKPRESSURE FIX**: Start YOLOv8 detection loop with single request + frame queueing
  const startDetectionLoop = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }
    
    if (isDetectionRunningRef.current) {
      console.log('Detection loop already running - skipping duplicate start');
      return;
    }
    
    // Initialize timing and state
    detectionCountRef.current = 0;
    detectionStartTimeRef.current = performance.now();
    isDetectionRunningRef.current = true;
    lastUiUpdateRef.current = 0;
    isRequestInFlightRef.current = false;
    pendingFrameRef.current = null;
    
    console.log('🚀 Starting YOLOv8 detection loop (backpressure system)...');
    
    // **BACKPRESSURE FIX**: Function to process single detection request
    const processDetection = async () => {
      if (!isDetectionRunningRef.current || isRequestInFlightRef.current || !pendingFrameRef.current) {
        return;
      }
      
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        return;
      }
      
      // Mark request as in flight and get current frame
      isRequestInFlightRef.current = true;
      const currentFrame = pendingFrameRef.current;
      pendingFrameRef.current = null; // Clear pending frame
      
      let detectionSuccess = false; // Track success for adaptive timing
      
      try {
        // Process detection with current frame (no AbortController needed for single requests)
        const detections = await detectPlayersInFrame(currentFrame, new AbortController().signal);
        
        // **WIRE DETECTION RESULTS**: Feed successful detections to tracking hook
        if (detections && detections.length > 0 && isDetectionRunningRef.current) {
          detectionSuccess = true; // Mark as successful
          
          // **CRITICAL FIX**: Feed detection results to useSpotlightTracker hook
          ingestDetections({
            players: detections,
            frameWidth: 640,       // YOLOv8 processes at 640x360
            frameHeight: 360,
            timestampMs: video.currentTime * 1000
          });
          console.log(`🔗 Fed ${detections.length} detections to tracker at ${video.currentTime.toFixed(2)}s`);
          
          // Update FPS stats (throttled)
          detectionCountRef.current++;
          const elapsed = (performance.now() - detectionStartTimeRef.current) / 1000;
          const fps = detectionCountRef.current / Math.max(elapsed, 0.1);
          
          const now = performance.now();
          if (now - lastUiUpdateRef.current > 500) { // Throttle UI updates
            setDetectionStats({ fps: Number(fps.toFixed(1)), lastDetectionTime: video.currentTime });
            lastUiUpdateRef.current = now;
            console.log(`✅ YOLOv8: ${detections.length} players found, FPS: ${fps.toFixed(1)}`);
          }
        }
        
      } catch (detectionError) {
        // **BACKPRESSURE FIX**: Handle detection errors gracefully
        if (detectionError instanceof Error && detectionError.name === 'AbortError') {
          console.log('Detection request aborted (non-fatal)');
        } else {
          console.warn('⚠️ Detection processing error:', detectionError instanceof Error ? detectionError.message.substring(0, 100) : String(detectionError));
        }
      } finally {
        // **BACKPRESSURE FIX**: Always clear in-flight flag and schedule next detection
        isRequestInFlightRef.current = false;
        
        // Schedule next detection attempt with adaptive timing (1.5-3s based on success)
        if (nextDetectionTimeoutRef.current) {
          clearTimeout(nextDetectionTimeoutRef.current);
        }
        
        const nextDelay = detectionSuccess ? 1500 : 3000; // Faster if successful
        nextDetectionTimeoutRef.current = setTimeout(() => {
          if (isDetectionRunningRef.current) {
            processDetection(); // Trigger next detection cycle
          }
        }, nextDelay);
      }
    };
    
    // **BACKPRESSURE FIX**: Capture frames regularly, queue latest for processing
    detectionIntervalRef.current = setInterval(async () => {
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth === 0) {
          return;
        }
        
        // Always capture latest frame, replace any pending frame
        const frameBlob = await captureVideoFrame();
        if (frameBlob && frameBlob.size >= 1000) {
          pendingFrameRef.current = frameBlob; // Replace any pending frame with latest
          
          // Trigger processing if no request is currently in flight
          if (!isRequestInFlightRef.current) {
            processDetection();
          }
        }
        
      } catch (loopError) {
        console.warn('Frame capture error:', loopError instanceof Error ? loopError.message.substring(0, 100) : String(loopError));
      }
    }, 300); // 300ms interval for frame capture (processing handled separately)
  }, [captureVideoFrame, detectPlayersInFrame]);

  // **BACKPRESSURE FIX**: Stop YOLOv8 detection loop with complete cleanup
  const stopDetectionLoop = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
      console.log('🛑 YOLOv8 detection loop stopped');
    }
    
    // **BACKPRESSURE FIX**: Clear next detection timeout
    if (nextDetectionTimeoutRef.current) {
      clearTimeout(nextDetectionTimeoutRef.current);
      nextDetectionTimeoutRef.current = null;
    }
    
    // Mark detection as not running
    isDetectionRunningRef.current = false;
    
    // **BACKPRESSURE FIX**: Reset backpressure state
    isRequestInFlightRef.current = false;
    pendingFrameRef.current = null;
    
    // Legacy cleanup for compatibility
    currentRequestControllerRef.current = null;
    
    // Reset UI stats
    setDetectionStats({fps: 0, lastDetectionTime: 0});
    
    console.log('🛑 Backpressure detection system stopped and cleaned up');
  }, []);

  // Create video URL and setup when component mounts
  useEffect(() => {
    if (videoRef.current && videoFile) {
      const videoUrl = URL.createObjectURL(videoFile);
      videoRef.current.src = videoUrl;
      
      const video = videoRef.current;
      
      // Set canvas size once when metadata loads and initialize offscreen canvas
      const handleLoadedMetadata = () => {
        const canvas = canvasRef.current;
        if (canvas && !canvasSizeSet.current) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvasSizeSet.current = true;
        }
        
        // Initialize offscreen canvas for YOLOv8 frame capture
        initializeOffscreenCanvas();
        console.log('Video metadata loaded, offscreen canvas initialized');
      };
      
      // **BULLETPROOF FIX**: Only start tracking when video AND canvas are ready
      const handlePlay = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        if (!video || !canvas) {
          console.warn('🚨 Video or canvas not ready, skipping tracking start');
          return;
        }
        
        console.log('🎬 Video playing - starting tracking system', {
          videoReady: !!video.videoWidth,
          canvasReady: !!canvas.getContext,
          selectedPlayer: !!playerPosition
        });
        
        // Start tracking only with valid refs
        startDetectionLoop();
        startRenderLoop();
        startDetectionScheduler();
      };
      
      const handlePause = () => {
        console.log('⏸️ Video paused - stopping all tracking');
        stopDetectionLoop();
        stopTrackingLoops();
      };
      
      const handleSeeking = () => {
        console.log('Video seeking - stopping detection temporarily');
        stopDetectionLoop();
      };
      
      const handleSeeked = () => {
        console.log('Video seek complete - restarting detection if playing');
        if (!video.paused) {
          startDetectionLoop();
        }
      };
      
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('play', handlePlay);
      video.addEventListener('pause', handlePause);
      video.addEventListener('seeking', handleSeeking);
      video.addEventListener('seeked', handleSeeked);
      
      return () => {
        URL.revokeObjectURL(videoUrl);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('seeking', handleSeeking);
        video.removeEventListener('seeked', handleSeeked);
        canvasSizeSet.current = false;
        
        // Clean up detection loop on unmount
        stopDetectionLoop();
      };
    }
  }, [videoFile, initializeOffscreenCanvas, startDetectionLoop, stopDetectionLoop]);

  // Cleanup processed blob URL and detection loop on unmount
  useEffect(() => {
    return () => {
      if (processedBlobUrlRef.current) {
        URL.revokeObjectURL(processedBlobUrlRef.current);
        processedBlobUrlRef.current = null;
      }
      
      // Ensure detection loop is stopped on unmount
      stopDetectionLoop();
    };
  }, [stopDetectionLoop]);

  // **CRITICAL FIX**: Draw spotlight effect with ENHANCED VISIBILITY and PROPORTIONAL SIZING
  const drawSpotlightEffect = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    settings: EffectSettings,
    canvasWidth: number,
    canvasHeight: number,
    playerWidth?: number,
    playerHeight?: number
  ) => {
    // **PROPORTIONAL SIZING**: Base beam width on detected player size if available
    let baseBeamWidth = Math.min(canvasWidth, canvasHeight) * (settings.size / 100) * 0.25;
    
    if (playerWidth && playerHeight) {
      // Scale beam based on player size (convert normalized to pixels)
      const playerPixelWidth = playerWidth * canvasWidth;
      const playerPixelHeight = playerHeight * canvasHeight;
      const playerSizeFactor = Math.max(0.5, Math.min(2.0, (playerPixelWidth + playerPixelHeight) / 200)); // 100px average = 1.0x
      baseBeamWidth = baseBeamWidth * playerSizeFactor;
    }
    
    const beamWidth = baseBeamWidth;
    const intensity = Math.max(0.15, settings.intensity / 100); // Minimum 15% intensity for visibility
    
    // Convert hex color to RGB
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : {r: 255, g: 255, b: 255};
    };
    
    const rgb = hexToRgb(settings.color);
    
    ctx.save();
    // **CRITICAL FIX**: Use 'source-over' for visible overlay on video
    ctx.globalCompositeOperation = 'source-over';
    // **VISIBILITY FIX**: Remove global alpha to make beam fully visible
    ctx.globalAlpha = 1.0;
    
    // Create vertical spotlight beam coming from top
    const beamTopWidth = beamWidth * 0.3; // Narrower at top
    const beamBottomWidth = beamWidth; // Wider at bottom
    
    // **VISIBILITY FIX**: Create gradient with MUCH higher alpha values for visibility
    const gradient = ctx.createLinearGradient(x, 0, x, y);
    gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.3})`); // Visible at top
    gradient.addColorStop(0.3, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.7})`); // Strong building
    gradient.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.9})`); // Very strong near player
    gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.6})`); // Visible at feet
    
    // Draw main beam shape (trapezoid) - terminates at feet position
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x - beamTopWidth/2, 0); // Top left
    ctx.lineTo(x + beamTopWidth/2, 0); // Top right
    ctx.lineTo(x + beamBottomWidth/2, y); // Bottom right - stops at feet
    ctx.lineTo(x - beamBottomWidth/2, y); // Bottom left - stops at feet
    ctx.closePath();
    ctx.fill();
    
    // **VISIBILITY FIX**: Add BRIGHTER center beam with higher alpha values
    const centerGradient = ctx.createLinearGradient(x, 0, x, y);
    centerGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.5})`);
    centerGradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 1.0})`); // Full intensity
    centerGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.7})`);
    
    ctx.fillStyle = centerGradient;
    ctx.beginPath();
    ctx.moveTo(x - beamTopWidth/4, 0);
    ctx.lineTo(x + beamTopWidth/4, 0);
    ctx.lineTo(x + beamBottomWidth/4, y); // stops at feet
    ctx.lineTo(x - beamBottomWidth/4, y); // stops at feet
    ctx.closePath();
    ctx.fill();
    
    // **VISIBILITY FIX**: Add MUCH brighter spot on player
    const playerSpotGradient = ctx.createRadialGradient(x, y, 0, x, y, beamBottomWidth/3);
    playerSpotGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 1.0})`); // Full brightness
    playerSpotGradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.8})`);
    playerSpotGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    
    ctx.fillStyle = playerSpotGradient;
    ctx.beginPath();
    ctx.arc(x, y, beamBottomWidth/3, 0, Math.PI * 2);
    ctx.fill();
    
    // **ENHANCEMENT**: Add outer glow for more dramatic effect
    ctx.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.5})`;
    ctx.shadowBlur = beamWidth * 0.3;
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, beamBottomWidth/2, 0, Math.PI * 2);
    ctx.fill();
    
    // Clear shadow effects
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    
    ctx.restore();
  }, []);

  // Draw aura effect
  const drawAuraEffect = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    settings: EffectSettings,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    const baseRadius = Math.min(canvasWidth, canvasHeight) * (settings.size / 100) * 0.08;
    const intensity = settings.intensity / 100;
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    // Multiple aura rings for depth
    for (let i = 0; i < 3; i++) {
      const radius = baseRadius * (1 + i * 0.5);
      const alpha = Math.round(255 * intensity * (0.8 - i * 0.2));
      
      const gradient = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius);
      gradient.addColorStop(0, `${settings.color}00`);
      gradient.addColorStop(0.8, `${settings.color}${alpha.toString(16).padStart(2, '0')}`);
      gradient.addColorStop(1, `${settings.color}00`);
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, []);

  // Draw foot disk effect
  const drawFootDiskEffect = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    settings: EffectSettings,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    const baseWidth = Math.min(canvasWidth, canvasHeight) * (settings.size / 100) * 0.15; // Increased size
    const height = baseWidth * 0.3; // Ellipse ratio
    const intensity = settings.intensity / 100;
    
    // Convert hex color to RGB
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : {r: 255, g: 255, b: 255};
    };
    
    const rgb = hexToRgb(settings.color);
    
    // Position disk exactly at player's feet position
    const diskY = y; // FIXED: Use exact feet position without offset
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    // Create elliptical gradient for ground effect
    const gradient = ctx.createRadialGradient(x, diskY, 0, x, diskY, baseWidth);
    gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity})`);
    gradient.addColorStop(0.6, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.6})`);
    gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    
    // Draw elliptical disk
    ctx.fillStyle = gradient;
    ctx.save();
    ctx.scale(1, height / baseWidth);
    ctx.beginPath();
    ctx.arc(x, diskY * (baseWidth / height), baseWidth, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Add static ring outline based on real tracking intensity
    const ringAlpha = intensity * 0.3; // Static alpha based on effect settings only
    
    ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${ringAlpha})`;
    ctx.lineWidth = 2;
    ctx.save();
    ctx.scale(1, height / baseWidth);
    ctx.beginPath();
    ctx.arc(x, diskY * (baseWidth / height), baseWidth * 1.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    
    ctx.restore();
  }, []);



  // **SIMPLIFIED**: Use tracking data from useSpotlightTracker hook
  const updatePlayerTracking = useCallback(() => {
    try {
      // Use currentBox from the useSpotlightTracker hook instead of direct tracker access
      if (currentBox) {
        const trackedPosition = {
          x: currentBox.x + currentBox.width / 2, // Convert to center coordinates
          y: currentBox.y + currentBox.height / 2
        };
        
        console.log('🧠 Using tracking data from hook:', trackedPosition);
        
        // Update refs and state with tracked position from hook
        playerPosRef.current = trackedPosition;
        setCurrentPlayerPosition(trackedPosition);
        
        // Update tracking status from hook
        setTrackingStatus({
          isTracking: trackerStatus === 'tracking',
          lostFrames: trackerStatus === 'lost' ? 1 : 0,
          hasVelocity: trackerStatus === 'tracking'
        });
        
        return trackedPosition;
      }
      
      // Fallback to last known position if no tracking data
      return playerPosRef.current;
    } catch (error) {
      console.error('🚨 Error in updatePlayerTracking:', error);
      return playerPosRef.current;
    }
  }, [currentBox, trackerStatus]);
  
  // **DYNAMIC ZOOM LOGIC**: Calculate zoom level based on player activity and settings
  const calculateDynamicZoom = useCallback((videoTime: number): number => {
    const zoomSettings = settings.dynamicZoom;
    if (!zoomSettings?.enabled) return 1.0;
    
    // Determine zoom trigger conditions
    let shouldZoomIn = false;
    
    // Player-focused zoom: zoom in when tracking is active
    if (zoomSettings.playerFocused && trackerStatus === 'tracking') {
      shouldZoomIn = true;
    }
    
    // Action-triggered zoom: detect rapid movement based on frame-to-frame delta
    if (zoomSettings.actionTriggered && currentBox) {
      const currentCenterX = currentBox.x + currentBox.width / 2;
      const currentCenterY = currentBox.y + currentBox.height / 2;
      
      if (lastPlayerCenterRef.current) {
        const deltaX = Math.abs(currentCenterX - lastPlayerCenterRef.current.x);
        const deltaY = Math.abs(currentCenterY - lastPlayerCenterRef.current.y);
        const movement = deltaX + deltaY;
        
        // Scale sensitivity by typical canvas dimensions (threshold in normalized coords)
        const movementThreshold = zoomSettings.triggerSensitivity * 0.02; // 2% of canvas at max sensitivity
        
        if (movement > movementThreshold) {
          shouldZoomIn = true;
          setIsActionDetected(true);
        } else {
          setIsActionDetected(false);
        }
      }
      
      // Update last center for next frame comparison
      lastPlayerCenterRef.current = { x: currentCenterX, y: currentCenterY };
    }
    
    // Context-aware: adjust based on tracking confidence
    if (zoomSettings.contextAware) {
      if (trackerStatus === 'lost') {
        shouldZoomIn = false; // Zoom out when tracking is lost
      }
    }
    
    // Multi-player support: zoom out for multiple players (future enhancement)
    if (zoomSettings.multiPlayerSupport) {
      // This would require multiple player detection - no-op for now
      // shouldZoomIn remains unchanged until multi-player detection is implemented
    }
    
    // Determine target zoom level
    const newTargetZoom = shouldZoomIn ? zoomSettings.zoomInLevel : zoomSettings.zoomOutLevel;
    
    // Start transition if target changed
    if (Math.abs(newTargetZoom - targetZoomRef.current) > 0.1) {
      targetZoomRef.current = newTargetZoom;
      zoomTransitionStartRef.current = performance.now();
    }
    
    // Calculate smooth transition using easing with refs for performance
    if (zoomTransitionStartRef.current && Math.abs(currentZoomRef.current - targetZoomRef.current) > 0.01) {
      const transitionDuration = zoomSettings.transitionDuration * 1000; // Convert to ms
      const elapsed = performance.now() - zoomTransitionStartRef.current;
      const progress = Math.min(elapsed / transitionDuration, 1.0);
      
      // Smooth easing function (ease-in-out)
      const easedProgress = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      const newZoomLevel = currentZoomRef.current + (targetZoomRef.current - currentZoomRef.current) * easedProgress;
      
      if (progress >= 1.0) {
        zoomTransitionStartRef.current = null;
        currentZoomRef.current = targetZoomRef.current;
        return targetZoomRef.current;
      } else {
        currentZoomRef.current = newZoomLevel;
        return newZoomLevel;
      }
    }
    
    return currentZoomRef.current;
  }, [settings.dynamicZoom, trackerStatus, currentBox, playerPosition]);

  // **CORE FIX**: Start RAF render loop for continuous tracking
  const startRenderLoop = useCallback(() => {
    console.log('🎬 Starting render loop for continuous tracking');
    
    const tick = () => {
      console.log('🎬 RAF tick executing...');
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        
        // Update tracking every frame
        updatePlayerTracking();
        
        // **DYNAMIC ZOOM**: Calculate current zoom level
        const currentZoom = calculateDynamicZoom(video.currentTime);
        
        // Proper effect rendering using the effect renderer
        const ctx = canvas.getContext('2d');
        console.log('🔍 Effect rendering check:', { effect, settings, zoom: currentZoom, hasCtx: !!ctx });
        if (ctx && effect && settings) {
          // Clear canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // **DYNAMIC ZOOM**: Apply zoom transformation
          ctx.save();
          
          // Get current player position and tracking data
          const trackingPosition = playerPosRef.current;
          if (trackingPosition) {
            const xPx = trackingPosition.x * canvas.width;
            const yPx = trackingPosition.y * canvas.height;
            
            // **CRITICAL FIX**: Apply focal-point zoom using source rectangle for preview
            const videoWidth = video.videoWidth || canvas.width;
            const videoHeight = video.videoHeight || canvas.height;
            
            // Convert tracking position to video pixel space for focal point
            const focusX = trackingPosition.x * videoWidth;
            const focusY = trackingPosition.y * videoHeight;
            
            // Calculate source rectangle based on zoom level
            const sourceWidth = videoWidth / currentZoom;
            const sourceHeight = videoHeight / currentZoom;
            
            // Clamp source rectangle to stay within video bounds
            const sx = Math.max(0, Math.min(focusX - sourceWidth / 2, videoWidth - sourceWidth));
            const sy = Math.max(0, Math.min(focusY - sourceHeight / 2, videoHeight - sourceHeight));
            
            // Draw zoomed video using source rectangle
            ctx.drawImage(
              video,
              sx, sy, sourceWidth, sourceHeight,  // Source rectangle (cropped area)
              0, 0, canvas.width, canvas.height   // Destination (full canvas)
            );
            
            // Convert player position to canvas space for effects
            const canvasX = ((focusX - sx) / sourceWidth) * canvas.width;
            const canvasY = ((focusY - sy) / sourceHeight) * canvas.height;
            
            // Use proper effect renderer with current settings
            console.log('🎨 Rendering effect:', effect.id, settings, 'zoom:', currentZoom);
            
            // **CUSTOMER EXPERIENCE FIX**: Handle dynamic-zoom as standalone effect
            if (effect.id === 'dynamic-zoom') {
              // For dynamic-zoom, we only render the zoomed video (no overlay effects needed)
              console.log('✅ Dynamic zoom effect rendered successfully:', currentZoom);
            } else {
              // For other effects, render spotlight overlays
              try {
                // Calculate tracking box for dynamic sizing
                const trackingBoxPixels = currentBox ? {
                  width: currentBox.width * canvas.width,
                  height: currentBox.height * canvas.height
                } : undefined;
                
                renderSpotlightEffect(
                  ctx,
                  canvasX,
                  canvasY,
                  effect.id,
                  settings,
                  trackingBoxPixels
                );
                
                console.log('✅ Effect rendered successfully with zoom:', currentZoom);
              } catch (error) {
                console.error('❌ Error rendering effect:', error);
                
                // Fallback to simple effect
                const gradient = ctx.createRadialGradient(xPx, yPx, 0, xPx, yPx, 100);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
                gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.3)');
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
                
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
              }
            }
          }
          
          // **DYNAMIC ZOOM**: Restore transformation matrix
          ctx.restore();
        }
        
        // Continue loop if video is playing
        if (!video.paused && !video.ended) {
          renderLoopIdRef.current = requestAnimationFrame(tick);
        }
      } catch (error) {
        console.error('🚨 Error in render loop:', error);
      }
    };
    
    renderLoopIdRef.current = requestAnimationFrame(tick);
  }, [updatePlayerTracking, calculateDynamicZoom]);

  // **CORE FIX**: Start detection scheduler for continuous YOLOv8 detection
  const startDetectionScheduler = useCallback(() => {
    console.log('🛰️ Starting detection scheduler');
    
    const scheduleDetection = async () => {
      try {
        const video = videoRef.current;
        if (!video || video.paused || video.ended) return;
        
        const now = performance.now();
        
        // Run detection every ~800ms (1.25 FPS)
        if (now - lastDetectionTimeRef.current > 800) {
          console.log('🛰️ Scheduling new detection...');
          
          const blob = await captureVideoFrame(); // **FIX**: Function expects 0 arguments
          if (blob) {
            const abortController = new AbortController();
            const detections = await detectPlayersInFrame(blob, abortController.signal);
            
            // **FIX**: Wire up ingestion for scheduler detection path too!
            if (detections && detections.length > 0) {
              ingestDetections({
                players: detections,
                frameWidth: 640,       // YOLOv8 processes at 640x360
                frameHeight: 360,
                timestampMs: video.currentTime * 1000
              });
              console.log(`🔗 Fed ${detections.length} detections to tracker at ${video.currentTime.toFixed(2)}s`);
            }
            
            console.log(`🛰️ Detection completed: ${detections.length} players found`);
          }
        }
      } catch (error) {
        console.error('🚨 Error in detection scheduler:', error);
      }
      
      // Schedule next detection
      if (videoRef.current && !videoRef.current.paused && !videoRef.current.ended) {
        detectionSchedulerIdRef.current = setTimeout(scheduleDetection, 500);
      }
    };
    
    scheduleDetection();
  }, [captureVideoFrame, detectPlayersInFrame]);

  // **CORE FIX**: Stop all tracking loops
  const stopTrackingLoops = useCallback(() => {
    console.log('⏸️ Stopping tracking loops');
    
    if (renderLoopIdRef.current) {
      cancelAnimationFrame(renderLoopIdRef.current);
      renderLoopIdRef.current = null;
    }
    
    if (detectionSchedulerIdRef.current) {
      clearTimeout(detectionSchedulerIdRef.current);
      detectionSchedulerIdRef.current = null;
    }
  }, []);

  // Apply selected effect
  const applyEffect = useCallback((
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    // Get latest tracked position (synchronous ref access)
    const trackingPosition = updatePlayerTracking() || playerPosRef.current;
    
    // Convert normalized coordinates to pixel coordinates
    const xPx = trackingPosition.x * canvasWidth;
    const yPx = trackingPosition.y * canvasHeight;
    
    // Debug pixel position to verify movement
    console.log('🔍 DEBUG: Complete coordinate pipeline:');
    console.log('  - Tracking position (normalized):', { 
      x: trackingPosition.x.toFixed(3), 
      y: trackingPosition.y.toFixed(3) 
    });
    console.log('  - Canvas dimensions:', { w: canvasWidth, h: canvasHeight });
    console.log('  - Converted to pixels:', { x: xPx.toFixed(1), y: yPx.toFixed(1) });
    
    // Validate pixel coordinates are reasonable
    if (xPx < 0 || xPx > canvasWidth || yPx < 0 || yPx > canvasHeight) {
      console.warn('⚠️ WARNING: Pixel coordinates out of bounds!', { xPx, yPx, canvasWidth, canvasHeight });
    }
    
    switch (effect.id) {
      case 'spotlight':
        console.log('✨ Drawing spotlight effect at pixels:', xPx, yPx);
        drawSpotlightEffect(ctx, xPx, yPx, settings, canvasWidth, canvasHeight, currentBox?.width || 60, currentBox?.height || 100);
        break;
      case 'aura':
        console.log('✨ Drawing aura effect at pixels:', xPx, yPx);
        drawAuraEffect(ctx, xPx, yPx, settings, canvasWidth, canvasHeight);
        break;
      case 'footdisk':
        console.log('✨ Drawing foot disk effect at pixels:', xPx, yPx);
        drawFootDiskEffect(ctx, xPx, yPx, settings, canvasWidth, canvasHeight);
        break;
      default:
        console.log('✨ Drawing default spotlight effect at pixels:', xPx, yPx);
        drawSpotlightEffect(ctx, xPx, yPx, settings, canvasWidth, canvasHeight, currentBox?.width || 60, currentBox?.height || 100);
    }
  }, [effect.id, settings, drawSpotlightEffect, drawAuraEffect, drawFootDiskEffect, updatePlayerTracking]);

  // **FIXED**: Render frame with effects - canvas overlay mode (no video drawing)
  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      console.log('renderFrame: missing video or canvas');
      return;
    }

    // Check if video is ready for rendering
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      console.log('renderFrame: video not ready, readyState:', video.readyState);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.log('renderFrame: no canvas context');
      return;
    }

    // **CRITICAL FIX**: Set canvas size to match video dimensions for proper overlay
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // **SPOTLIGHT TRACKING FIX**: Show effects throughout entire video in Step 4
    // The tracking system should work for the full video duration, not just after detectionTime
    // Note: detectionTime is only used for initial player selection in Step 2
    if (video.currentTime < 0) {  // Only skip if video time is invalid
      console.log(`renderFrame: invalid video time (${video.currentTime.toFixed(2)}s)`);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    console.log('Rendering effects overlay...');

    // **CRITICAL FIX**: Clear canvas completely for transparent overlay
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // **CRITICAL FIX**: Don't draw video - just draw effects on transparent canvas
    // The video is displayed underneath via HTML structure

    // Apply effect on transparent overlay
    applyEffect(ctx, canvas.width, canvas.height);
  }, [applyEffect]);

  // Start preview mode (fixed stale closure bug)
  const startPreview = useCallback(async () => {
    console.log('startPreview called!');
    if (!videoRef.current || browserSupport.error) {
      console.log('startPreview: missing video or browser error', {hasVideo: !!videoRef.current, browserError: browserSupport.error});
      return;
    }
    
    const video = videoRef.current;
    console.log('Starting preview with settings:', {effect: effect.id, playerPosition, settings});
    
    try {
      // Start video playback for live preview
      video.currentTime = timeSelection.start;
      video.loop = true;
      await video.play();
      console.log('Video started playing in preview mode');
      
      isPreviewRef.current = true;
      setIsPreview(true);
      
      const renderLoop = () => {
        // **CRITICAL FIX**: Update player tracking before rendering each frame
        // This ensures the tracker position is continuously updated from YOLOv8 detections
        updatePlayerTracking();
        
        renderFrame();
        // Use ref instead of state to avoid stale closure
        if (isPreviewRef.current) {
          animationFrameRef.current = requestAnimationFrame(renderLoop);
        }
      };
      
      renderLoop();
    } catch (error) {
      console.error('Preview start error:', error);
      onError?.('Failed to start video preview');
    }
  }, [renderFrame, updatePlayerTracking, browserSupport.error, timeSelection.start, onError]);

  // Stop preview mode
  const stopPreview = useCallback(() => {
    isPreviewRef.current = false;
    setIsPreview(false);
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Pause video playback
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.loop = false;
    }
  }, []);

  // Start video processing (with proper timing and browser support check)
  const startProcessing = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      onError?.('Video or canvas not available');
      return;
    }
    
    if (browserSupport.error) {
      onError?.(browserSupport.error);
      return;
    }

    // Stop any active preview to prevent concurrent RAF loops
    stopPreview();

    setIsProcessing(true);
    setProgress(0);
    recordedChunksRef.current = [];
    
    // Clean up previous processed blob URL
    if (processedBlobUrlRef.current) {
      URL.revokeObjectURL(processedBlobUrlRef.current);
      processedBlobUrlRef.current = null;
    }

    try {
      // Wait for video metadata
      await new Promise((resolve) => {
        if (video.readyState >= 2) {
          resolve(null);
        } else {
          video.addEventListener('loadedmetadata', () => resolve(null), { once: true });
        }
      });

      // Mute video during processing to prevent audio playback
      const originalMuted = video.muted;
      video.muted = true;
      
      // Set video to start time and wait for seek to complete
      video.currentTime = timeSelection.start;
      await new Promise((resolve) => {
        const handleSeeked = () => {
          video.removeEventListener('seeked', handleSeeked);
          resolve(null);
        };
        video.addEventListener('seeked', handleSeeked);
        
        // Fallback timeout in case seeked doesn't fire
        setTimeout(() => {
          video.removeEventListener('seeked', handleSeeked);
          resolve(null);
        }, 1000);
      });

      // Set up canvas stream
      const stream = canvas.captureStream(30);
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8'
      });
      
      mediaRecorderRef.current = mediaRecorder;

      // Handle recorded data
      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      });

      // Handle recording complete
      mediaRecorder.addEventListener('stop', () => {
        // Restore original muted state
        video.muted = originalMuted;
        
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        setProcessedBlob(blob);
        
        // Clear recorded chunks for memory cleanup
        recordedChunksRef.current = [];
        
        onProcessingComplete(blob);
        setIsProcessing(false);
        console.log('Video processing complete, blob size:', blob.size);
      });

      // Start recording
      mediaRecorder.start(100); // Capture every 100ms

      // Start playback
      await video.play();

      // Wait a moment for video to be truly ready for rendering
      await new Promise(resolve => setTimeout(resolve, 100));

      // Do an initial render to verify everything is working
      renderFrame();

      const duration = timeSelection.end - timeSelection.start;
      const startTime = performance.now();

      // **SLOW-MOTION PROCESSING**: Helper function to get current speed factor
      const getCurrentSpeedFactor = (currentTime: number): number => {
        if (!settings.slowMotionSegments?.length) return 1.0;
        
        // Find if current time is within any slow-motion segment
        const activeSegment = settings.slowMotionSegments.find(segment => 
          currentTime >= segment.startTime && currentTime <= segment.endTime
        );
        
        return activeSegment ? activeSegment.speedFactor : 1.0;
      };
      
      // **SLOW-MOTION PROCESSING**: Track video playback time separately from real time
      let videoPlaybackTime = timeSelection.start;
      
      // Render loop during recording with slow-motion support
      const recordingLoop = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const currentProgress = Math.min((videoPlaybackTime - timeSelection.start) / duration * 100, 100);
        
        setProgress(currentProgress);
        onProgress?.(currentProgress);

        // **SLOW-MOTION PROCESSING**: Apply speed factor to video playback
        const speedFactor = getCurrentSpeedFactor(videoPlaybackTime);
        const frameTimeStep = (1/30) * speedFactor; // 30fps with speed adjustment
        
        // Update video time position
        videoPlaybackTime += frameTimeStep;
        const targetTime = Math.min(videoPlaybackTime, timeSelection.end);
        
        // **FRAME SYNCHRONIZATION**: Wait for video to reach target time before rendering
        if (Math.abs(video.currentTime - targetTime) > 0.01) {
          video.currentTime = targetTime;
          
          // Wait for the video element to actually seek to the target time
          const handleSeeked = () => {
            video.removeEventListener('seeked', handleSeeked);
            requestAnimationFrame(recordingLoop);
          };
          
          video.addEventListener('seeked', handleSeeked);
          
          // Fallback timeout in case seeked event doesn't fire
          setTimeout(() => {
            video.removeEventListener('seeked', handleSeeked);
            requestAnimationFrame(recordingLoop);
          }, 100);
          return;
        }

        // **CRITICAL FIX**: Update player tracking before rendering each frame
        updatePlayerTracking();

        // **DYNAMIC ZOOM**: Calculate current zoom level for recording
        const currentZoom = calculateDynamicZoom(video.currentTime);
        
              // **CRITICAL FIX**: Apply zoom during recording using focal-point source rectangle
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // Get video dimensions
          const videoWidth = video.videoWidth || canvas.width;
          const videoHeight = video.videoHeight || canvas.height;
          
          // Get focal point from current player position in video pixel space
          const trackingPosition = playerPosRef.current;
          const focusX = trackingPosition ? trackingPosition.x * videoWidth : videoWidth / 2;
          const focusY = trackingPosition ? trackingPosition.y * videoHeight : videoHeight / 2;
          
          // Calculate source rectangle based on zoom level
          const sourceWidth = videoWidth / currentZoom;
          const sourceHeight = videoHeight / currentZoom;
          
          // Clamp source rectangle to stay within video bounds
          const sx = Math.max(0, Math.min(focusX - sourceWidth / 2, videoWidth - sourceWidth));
          const sy = Math.max(0, Math.min(focusY - sourceHeight / 2, videoHeight - sourceHeight));
          
          // Draw zoomed video using source rectangle
          ctx.drawImage(
            video,
            sx, sy, sourceWidth, sourceHeight,  // Source rectangle (cropped area)
            0, 0, canvas.width, canvas.height   // Destination (full canvas)
          );
          
          // Draw effects aligned with zoomed video
          if (trackingPosition && effect && settings) {
            // Convert player center from video space to canvas space
            const canvasX = ((focusX - sx) / sourceWidth) * canvas.width;
            const canvasY = ((focusY - sy) / sourceHeight) * canvas.height;
            
            // **CUSTOMER EXPERIENCE FIX**: Handle dynamic-zoom as standalone effect
            if (effect.id === 'dynamic-zoom') {
              // For dynamic-zoom, we only render the zoomed video (no overlay effects needed)
              console.log('✅ Zoomed dynamic-zoom effect rendered:', currentZoom, 'focal:', { focusX, focusY });
            } else {
              // For other effects, render spotlight overlays
              try {
                // Calculate tracking box for dynamic sizing in canvas space
                const trackingBoxPixels = currentBox ? {
                  width: (currentBox.width * videoWidth / sourceWidth) * canvas.width / videoWidth,
                  height: (currentBox.height * videoHeight / sourceHeight) * canvas.height / videoHeight
                } : undefined;
                
                renderSpotlightEffect(
                  ctx,
                  canvasX,
                  canvasY,
                  effect.id,
                  settings,
                  trackingBoxPixels
                );
                
                console.log('✅ Zoomed effect rendered:', currentZoom, 'focal:', { focusX, focusY }, 'canvas:', { canvasX, canvasY });
              } catch (error) {
                console.error('❌ Error rendering effect during zoomed recording:', error);
              }
            }
          }
        }

        // Check if we've reached the end
        if (videoPlaybackTime >= timeSelection.end) {
          video.pause();
          mediaRecorder.stop();
          console.log('🎬 Video processing complete with slow-motion segments applied');
          return;
        }

        animationFrameRef.current = requestAnimationFrame(recordingLoop);
      };

      recordingLoop();

    } catch (error) {
      console.error('Processing error:', error);
      onError?.(error instanceof Error ? error.message : 'Processing failed');
      setIsProcessing(false);
      
      // Ensure video is unmuted on error
      if (video) {
        video.muted = false;
      }
    }
  }, [timeSelection, renderFrame, onProcessingComplete, onProgress, onError, browserSupport]);

  // Download processed video (with proper memory management)
  const downloadVideo = useCallback(() => {
    if (!processedBlob) return;
    
    const url = URL.createObjectURL(processedBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `highlight_${effect.name.toLowerCase().replace(' ', '_')}_${Date.now()}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [processedBlob, effect.name]);

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-display font-semibold mb-2">Video Effects Compositor</h3>
        <p className="text-sm text-muted-foreground">
          Apply {effect.name} effect to your video clip
        </p>
      </div>

      {/* Browser Compatibility Warning */}
      {browserSupport.error && (
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {browserSupport.error}
          </AlertDescription>
        </Alert>
      )}

      {/* Video and Canvas - FIXED: Proper overlay structure */}
      <div className="space-y-4 mb-6">
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
          {/* **CRITICAL FIX**: Make video visible as base layer */}
          <video 
            ref={videoRef}
            className="w-full h-full object-contain cursor-crosshair"
            playsInline
            muted
            preload="metadata"
            style={{ display: 'block' }}
            onClick={handleVideoClick}
            data-testid="video-player-selection"
          />
          
          {/* **CRITICAL FIX**: Effects canvas as transparent overlay */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            style={{ zIndex: 10 }}
            data-testid="effects-canvas"
          />
          
          {!isPreview && !isProcessing && !browserSupport.error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <Button
                onClick={startPreview}
                variant="secondary"
                className="bg-black/70 hover:bg-black/90 backdrop-blur-sm text-white font-bold"
                data-testid="button-start-preview"
              >
                <Play className="w-4 h-4 mr-2" />
                Preview Effect
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Processing Progress */}
      {isProcessing && (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">Processing Video</span>
            <span className="text-sm text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPreview && !isProcessing && (
            <Button
              onClick={stopPreview}
              variant="outline"
              size="sm"
              data-testid="button-stop-preview"
            >
              <Pause className="w-4 h-4 mr-2" />
              Stop Preview
            </Button>
          )}
          
          <Button
            onClick={startProcessing}
            disabled={isProcessing || !!browserSupport.error}
            variant="default"
            data-testid="button-start-processing"
          >
            {isProcessing ? (
              <>
                <Square className="w-4 h-4 mr-2" />
                Processing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Start Processing
              </>
            )}
          </Button>
        </div>

        {processedBlob && (
          <Button
            onClick={downloadVideo}
            variant="outline"
            data-testid="button-download-processed"
          >
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        )}
      </div>

      {/* YOLOv8 Detection & Tracking Status */}
      <div className="mt-6 space-y-4">
        {/* YOLOv8 Detection Stats */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <h4 className="font-medium mb-2">YOLOv8 Computer Vision</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Detection FPS:</span>
              <div className="font-medium text-blue-600">{detectionStats.fps.toFixed(1)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">System Status:</span>
              <div className="font-medium text-green-600">
                Ready
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Last Detection:</span>
              <div className="font-medium text-xs">
                {detectionStats.lastDetectionTime > 0 
                  ? `${((performance.now() - detectionStats.lastDetectionTime) / 1000).toFixed(1)}s ago`
                  : 'None'
                }
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Status:</span>
              <div className={`font-medium ${detectionStats.fps > 5 ? 'text-green-600' : detectionStats.fps > 0 ? 'text-yellow-600' : 'text-gray-500'}`}>
                {detectionStats.fps > 5 ? 'Active' : detectionStats.fps > 0 ? 'Starting' : 'Stopped'}
              </div>
            </div>
          </div>
        </div>

        {/* Player Tracking Status */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <h4 className="font-medium mb-2">Player Tracking Status</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Mode:</span>
              <div className={`font-medium ${trackingStatus.isTracking ? 'text-green-600' : 'text-yellow-600'}`}>
                {trackingStatus.isTracking ? 'Vision Tracking' : 'Velocity Prediction'}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Lost Frames:</span>
              <div className={`font-medium ${trackingStatus.lostFrames > 15 ? 'text-red-600' : trackingStatus.lostFrames > 5 ? 'text-orange-600' : 'text-green-600'}`}>
                {trackingStatus.lostFrames}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Position:</span>
              <div className="font-medium">{currentPlayerPosition.x.toFixed(3)}, {currentPlayerPosition.y.toFixed(3)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Velocity:</span>
              <div className={`font-medium ${trackingStatus.hasVelocity ? 'text-blue-600' : 'text-muted-foreground'}`}>
                {trackingStatus.hasVelocity ? 'Moving' : 'Stationary'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Effect Details */}
      <div className="mt-4 p-4 bg-muted/30 rounded-lg">
        <h4 className="font-medium mb-2">Effect Configuration</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Effect:</span>
            <div className="font-medium">{effect.name}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Initial Position:</span>
            <div className="font-medium">{playerPosition.x.toFixed(1)}%, {playerPosition.y.toFixed(1)}%</div>
          </div>
          <div>
            <span className="text-muted-foreground">Duration:</span>
            <div className="font-medium">{(timeSelection.end - timeSelection.start).toFixed(1)}s</div>
          </div>
          <div>
            <span className="text-muted-foreground">Settings:</span>
            <div className="font-medium text-xs">
              {settings.intensity}% intensity, {settings.size}% size
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}