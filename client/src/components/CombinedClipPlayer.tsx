import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, RotateCcw, Scissors, Target, User } from "lucide-react";
import PlayerSelection from "@/components/PlayerSelection";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';
import { throttledLog, logThrottler } from '@/lib/logThrottler';

interface DetectedPlayer {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  description: string;
  // Canonical coordinates (normalized [0,1])
  centerX?: number;
  centerY?: number;
  topLeftX?: number;
  topLeftY?: number;
}

// Normalized detection with guaranteed canonical coordinates
interface NormalizedDetectedPlayer extends DetectedPlayer {
  centerX: number;
  centerY: number;
  topLeftX: number;
  topLeftY: number;
}

// Canonicalize detection coordinates to ensure consistent semantics
function normalizeDetections(detections: DetectedPlayer[]): NormalizedDetectedPlayer[] {
  return detections.map(player => {
    // Ensure all coordinates are numeric and in [0,1] range
    const x = Number(player.x) || 0;
    const y = Number(player.y) || 0;
    const width = Number(player.width) || 0.1;
    const height = Number(player.height) || 0.1;
    
    // **COORDINATE FIX**: Server sends x,y as TOP-LEFT coordinates (not center!)
    // Use provided topLeft if available, otherwise use x,y as top-left
    const topLeftX = player.topLeftX != null ? Number(player.topLeftX) : x;
    const topLeftY = player.topLeftY != null ? Number(player.topLeftY) : y;
    
    // Use provided center if available, otherwise calculate from top-left
    const centerX = player.centerX != null ? Number(player.centerX) : (topLeftX + width / 2);
    const centerY = player.centerY != null ? Number(player.centerY) : (topLeftY + height / 2);
    
    return {
      ...player,
      x, // Keep original for compatibility
      y, // Keep original for compatibility
      width: Number(width),
      height: Number(height),
      centerX: Number(centerX),
      centerY: Number(centerY),
      topLeftX: Number(topLeftX),
      topLeftY: Number(topLeftY)
    } as NormalizedDetectedPlayer;
  });
}

// **CRITICAL FIX**: Bounding box helper accounting for object-contain letterboxing
function bbox(player: DetectedPlayer, videoRef: React.RefObject<HTMLVideoElement>, containerRef: React.RefObject<HTMLDivElement>) {
  const video = videoRef.current;
  const container = containerRef.current;
  
  if (!video || !container || !video.videoWidth || !video.videoHeight) {
    return null;
  }
  
  const videoRect = video.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const normalized = normalizeDetections([player])[0];
  
  // **CRITICAL FIX**: Calculate actual rendered video dimensions (excluding letterbox)
  // Video uses object-contain, so actual content may be smaller than element
  const videoAspect = video.videoWidth / video.videoHeight;
  const elementAspect = videoRect.width / videoRect.height;
  
  let renderedWidth, renderedHeight, letterboxX, letterboxY;
  
  if (elementAspect > videoAspect) {
    // Letterbox on sides (pillarbox)
    renderedHeight = videoRect.height;
    renderedWidth = renderedHeight * videoAspect;
    letterboxX = (videoRect.width - renderedWidth) / 2;
    letterboxY = 0;
  } else {
    // Letterbox on top/bottom
    renderedWidth = videoRect.width;
    renderedHeight = renderedWidth / videoAspect;
    letterboxX = 0;
    letterboxY = (videoRect.height - renderedHeight) / 2;
  }
  
  // **ARCHITECT FIX**: Coordinates are relative to container, not video element
  const offsetX = letterboxX;
  const offsetY = letterboxY;
  
  return {
    left: offsetX + normalized.topLeftX * renderedWidth,
    top: offsetY + normalized.topLeftY * renderedHeight,
    width: normalized.width * renderedWidth,
    height: normalized.height * renderedHeight,
    centerX: offsetX + normalized.centerX * renderedWidth,
    centerY: offsetY + normalized.centerY * renderedHeight,
    normalizedTopLeftX: normalized.topLeftX,
    normalizedTopLeftY: normalized.topLeftY,
    normalizedCenterX: normalized.centerX,
    normalizedCenterY: normalized.centerY
  };
}

interface CombinedClipPlayerProps {
  videoUrl?: string;
  videoDuration?: number;
  sessionId?: string | null; // **NEW**: Session ID for isolated tracking
  onTimeSelection?: (start: number, end: number, detectionTime: number) => void;
  onDetectPlayers?: (frameData: Blob, timestamp: number) => void;
  onPlayerSelect?: (player: DetectedPlayer | null) => void;
  onCaptureFrame?: (frameDataUrl: string) => void;
  onConfirm?: () => void;
  onBack?: () => void;
  detectedPlayers?: DetectedPlayer[];
  selectedPlayer?: DetectedPlayer | null;
  fallbackMode?: boolean;
  detectionMessage?: string;
  maxClipLength?: number;
  minClipLength?: number;
  initialDetectionTime?: number; // **FIX**: Receive clicked timeline moment for initialization
}

export default function CombinedClipPlayer({
  videoUrl,
  videoDuration = 60,
  sessionId,
  onTimeSelection,
  onDetectPlayers,
  onPlayerSelect,
  onCaptureFrame,
  onConfirm,
  onBack,
  detectedPlayers = [],
  selectedPlayer,
  fallbackMode = false,
  detectionMessage,
  maxClipLength = 15,
  minClipLength = 1,
  initialDetectionTime
}: CombinedClipPlayerProps) {
  // Video state
  const [currentTime, setCurrentTime] = useState(initialDetectionTime || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [actualVideoDuration, setActualVideoDuration] = useState(videoDuration);
  
  // Timeline state
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(15);
  const [detectionTime, setDetectionTime] = useState(initialDetectionTime || 7.5); // Use prop or middle of initial selection
  const [isDragging, setIsDragging] = useState(false);
  
  // Player detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [manualSelection, setManualSelection] = useState<{x: number, y: number} | null>(null);
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const initialSeekDoneRef = useRef<boolean>(false); // **ARCHITECT FIX**: Guard for one-time initial seek
  const lastVideoUrlRef = useRef<string | undefined>(videoUrl); // Track video changes for re-initialization
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastKeyframeDetectionRef = useRef<number>(-1); // Track last keyframe detection playback time
  const keyframeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // **CRITICAL FIX**: Debounce and throttle refs to prevent API flooding
  const detectionInProgressRef = useRef(false);
  const lastDetectionTimeRef = useRef(0);
  const detectionDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // **REMOVED**: Timeline stage does NOT need tracking - only on-demand detection
  // useSpotlightTracker caused infinite loop (70k+ logs) on player selection
  // Tracking is ONLY for Video Preview stage (VideoPreviewPlayer.tsx)

  // **DEBUG**: Log when detectedPlayers prop changes
  useEffect(() => {
    console.log('🔍 COMBINED_CLIP_PLAYER PROPS:', {
      detectedPlayersCount: detectedPlayers.length,
      firstPlayer: detectedPlayers[0] || null,
      allPlayers: detectedPlayers
    });
  }, [detectedPlayers]);

  // **ARCHITECT FIX**: Force initial seek to clicked timeline moment BEFORE any tracker seeks
  // **CRITICAL FIX**: Only seek once per video, reset when video changes (prevents circular loop)
  useLayoutEffect(() => {
    const video = videoRef.current;
    
    console.log('⚠️ SEEK EFFECT TRIGGERED:', {
      videoUrlChanged: videoUrl !== lastVideoUrlRef.current,
      guardState: initialSeekDoneRef.current,
      hasVideo: !!video,
      videoReadyState: video?.readyState,
      deps: {
        videoUrl: videoUrl?.substring(0, 30) + '...',
        startTime,
        initialDetectionTime
      }
    });
    
    // **FIX**: Reset seek guard when video URL changes (allows re-initialization with new video)
    if (videoUrl !== lastVideoUrlRef.current) {
      console.log('🔄 VIDEO URL CHANGED - Resetting seek guard');
      initialSeekDoneRef.current = false;
      lastVideoUrlRef.current = videoUrl;
    }
    
    if (!video || initialSeekDoneRef.current) {
      console.log('🚫 SEEK BLOCKED:', { hasVideo: !!video, guardState: initialSeekDoneRef.current });
      return;
    }

    const enforceInitialSeek = () => {
      if (video.readyState >= 2 && !initialSeekDoneRef.current) { // HAVE_CURRENT_DATA or higher
        // **FIX**: Use initialDetectionTime if provided (clicked timeline moment), otherwise startTime
        // This only runs ONCE per video load, preventing circular loop with parent state updates
        const seekTime = initialDetectionTime !== undefined ? initialDetectionTime : startTime;
        console.log('🎯 PERFORMING VIDEO SEEK:', {
          from: video.currentTime.toFixed(3),
          to: seekTime.toFixed(3),
          reason: 'Initial seek effect'
        });
        video.currentTime = seekTime;
        initialSeekDoneRef.current = true;
        console.log('🚀 INITIAL SEEK APPLIED in CombinedClipPlayer:', {
          currentTime: video.currentTime.toFixed(3),
          readyState: video.readyState,
          initialDetectionTime: initialDetectionTime?.toFixed(3) || 'N/A',
          startTime: startTime.toFixed(3),
          usedSeekTime: seekTime.toFixed(3),
          videoUrl: videoUrl?.substring(0, 50) + '...'
        });
      }
    };

    // Apply immediately if video is already ready
    if (video.readyState >= 2) {
      enforceInitialSeek();
    } else {
      // Wait for video to be ready
      const handleCanPlay = () => {
        enforceInitialSeek();
        video.removeEventListener('canplay', handleCanPlay);
      };
      video.addEventListener('canplay', handleCanPlay);
      
      return () => {
        video.removeEventListener('canplay', handleCanPlay);
      };
    }
  }, [videoUrl]); // Only run when video changes - initialDetectionTime is captured once via closure

  // Keep detection time within selection bounds
  useEffect(() => {
    if (detectionTime < startTime || detectionTime > endTime) {
      const newDetectionTime = startTime + (endTime - startTime) / 2;
      setDetectionTime(newDetectionTime);
    }
  }, [startTime, endTime, detectionTime]);

  // **ARCHITECT FIX**: Only notify parent of EXPLICIT user changes, not during passive playback
  // This prevents circular state loops that cause video jolting
  const notifyParentOfSelection = useCallback(() => {
    onTimeSelection?.(startTime, endTime, detectionTime);
  }, [onTimeSelection, startTime, endTime, detectionTime]);

  // **EXTERNAL-ONLY YOLOv11**: DISABLED automatic keyframe detection scheduler
  // Timeline stage requires ONE detection per paused frame (manual click only)
  // This prevents duplicate Replicate API calls and browser lag
  useEffect(() => {
    // Clear any existing interval (defensive cleanup)
    if (keyframeIntervalRef.current) {
      clearInterval(keyframeIntervalRef.current);
      keyframeIntervalRef.current = null;
    }
    
    // **DISABLED**: No automatic detection scheduler
    // Detection only happens via manual timeline clicks (handleTimelineClick)
    console.log('🚫 TIMELINE: Automatic keyframe detection DISABLED (manual clicks only)');
    
    return () => {
      if (keyframeIntervalRef.current) {
        clearInterval(keyframeIntervalRef.current);
        keyframeIntervalRef.current = null;
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // **CRITICAL FIX**: Debounced detection function to prevent API flooding
  const triggerDebouncedDetection = useCallback(async (clickTime: number) => {
    // Clear any existing debounce timer
    if (detectionDebounceTimerRef.current) {
      clearTimeout(detectionDebounceTimerRef.current);
      detectionDebounceTimerRef.current = null;
    }

    // **GATE 1**: Check if detection is already in progress
    if (detectionInProgressRef.current) {
      console.log('🚫 DETECTION BLOCKED: Already in progress');
      return;
    }

    // **GATE 2**: Prevent detections within 500ms of the last one (same timestamp)
    const timeSinceLastDetection = Date.now() - lastDetectionTimeRef.current;
    const timestampDiff = Math.abs(clickTime - lastKeyframeDetectionRef.current);
    
    if (timeSinceLastDetection < 500 && timestampDiff < 0.2) {
      console.log('🚫 SKIPPING duplicate detection for timestamp', clickTime.toFixed(2) + 's', '(already detected)');
      return;
    }

    // **DEBOUNCE**: Wait 300ms before triggering to batch rapid clicks
    detectionDebounceTimerRef.current = setTimeout(async () => {
      detectionInProgressRef.current = true;
      lastDetectionTimeRef.current = Date.now();
      lastKeyframeDetectionRef.current = clickTime;

      console.log('🎯 TIMELINE CLICK: Triggering API detection at time:', clickTime.toFixed(3));
      
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        if (onDetectPlayers && video && canvas) {
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            // Set canvas dimensions and capture frame
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Convert to blob and call API
            canvas.toBlob(
              async (blob) => {
                if (blob) {
                  try {
                    await onDetectPlayers(blob, clickTime);
                    console.log('✅ TIMELINE CLICK: API detection completed');
                  } finally {
                    detectionInProgressRef.current = false;
                  }
                }
              },
              'image/jpeg',
              0.7
            );
          }
        } else {
          console.log('⚠️ TIMELINE CLICK: Missing onDetectPlayers or video/canvas element');
          detectionInProgressRef.current = false;
        }
      } catch (error) {
        console.error('❌ TIMELINE CLICK: Detection failed:', error);
        detectionInProgressRef.current = false;
      }
    }, 300); // 300ms debounce delay
  }, [onDetectPlayers]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    
    console.log('▶️ PLAY/PAUSE TOGGLED:', {
      currentState: isPlaying ? 'playing' : 'paused',
      newState: !isPlaying ? 'playing' : 'paused',
      videoCurrentTime: video.currentTime.toFixed(3),
      videoReadyState: video.readyState
    });
    
    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimelineClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    const timeline = event.currentTarget;
    const rect = timeline.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickPercent = clickX / rect.width;
    const clickTime = clickPercent * actualVideoDuration;
    
    // Move video to clicked position
    const video = videoRef.current;
    if (video) {
      video.currentTime = clickTime;
    }
    setCurrentTime(clickTime);
    
    // **CRITICAL FIX**: Set detectionTime to clicked position if within selection bounds
    // This ensures effects start exactly when user clicks for player selection
    if (clickTime >= startTime && clickTime <= endTime) {
      setDetectionTime(clickTime);
      
      // **ARCHITECT FIX**: Notify parent of user's explicit detection point change
      // Use setTimeout to ensure state has updated
      setTimeout(() => notifyParentOfSelection(), 0);
      
      // **API DETECTION FIX**: Use debounced detection to prevent flooding
      triggerDebouncedDetection(clickTime);
    }
  };

  const handleSelectionDrag = (event: React.MouseEvent<HTMLDivElement>, dragType: 'start' | 'end' | 'move' | 'detection') => {
    setIsDragging(true);
    const timeline = event.currentTarget.closest('[data-timeline]') as HTMLElement;
    if (!timeline) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const rect = timeline.getBoundingClientRect();
      const moveX = e.clientX - rect.left;
      const movePercent = Math.max(0, Math.min(1, moveX / rect.width));
      const moveTime = movePercent * actualVideoDuration;
      
      if (dragType === 'start') {
        // Enforce both min and max clip length constraints
        const maxAllowedStart = Math.min(endTime - minClipLength, actualVideoDuration - maxClipLength);
        const newStart = Math.max(0, Math.min(moveTime, maxAllowedStart));
        setStartTime(newStart);
        // Keep detection time within bounds
        if (detectionTime < newStart) {
          setDetectionTime(newStart + (endTime - newStart) / 2);
        }
      } else if (dragType === 'end') {
        // Enforce both min and max clip length constraints
        const minAllowedEnd = startTime + minClipLength;
        const maxAllowedEnd = Math.min(actualVideoDuration, startTime + maxClipLength);
        const newEnd = Math.max(minAllowedEnd, Math.min(moveTime, maxAllowedEnd));
        setEndTime(newEnd);
        // Keep detection time within bounds
        if (detectionTime > newEnd) {
          setDetectionTime(startTime + (newEnd - startTime) / 2);
        }
      } else if (dragType === 'move') {
        const duration = endTime - startTime;
        const newStart = Math.max(0, Math.min(actualVideoDuration - duration, moveTime - duration / 2));
        const newEnd = newStart + duration;
        setStartTime(newStart);
        setEndTime(newEnd);
        // Move detection time proportionally
        const detectionOffset = detectionTime - startTime;
        setDetectionTime(newStart + detectionOffset);
      } else if (dragType === 'detection') {
        // Keep detection time within selection bounds
        const newDetectionTime = Math.max(startTime, Math.min(endTime, moveTime));
        setDetectionTime(newDetectionTime);
        
        // Move video to detection time for preview
        const video = videoRef.current;
        if (video) {
          video.currentTime = newDetectionTime;
        }
        setCurrentTime(newDetectionTime);
      }
    };
    
    const handleMouseUp = async () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      // **ARCHITECT FIX**: Notify parent of user's explicit selection change
      notifyParentOfSelection();
      
      // **API DETECTION FIX**: Use debounced detection to prevent flooding after drag
      if (dragType === 'detection') {
        console.log('🎯 SELECTION DRAG COMPLETE: Triggering API detection at time:', detectionTime.toFixed(3));
        triggerDebouncedDetection(detectionTime);
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // **ARCHITECT PRESCRIBED FIX**: Use actual video element bounding rect instead of theoretical container math
  const getVideoRenderBox = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    
    if (!video || !container || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    // **NEW**: Use actual video element dimensions, not theoretical calculations
    const videoRect = video.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Calculate real offsets from actual video position
    const offsetX = videoRect.left - containerRect.left;
    const offsetY = videoRect.top - containerRect.top;
    const displayW = videoRect.width;
    const displayH = videoRect.height;
    
    
    return {
      offsetX,
      offsetY,
      displayW,
      displayH,
      containerW: containerRect.width,
      containerH: containerRect.height
    };
  }, []);

  // Player selection now handled entirely by PlayerSelection component

  const handleManualClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const container = containerRef.current;
    
    if (!video || !container || !video.videoWidth || !video.videoHeight) {
      return;
    }
    
    // **ARCHITECT PRESCRIBED FIX**: Use actual video element bounding rect directly
    const videoRect = video.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // **NEW**: Direct video element coordinate normalization
    const normalizedX = (e.clientX - videoRect.left) / videoRect.width;
    const normalizedY = (e.clientY - videoRect.top) / videoRect.height;
    
    // Check if click is within video display area
    if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
      return;
    }
    
    
    if (detectedPlayers.length > 0) {
      // Canonicalize and sort detections by area
      const canonicalDetections = normalizeDetections(detectedPlayers);
      const sortedDetections = canonicalDetections.sort((a, b) => (a.width * a.height) - (b.width * b.height));
      
      // Test bounding-box inclusion with canonical coordinates
      for (const player of sortedDetections) {
        const withinX = normalizedX >= player.topLeftX && normalizedX <= (player.topLeftX + player.width);
        const withinY = normalizedY >= player.topLeftY && normalizedY <= (player.topLeftY + player.height);
        
        if (withinX && withinY) {
          // Player selection handled by PlayerSelection component
          return;
        }
      }
      
      // Fallback: Nearest-center selection with scaled threshold
      let nearestPlayer: NormalizedDetectedPlayer | null = null;
      let nearestDistance = Infinity;
      
      for (const player of canonicalDetections) {
        const distance = Math.sqrt(
          Math.pow(normalizedX - player.centerX, 2) + 
          Math.pow(normalizedY - player.centerY, 2)
        );
        
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPlayer = player;
        }
      }
      
      if (nearestPlayer) {
        const scaledThreshold = Math.min(0.2, 0.5 * Math.sqrt(nearestPlayer.width * nearestPlayer.width + nearestPlayer.height * nearestPlayer.height));
        if (nearestDistance <= scaledThreshold) {
          // Player selection handled by PlayerSelection component
          return;
        }
      }
    }
    
    // No detections or click too far from any detection - create manual selection
    if (!fallbackMode && detectedPlayers.length > 0) {
      return;
    }
    
    const manualPlayer: DetectedPlayer = {
      id: 'manual_selection',
      x: normalizedX,
      y: normalizedY,
      width: 0.1,
      height: 0.1,
      confidence: 1.0,
      description: 'Manual Selection',
      centerX: normalizedX,
      centerY: normalizedY,
      topLeftX: normalizedX - 0.05,
      topLeftY: normalizedY - 0.05
    };
    
    // **FIXED**: Store pixel position using actual video rect
    setManualSelection({ 
      x: videoRect.left + normalizedX * videoRect.width - containerRect.left, 
      y: videoRect.top + normalizedY * videoRect.height - containerRect.top 
    });
    onPlayerSelect?.(manualPlayer);
    
    // Capture preview frame at detection timestamp for manual selection
    captureCurrentFrame();
  };

  const captureAndDetectPlayers = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !onDetectPlayers) return;
    
    setIsDetecting(true);
    
    try {
      // Move video to detection time and wait for seek to complete
      await new Promise<void>((resolve, reject) => {
        const handleSeeked = () => {
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('error', handleError);
          resolve();
        };
        
        const handleError = () => {
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('error', handleError);
          reject(new Error('Failed to seek to detection time'));
        };
        
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('error', handleError);
        
        video.currentTime = detectionTime;
        setCurrentTime(detectionTime);
        
        // Fallback timeout in case seeked event doesn't fire
        setTimeout(() => {
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('error', handleError);
          resolve();
        }, 2000);
      });
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw current frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // ZERO-LAG OPTIMIZATION: Use toBlob (non-blocking, smaller payload)
      await new Promise<void>((resolve) => {
        canvas.toBlob(
          async (blob) => {
            if (blob) {
              await onDetectPlayers(blob, detectionTime);
            }
            resolve();
          },
          'image/jpeg',
          0.7
        );
      });
    } catch (error) {
      console.error('Failed to detect players:', error);
    } finally {
      setIsDetecting(false);
    }
  };

  // **NEW**: Capture and detect at current playback position (no seeking)
  const captureKeyframeDetection = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !selectedPlayer) return;
    
    const currentTime = video.currentTime;
    
    // **ARCHITECT FIX**: Clip bounds check - only detect within selected range
    if (currentTime < startTime || currentTime > endTime) {
      console.log('⏭️ Skipping keyframe detection - outside clip bounds');
      return;
    }
    
    // **ARCHITECT FIX**: Update playback time IMMEDIATELY to prevent spam
    lastKeyframeDetectionRef.current = currentTime;
    
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // PERFORMANCE FIX: Downscale to 480px width max for faster detection
      const maxWidth = 480;
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      const aspectRatio = videoWidth / videoHeight;
      
      let targetWidth = videoWidth;
      let targetHeight = videoHeight;
      
      if (videoWidth > maxWidth) {
        targetWidth = maxWidth;
        targetHeight = Math.round(maxWidth / aspectRatio);
      }
      
      // Set canvas dimensions
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      
      // Draw current playback frame
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
      
      console.log('🎯 KEYFRAME DETECTION at time:', currentTime.toFixed(2), 'selected player:', selectedPlayer?.id);
      
      // **LAG FIX**: POST directly to backend AND feed into tracker (dual path for compatibility)
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.7);
      });
      
      // Path 1: Call parent callback (for UI updates)
      if (onDetectPlayers) {
        await onDetectPlayers(blob, currentTime);
      }
      
      // Path 2: Feed into tracker's ingestDetections (for spotlight tracking)
      const formData = new FormData();
      formData.append('frame', blob, 'frame.jpg');
      formData.append('timestampMs', (currentTime * 1000).toString());
      formData.append('videoId', sessionId || 'fallback-timeline-session'); // **CRITICAL**: Use sessionId for isolated tracking
      formData.append('detectionMethod', 'replicate');
      
      // **FIX**: Send both ID and full coordinates for spatial tracking
      if (selectedPlayer && selectedPlayer.id) {
        formData.append('selectedPlayerId', selectedPlayer.id);
        
        // **SPATIAL FIX**: Normalize player coordinates before sending to ensure all fields are present
        const { normalizePlayerForDetection } = await import('@/utils/playerCoordinates');
        const normalizedPlayer = normalizePlayerForDetection(selectedPlayer);
        
        if (normalizedPlayer) {
          formData.append('selectedPlayer', JSON.stringify(normalizedPlayer));
        }
      }
      
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.players && result.players.length > 0) {
          console.log('✅ Keyframe detection successful (direct Replicate GPU)');
          // Timeline stage: detection results displayed via parent component's state
          // No tracker ingestion needed here
        }
      }
    } catch (error) {
      console.error('❌ Keyframe detection failed:', error);
    }
  };

  const captureCurrentFrame = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !onCaptureFrame) return;
    
    try {
      // Move video to detection time and wait for seek to complete
      await new Promise<void>((resolve, reject) => {
        const handleSeeked = () => {
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('error', handleError);
          resolve();
        };
        
        const handleError = () => {
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('error', handleError);
          reject(new Error('Failed to seek to detection time'));
        };
        
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('error', handleError);
        
        video.currentTime = detectionTime;
        setCurrentTime(detectionTime);
        
        // Fallback timeout in case seeked event doesn't fire
        setTimeout(() => {
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('error', handleError);
          resolve();
        }, 2000);
      });
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw current frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert to data URL
      const frameDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      
      // Preview frame captured
      onCaptureFrame(frameDataUrl);
    } catch (error) {
      console.error('Failed to capture preview frame:', error);
    }
  };

  const handleReset = () => {
    setCurrentTime(0);
    setStartTime(0);
    const resetEndTime = Math.min(15, actualVideoDuration);
    setEndTime(resetEndTime);
    setDetectionTime(resetEndTime / 2);
    setIsPlaying(false);
    setManualSelection(null);
    onPlayerSelect?.(null);
    console.log('Combined player reset to duration:', actualVideoDuration);
  };

  const selectedDuration = endTime - startTime;

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-display font-semibold mb-2">Select Your Clip & Player</h3>
        <p className="text-sm text-muted-foreground">
          Choose up to {maxClipLength} seconds for your highlight, then position the detection marker and identify your player
        </p>
      </div>

      {/* Video Preview with Player Overlays */}
      <div 
        ref={containerRef}
        className="relative mb-6 bg-black rounded-lg aspect-video"
        style={{ overflow: 'visible' }}
        onClick={(e) => {
          console.log('🔍 [DEBUG] Container clicked:', {
            target: (e.target as HTMLElement).tagName,
            dataRole: (e.target as HTMLElement).getAttribute('data-role'),
            playerId: (e.target as HTMLElement).getAttribute('data-player-id'),
            classList: (e.target as HTMLElement).className
          });
        }}
      >
        <div 
          className={`w-full h-full ${fallbackMode || detectedPlayers.length === 0 ? 'cursor-crosshair' : 'pointer-events-none'}`}
          onClick={fallbackMode ? handleManualClick : undefined}
        >
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain pointer-events-none"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                const duration = e.currentTarget.duration;
                if (duration && !isNaN(duration) && duration > 0) {
                  setActualVideoDuration(duration);
                  console.log('Video loaded, actual duration:', duration);
                  
                  // Adjust timeline if current selection exceeds video duration
                  if (endTime > duration) {
                    const newEndTime = Math.min(duration, Math.max(startTime + minClipLength, maxClipLength));
                    setEndTime(newEndTime);
                    setDetectionTime(startTime + (newEndTime - startTime) / 2);
                  }
                }
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              controls={false}
              muted
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/60">
              <div className="text-center">
                <Play className="w-16 h-16 mx-auto mb-2 opacity-50" />
                <p>Video preview will appear here</p>
                <p className="text-sm mt-1">Timeline and player selection</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <Button
            size="icon"
            variant="secondary"
            className="w-16 h-16 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm pointer-events-auto"
            onClick={handlePlayPause}
            data-testid="button-play-pause"
          >
            {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
          </Button>
        </div>

        {/* Hidden canvas for frame capture */}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* PLAYER DETECTION OVERLAYS - Show bounding boxes around all detected players */}
        {/* **CRITICAL FIX**: Defensive de-duplication to prevent duplicate overlays */}
        {(() => {
          // Remove duplicates by ID, keeping highest confidence
          const uniquePlayers = new Map<string, typeof detectedPlayers[0]>();
          for (const player of detectedPlayers) {
            const existing = uniquePlayers.get(player.id);
            if (existing && player.confidence > existing.confidence) {
              uniquePlayers.set(player.id, player);
            } else if (!existing) {
              uniquePlayers.set(player.id, player);
            }
          }
          const result = Array.from(uniquePlayers.values());
          
          // **THROTTLED**: Log rendering attempt (throttled to prevent console flooding)
          if (result.length > 0) {
            throttledLog('bbox-render', `🎯 RENDERING ${result.length} BBOXES`, {
              count: result.length,
              firstPlayerId: result[0]?.id,
              hasVideoRef: !!videoRef.current,
              hasContainerRef: !!containerRef.current
            });
          }
          
          return result;
        })().map((player, index) => {
          const pixelPos = bbox(player, videoRef, containerRef);
          
          // **THROTTLED**: Log bbox calculation result (throttled to prevent console flooding)
          throttledLog('bbox-calculation', `📐 BBOX for ${player.id}`, {
            playerId: player.id,
            hasPixelPos: !!pixelPos,
            pixelPos: pixelPos || 'NULL'
          });
          
          if (!pixelPos) {
            return null;
          }
          
          return (
            <button
              key={`${player.id}-${index}`}
              type="button"
              className={`absolute cursor-pointer transition-all z-[100] rounded-md pointer-events-auto border-0 ${
                selectedPlayer?.id === player.id 
                  ? 'bg-primary/40 shadow-[inset_0_0_0_2px_hsl(var(--primary))]'
                  : 'bg-white/10 hover:bg-primary/25 hover:shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
              }`}
              style={{
                left: `${pixelPos.left}px`,
                top: `${pixelPos.top}px`,
                width: `${pixelPos.width}px`,
                height: `${pixelPos.height}px`,
              }}
              onClick={(e) => {
                console.log('🔥 [UI] bbox onClick fired:', { id: player.id });
                e.stopPropagation();
                e.preventDefault();
                if (onPlayerSelect) {
                  console.log('🎯 CALLING onPlayerSelect with player:', {
                    id: player.id,
                    x: player.x,
                    y: player.y,
                    centerX: player.centerX,
                    centerY: player.centerY,
                    fullPlayer: player
                  });
                  onPlayerSelect(player);
                } else {
                  console.error('❌ onPlayerSelect is undefined!');
                }
              }}
              onPointerUp={(e) => {
                console.log('🎯 [UI] bbox onPointerUp fired:', { id: player.id });
                e.stopPropagation();
                if (onPlayerSelect) {
                  console.log('🎯 CALLING onPlayerSelect with player:', player);
                  onPlayerSelect(player);
                } else {
                  console.error('❌ onPlayerSelect is undefined!');
                }
              }}
              aria-label={`Select player ${player.id}`}
              data-testid={`player-${player.id}`}
              data-role="bbox"
              data-player-id={player.id}
            >
              {/* Player info badge */}
              <div className="absolute -top-6 left-0 bg-black/70 text-white text-xs px-2 py-1 rounded text-nowrap pointer-events-none">
                {player.id}
              </div>
              
              {/* Selection indicator for selected player */}
              {selectedPlayer?.id === player.id && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Target className="w-4 h-4 text-primary animate-pulse" />
                </div>
              )}
            </button>
          );
        })}
        
        {/* Manual Selection Indicator */}
        {manualSelection && selectedPlayer?.id === 'manual_selection' && (
          <div
            className="absolute w-16 h-16 bg-primary/40 rounded-full z-20 shadow-[inset_0_0_0_2px_hsl(var(--primary))]"
            style={{
              left: `${manualSelection.x - 32}px`, // 32px = half of 64px (w-16)
              top: `${manualSelection.y - 32}px`,  // 32px = half of 64px (h-16)
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <Target className="w-8 h-8 text-primary animate-pulse" />
            </div>
            <div className="absolute -top-6 left-0 bg-black/70 text-white text-xs px-2 py-1 rounded text-nowrap">
              Selected Position
            </div>
          </div>
        )}
        

        {/* Detection overlay */}
        {isDetecting && (
          <div className="absolute inset-0 bg-primary/10 flex items-center justify-center backdrop-blur-[0.5px] z-30">
            <div className="text-center text-white">
              <Target className="w-8 h-8 mx-auto mb-2 animate-spin" />
              <p className="text-lg font-medium">Detecting Players...</p>
              <p className="text-sm opacity-80">AI is analyzing the frame at {formatTime(detectionTime)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Timeline Controls */}
      <div className="space-y-6">
        {/* Timeline Header */}
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium">Timeline & Detection Point</label>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Current: {formatTime(currentTime)}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Selection: {formatTime(startTime)} - {formatTime(endTime)}</span>
              <span className={`font-medium ${
                selectedDuration >= minClipLength && selectedDuration <= maxClipLength 
                  ? 'text-green-600' 
                  : 'text-destructive'
              }`}>
                ({selectedDuration.toFixed(1)}s)
              </span>
            </div>
            <span className="text-blue-600">Detection: {formatTime(detectionTime)}</span>
          </div>
        </div>

        {/* Combined Timeline */}
        <div 
          className="relative w-full h-12 bg-muted rounded-md cursor-pointer" 
          onClick={handleTimelineClick}
          data-timeline
          data-testid="timeline-combined"
        >
          {/* Timeline track */}
          <div className="absolute inset-0 bg-gradient-to-r from-muted-foreground/20 to-muted-foreground/10 rounded-md" />
          
          {/* Selection window */}
          <div 
            className="absolute top-0 h-full bg-primary/30 border border-primary rounded-sm transition-all"
            style={{
              left: `${(startTime / actualVideoDuration) * 100}%`,
              width: `${((endTime - startTime) / actualVideoDuration) * 100}%`
            }}
            data-testid="selection-window"
          >
            {/* Selection handles */}
            <div 
              className="absolute left-0 top-0 w-2 h-full bg-primary cursor-ew-resize rounded-l-sm hover:bg-primary/80"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSelectionDrag(e, 'start');
              }}
              data-testid="selection-handle-start"
            />
            <div 
              className="absolute right-0 top-0 w-2 h-full bg-primary cursor-ew-resize rounded-r-sm hover:bg-primary/80"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSelectionDrag(e, 'end');
              }}
              data-testid="selection-handle-end"
            />
            
            {/* Move handle (center area) */}
            <div 
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSelectionDrag(e, 'move');
              }}
              data-testid="selection-move-handle"
            />
            
            {/* Selection label */}
            <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs text-primary font-medium whitespace-nowrap">
              {selectedDuration.toFixed(1)}s clip
            </div>
          </div>
          
          {/* Current time indicator (playhead) */}
          <div 
            className="absolute top-0 w-0.5 h-full bg-destructive z-10 transition-all"
            style={{ left: `${(currentTime / actualVideoDuration) * 100}%` }}
            data-testid="playhead"
          >
            <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-destructive rounded-full" />
          </div>

          {/* Detection playhead */}
          <div 
            className="absolute top-0 w-0.5 h-full bg-blue-600 z-20 transition-all cursor-ew-resize"
            style={{ left: `${(detectionTime / actualVideoDuration) * 100}%` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              handleSelectionDrag(e, 'detection');
            }}
            data-testid="detection-playhead"
          >
            <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-blue-600 rounded-full">
              <Target className="w-2 h-2 text-white absolute top-0.5 left-0.5" />
            </div>
            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 text-xs text-blue-600 font-medium whitespace-nowrap bg-background px-1 rounded">
              Detection
            </div>
          </div>
          
          {/* Time markers */}
          <div className="absolute bottom-0 left-0 text-xs text-muted-foreground transform translate-y-full pt-1">
            0:00
          </div>
          <div className="absolute bottom-0 right-0 text-xs text-muted-foreground transform translate-y-full pt-1">
            {formatTime(actualVideoDuration)}
          </div>
        </div>
        
        {/* Duration validation */}
        {(selectedDuration < minClipLength || selectedDuration > maxClipLength) && (
          <p className="text-xs text-destructive">
            Clip must be between {minClipLength}-{maxClipLength} seconds. Drag the handles to adjust.
          </p>
        )}
      </div>

      {/* Detection Status */}
      <div className="mb-6 mt-8">
        {fallbackMode && detectionMessage && (
          <div className="mb-3 p-4 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
            <div className="flex items-center gap-2">
              <span className="text-orange-600 dark:text-orange-400">⚠️</span>
              <p className="text-sm text-orange-700 dark:text-orange-300">
                {detectionMessage}
              </p>
            </div>
            <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
              Click anywhere on the video to manually select a position.
            </p>
          </div>
        )}
        
        {detectedPlayers.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="default" className="bg-green-600 text-white">
              <Target className="w-3 h-3 mr-1" />
              {detectedPlayers.length} Player{detectedPlayers.length > 1 ? 's' : ''} Detected
            </Badge>
            {selectedPlayer && (
              <Badge variant="outline">
                Player Selected
              </Badge>
            )}
          </div>
        ) : selectedPlayer?.id === 'manual_selection' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="default" className="bg-blue-600 text-white">
              <Target className="w-3 h-3 mr-1" />
              Manual Selection Active
            </Badge>
          </div>
        ) : (
          <Badge variant="outline">
            {fallbackMode ? 'Click on video to select position' : 'No players detected yet'}
          </Badge>
        )}
      </div>

      {/* Control Buttons - Moved to be directly under timeline for better UX */}
      <div className="flex justify-between items-center pt-4 pb-6 border-t border-b">
        <div className="flex gap-2">
          {onBack && (
            <Button
              variant="outline"
              onClick={onBack}
              data-testid="button-back"
            >
              Back
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleReset}
            data-testid="button-reset"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset All
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            variant={isDetecting ? "secondary" : "outline"}
            onClick={captureAndDetectPlayers}
            disabled={isDetecting || !videoUrl}
            data-testid="button-detect-players"
            className={isDetecting ? "animate-pulse" : ""}
          >
            <Target className={`w-4 h-4 mr-2 ${isDetecting ? 'animate-spin' : ''}`} />
            {isDetecting ? 'Analyzing Frame...' : 'Detect Players'}
          </Button>
          
          <Button
            onClick={async () => {
              // Capture preview frame before proceeding to effects
              await captureCurrentFrame();
              // **ARCHITECT FIX**: Notify parent of final selection before proceeding
              notifyParentOfSelection();
              // Then proceed to effects step
              onConfirm?.();
            }}
            disabled={
              selectedDuration < minClipLength || 
              selectedDuration > maxClipLength || 
              !selectedPlayer
            }
            data-testid="button-confirm"
          >
            <Scissors className="w-4 h-4 mr-2" />
            Create Highlight
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <div className="mb-6 p-4 bg-muted/30 rounded-lg">
        <h4 className="font-medium mb-2">How it works:</h4>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>1. Drag the blue selection window to choose your {maxClipLength}-second highlight clip</li>
          <li>2. Move the blue detection marker to the best moment for player identification</li>
          <li>3. Click "Detect Players" to automatically find all players in the frame</li>
          <li>4. Choose your target player by clicking on them, or click anywhere on the video for precise positioning</li>
          <li>5. Your selected player will be highlighted throughout the entire clip</li>
        </ul>
      </div>
    </Card>
  );
}