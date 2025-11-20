import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, RotateCcw, Scissors, Target, User } from "lucide-react";
import { useSpotlightTracker } from "@/hooks/useSpotlightTracker";
import PlayerSelection from "@/components/PlayerSelection";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';

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
    
    // **YOLOv8-ONLY**: YOLOv8 returns x,y as TOP-LEFT coordinates, not center
    // If existing centerX/centerY exist, use them; otherwise calculate center from top-left x,y
    const centerX = Number(player.centerX) || (x + width / 2);
    const centerY = Number(player.centerY) || (y + height / 2);
    
    // Use top-left directly from x,y (YOLOv8's format)
    const topLeftX = Number(player.topLeftX) || x;
    const topLeftY = Number(player.topLeftY) || y;
    
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

// **ARCHITECT PRESCRIBED**: Shared bounding box helper using actual video element dimensions
function bbox(player: DetectedPlayer, videoRef: React.RefObject<HTMLVideoElement>, containerRef: React.RefObject<HTMLDivElement>) {
  const video = videoRef.current;
  const container = containerRef.current;
  
  if (!video || !container || !video.videoWidth || !video.videoHeight) {
    return null;
  }
  
  // **NEW**: Use actual video element bounding rect
  const videoRect = video.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  
  const normalized = normalizeDetections([player])[0];
  
  // **FIXED**: Calculate pixel positions using actual video dimensions
  const offsetX = videoRect.left - containerRect.left;
  const offsetY = videoRect.top - containerRect.top;
  const displayW = videoRect.width;
  const displayH = videoRect.height;
  
  return {
    left: offsetX + normalized.topLeftX * displayW,
    top: offsetY + normalized.topLeftY * displayH,
    width: normalized.width * displayW,
    height: normalized.height * displayH,
    centerX: offsetX + normalized.centerX * displayW,
    centerY: offsetY + normalized.centerY * displayH,
    normalizedTopLeftX: normalized.topLeftX,
    normalizedTopLeftY: normalized.topLeftY,
    normalizedCenterX: normalized.centerX,
    normalizedCenterY: normalized.centerY
  };
}

interface CombinedClipPlayerProps {
  videoUrl?: string;
  videoDuration?: number;
  onTimeSelection?: (start: number, end: number, detectionTime: number) => void;
  onDetectPlayers?: (frameData: string, timestamp: number) => void;
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
}

export default function CombinedClipPlayer({
  videoUrl,
  videoDuration = 60,
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
  minClipLength = 1
}: CombinedClipPlayerProps) {
  // Video state
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [actualVideoDuration, setActualVideoDuration] = useState(videoDuration);
  
  // Timeline state
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(15);
  const [detectionTime, setDetectionTime] = useState(7.5); // Middle of initial selection
  const [isDragging, setIsDragging] = useState(false);
  
  // Player detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [manualSelection, setManualSelection] = useState<{x: number, y: number} | null>(null);
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const initialSeekDoneRef = useRef<boolean>(false); // **ARCHITECT FIX**: Guard for one-time initial seek
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // **CRITICAL FIX**: Integrate useSpotlightTracker for timeline immediate detection
  const {
    currentBox: trackingBox,
    status: trackingStatus,
    trackingStatus: detailedStatus,
    lastDetectionAge,
    immediateTimelineDetection,
    forceRebindToActiveVideo
  } = useSpotlightTracker(
    videoRef,
    hasValidPlayer(selectedPlayer) ? getSafeCoordinates(selectedPlayer) : null,
    {
      effect: 'default',
      settings: {},
      selectedPlayer: selectedPlayer,
      componentName: 'CombinedClipPlayer'
    }
  );

  // **ARCHITECT FIX**: Force initial seek to timeline start BEFORE any tracker seeks
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || initialSeekDoneRef.current) return;

    const enforceInitialSeek = () => {
      if (video.readyState >= 2 && !initialSeekDoneRef.current) { // HAVE_CURRENT_DATA or higher
        const timelineStart = startTime; // Should be 0 for timeline start
        video.currentTime = timelineStart;
        initialSeekDoneRef.current = true;
        console.log('🚀 INITIAL SEEK APPLIED in CombinedClipPlayer:', {
          currentTime: video.currentTime.toFixed(3),
          readyState: video.readyState,
          timelineStart: timelineStart.toFixed(3)
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
  }, [startTime]); // Re-run when startTime changes

  // Keep detection time within selection bounds
  useEffect(() => {
    if (detectionTime < startTime || detectionTime > endTime) {
      const newDetectionTime = startTime + (endTime - startTime) / 2;
      setDetectionTime(newDetectionTime);
    }
  }, [startTime, endTime, detectionTime]);

  // Notify parent of time selection changes (avoid infinite loop)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onTimeSelection?.(startTime, endTime, detectionTime);
    }, 100); // Debounce to prevent excessive calls
    
    return () => clearTimeout(timeoutId);
  }, [startTime, endTime, detectionTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    
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
      
      // **ARCHITECT PRESCRIBED FIX**: Trigger immediate detection on timeline click
      console.log('🎯 TIMELINE CLICK: Triggering immediate detection at time:', clickTime.toFixed(3));
      try {
        if (immediateTimelineDetection && selectedPlayer && video) {
          await immediateTimelineDetection(video, clickTime, 'timeline_click');
          console.log('✅ TIMELINE CLICK: Immediate detection completed');
        } else {
          console.log('⚠️ TIMELINE CLICK: Missing immediateTimelineDetection, selectedPlayer, or video element');
        }
      } catch (error) {
        console.error('❌ TIMELINE CLICK: Detection failed:', error);
      }
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
      
      // **ARCHITECT PRESCRIBED FIX**: Trigger immediate detection after drag completion
      if (dragType === 'detection' && immediateTimelineDetection && selectedPlayer) {
        console.log('🎯 SELECTION DRAG COMPLETE: Triggering immediate detection at time:', detectionTime.toFixed(3));
        try {
          const video = videoRef.current;
          if (video) {
            await immediateTimelineDetection(video, detectionTime, 'selection_drag');
            console.log('✅ SELECTION DRAG: Immediate detection completed');
          }
        } catch (error) {
          console.error('❌ SELECTION DRAG: Detection failed:', error);
        }
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
      
      // Convert to data URL
      const frameDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      
      // Frame captured for player detection
      await onDetectPlayers(frameDataUrl, detectionTime);
    } catch (error) {
      console.error('Failed to detect players:', error);
    } finally {
      setIsDetecting(false);
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
        className="relative mb-6 bg-black rounded-lg overflow-hidden aspect-video"
      >
        <div 
          className={`w-full h-full ${fallbackMode || detectedPlayers.length === 0 ? 'cursor-crosshair' : ''}`}
          onClick={handleManualClick}
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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
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
            if (existing) {
              console.warn(`⚠️ CLIENT DUPLICATE: ${player.id} - keeping higher confidence`);
              if (player.confidence > existing.confidence) {
                uniquePlayers.set(player.id, player);
              }
            } else {
              uniquePlayers.set(player.id, player);
            }
          }
          return Array.from(uniquePlayers.values());
        })().map((player, index) => {
          console.log('🔍 Rendering player overlay:', player.id, player);
          const pixelPos = bbox(player, videoRef, containerRef);
          console.log('🔍 Pixel position for player', player.id, ':', pixelPos);
          if (!pixelPos) {
            console.log('❌ No pixel position for player', player.id, '- overlay will not render');
            return null;
          }
          
          return (
            <div
              key={`${player.id}-${index}`}
              className={`absolute cursor-pointer transition-all z-20 rounded-md ${
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
                e.stopPropagation();
                onPlayerSelect?.(player);
              }}
              data-testid={`player-${player.id}`}
            >
              {/* Player info badge */}
              <div className="absolute -top-6 left-0 bg-black/70 text-white text-xs px-2 py-1 rounded text-nowrap">
                {player.id}
              </div>
              
              {/* Selection indicator for selected player */}
              {selectedPlayer?.id === player.id && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Target className="w-4 h-4 text-primary animate-pulse" />
                </div>
              )}
            </div>
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