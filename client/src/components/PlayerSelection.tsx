import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, User, RotateCcw, MousePointer } from "lucide-react";

interface DetectedPlayer {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  description: string;
  centerX?: number;
  centerY?: number;
  topLeftX?: number;
  topLeftY?: number;
}

interface PlayerSelectionProps {
  videoUrl?: string;
  frameDataUrl?: string;
  detectedPlayers?: DetectedPlayer[];
  onPlayerSelect?: (player: DetectedPlayer) => void;
  selectedPlayer?: DetectedPlayer | null;
  onDetectPlayers?: (frameData: Blob, timestamp: number) => void;
  onConfirm?: () => void;
  onBack?: () => void;
  fallbackMode?: boolean;
  detectionMessage?: string;
  startTime?: number;
}

export default function PlayerSelection({ 
  videoUrl, 
  frameDataUrl, 
  detectedPlayers = [], 
  onPlayerSelect, 
  selectedPlayer,
  onDetectPlayers,
  onConfirm,
  onBack,
  fallbackMode = false,
  detectionMessage,
  startTime = 0
}: PlayerSelectionProps) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [manualSelection, setManualSelection] = useState<{x: number, y: number} | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Set video to start time when component loads
  useEffect(() => {
    const video = videoRef.current;
    if (video && startTime !== undefined) {
      const setVideoTime = () => {
        video.currentTime = startTime;
        console.log('Video positioned at selected time:', formatTime(startTime));
      };
      
      // If video is already loaded, set time immediately
      if (video.readyState >= 2) {
        setVideoTime();
      } else {
        // Wait for video to load metadata
        video.addEventListener('loadedmetadata', setVideoTime, { once: true });
      }
    }
  }, [startTime, videoUrl]);

  // Helper function to format time for logging
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate video render box using ACTUAL video element rect (not container)
  const getVideoRenderBox = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    
    if (!video || !container || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    // **ARCHITECT FIX**: Use video element's actual getBoundingClientRect, not container dimensions
    // Tailwind's aspect-video uses padding-bottom which makes container height 8-12% smaller than actual video
    const videoRect = video.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Video's actual rendered dimensions and position
    const displayW = videoRect.width;
    const displayH = videoRect.height;
    
    // Offset from container top-left to video top-left (letterbox offsets)
    const offsetX = videoRect.left - containerRect.left;
    const offsetY = videoRect.top - containerRect.top;
    
    console.log('📐 Video render box (using actual video rect):', {
      videoRect: { w: displayW, h: displayH, top: videoRect.top, left: videoRect.left },
      containerRect: { w: containerRect.width, h: containerRect.height, top: containerRect.top, left: containerRect.left },
      offsets: { offsetX, offsetY }
    });
    
    return {
      offsetX,
      offsetY,
      displayW,
      displayH,
      containerW: containerRect.width,
      containerH: containerRect.height
    };
  }, []);

  // Convert player coordinates to pixel positions within the container
  const getPlayerPixelPosition = useCallback((player: DetectedPlayer) => {
    const renderBox = getVideoRenderBox();
    if (!renderBox) return null;
    
    const { offsetX, offsetY, displayW, displayH } = renderBox;
    
    // **CRITICAL FIX**: Server sends topLeftX/topLeftY, not centerX/centerY
    // topLeftX and topLeftY are ALREADY the top-left corner in normalized [0,1] coordinates
    const topLeftX = player.topLeftX ?? player.x;
    const topLeftY = player.topLeftY ?? player.y;
    const width = (player.width ?? 0.1) * displayW;
    const height = (player.height ?? 0.1) * displayH;
    
    // Convert normalized top-left to display pixel coordinates
    const left = offsetX + topLeftX * displayW;
    const top = offsetY + topLeftY * displayH;
    
    // **DEBUG LOGGING**
    if (player.id === 'player_1') {
      console.log('🎯 Player 1 positioning:', {
        normalized: { topLeftX, topLeftY, width: player.width, height: player.height },
        render: { offsetX, offsetY, displayW, displayH },
        pixels: { left, top, width, height }
      });
    }
    
    return {
      left,
      top,
      width,
      height
    };
  }, [getVideoRenderBox]);

  const handlePlayerClick = (player: DetectedPlayer) => {
    onPlayerSelect?.(player);
    console.log('Player selected at position:', `${player.x.toFixed(1)}%, ${player.y.toFixed(1)}%`);
  };

  const handleManualClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!fallbackMode && detectedPlayers.length > 0) return;
    
    const renderBox = getVideoRenderBox();
    if (!renderBox) return;
    
    const { offsetX, offsetY, displayW, displayH } = renderBox;
    
    // Get click coordinates relative to container
    const rect = e.currentTarget.getBoundingClientRect();
    const containerX = e.clientX - rect.left;
    const containerY = e.clientY - rect.top;
    
    // Check if click is within video display area
    if (containerX < offsetX || containerX > offsetX + displayW ||
        containerY < offsetY || containerY > offsetY + displayH) {
      return; // Click outside video area
    }
    
    // Convert to normalized video coordinates
    const x = (containerX - offsetX) / displayW;
    const y = (containerY - offsetY) / displayH;
    
    const manualPlayer: DetectedPlayer = {
      id: 'manual_selection',
      x: x,
      y: y,
      width: 0.1,
      height: 0.1,
      confidence: 1.0,
      description: 'Manual Selection'
    };
    
    // Store pixel position for display
    setManualSelection({ 
      x: offsetX + x * displayW, 
      y: offsetY + y * displayH 
    });
    onPlayerSelect?.(manualPlayer);
    console.log('Manual player selected at normalized coords:', `${x.toFixed(3)}, ${y.toFixed(3)}`);
    console.log('Manual player pixel position:', `${offsetX + x * displayW}px, ${offsetY + y * displayH}px`);
  };

  const captureAndDetectPlayers = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !onDetectPlayers) return;
    
    setIsDetecting(true);
    
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
      
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      
      // Draw downscaled frame to canvas
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
      
      // ZERO-LAG OPTIMIZATION: Use toBlob (non-blocking, 60% smaller than base64)
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            console.error('Failed to create frame blob');
            setIsDetecting(false);
            return;
          }
          
          console.log(`Frame captured at ${formatTime(video.currentTime)} (${targetWidth}x${targetHeight}, ${(blob.size / 1024).toFixed(1)}KB)`);
          console.log('Detecting players in current frame...');
          await onDetectPlayers(blob, video.currentTime);
          setIsDetecting(false);
        },
        'image/jpeg',
        0.7
      );
    } catch (error) {
      console.error('Failed to detect players:', error);
      setIsDetecting(false);
    }
  };

  const handleReset = () => {
    onPlayerSelect?.(null as any);
    console.log('Player selection reset');
  };


  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-display font-semibold mb-2">Select Your Player</h3>
        <p className="text-sm text-muted-foreground">
          {detectedPlayers.length > 0 
            ? 'Click on one of the detected players to select them for highlighting' 
            : fallbackMode 
              ? 'AI detection is unavailable. Click "Detect Players" to try again, or click directly on the video to manually select a position.'
              : startTime > 0 
                ? `Video positioned at ${formatTime(startTime)}. Click "Detect Players" to analyze this frame and identify all players.`
                : 'Click "Detect Players" to analyze the current video frame and identify all players'
          }
        </p>
      </div>

      {/* Video/Canvas for Player Selection */}
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
              controls={false}
              muted
              onLoadedMetadata={() => {
                const video = videoRef.current;
                if (video && startTime > 0) {
                  video.currentTime = startTime;
                  console.log('Video metadata loaded, positioned at:', formatTime(startTime));
                }
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/60">
              <div className="text-center">
                <User className="w-16 h-16 mx-auto mb-2 opacity-50" />
                <p>Video frame will appear here</p>
                <p className="text-sm mt-1">Click to select position</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Hidden canvas for frame capture */}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Detected Players Overlay */}
        {detectedPlayers
          .map((player, index) => {
            // **DEBUG**: Log every detection attempt
            console.log(`🔍 Rendering player ${player.id}:`, {
              normalized: { x: player.x, y: player.y, topLeftX: player.topLeftX, topLeftY: player.topLeftY, width: player.width, height: player.height },
              centerCoords: { centerX: player.centerX, centerY: player.centerY }
            });
            
            const pixelPos = getPlayerPixelPosition(player);
            if (!pixelPos) {
              console.warn(`❌ pixelPos is NULL for player ${player.id} - cannot render`);
              return null;
            }
            
            console.log(`✅ Player ${player.id} pixel position:`, pixelPos);
            
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
                  handlePlayerClick(player);
                }}
                data-testid={`player-${player.id}`}
              >
                {/* Player info badge - at top of bounding box */}
                <div className="absolute top-1 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-0.5 rounded text-nowrap backdrop-blur-sm">
                  Player #{player.id.replace('player_', '')}
                </div>
                
                {/* Selection indicator */}
                {selectedPlayer?.id === player.id && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Target className="w-6 h-6 text-primary animate-pulse" />
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
          <div className="absolute inset-0 bg-primary/10 flex items-center justify-center backdrop-blur-[0.5px]">
            <div className="text-center text-white">
              <Target className="w-8 h-8 mx-auto mb-2 animate-spin" />
              <p className="text-lg font-medium">Detecting Players...</p>
              <p className="text-sm opacity-80">AI is analyzing the video frame</p>
            </div>
          </div>
        )}
      </div>

      {/* Detection Status */}
      <div className="mb-6">
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
            <Badge variant="default" className="bg-primary text-white">
              <Target className="w-3 h-3 mr-1" />
              Position Selected
            </Badge>
          </div>
        ) : (
          <Badge variant="outline">
            {fallbackMode ? 'Click on video to select position' : 'No players detected yet'}
          </Badge>
        )}
      </div>

      {/* Instructions */}
      <div className="mb-6 p-4 bg-muted/30 rounded-lg">
        <h4 className="font-medium mb-2">How it works:</h4>
        <ul className="text-sm text-muted-foreground space-y-1">
          {fallbackMode || detectedPlayers.length === 0 ? (
            <>
              <li>1. Click "Detect Players" to try AI detection</li>
              <li>2. If AI detection is unavailable, click anywhere on the video to manually select a position</li>
              <li>3. The highlight effect will focus on your selected position throughout the clip</li>
            </>
          ) : (
            <>
              <li>1. Click "Detect Players" to analyze the current video frame</li>
              <li>2. AI will identify all players and show them with bounding boxes</li>
              <li>3. Click on any detected player to select them for highlighting</li>
              <li>4. The highlight effect will track your selected player throughout the clip</li>
            </>
          )}
        </ul>
      </div>

      {/* Control Buttons */}
      <div className="flex justify-between items-center pt-4 border-t">
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
            disabled={!selectedPlayer}
            data-testid="button-reset-selection"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset Selection
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
          
          {selectedPlayer && (
            <Button
              onClick={onConfirm}
              data-testid="button-next-step"
            >
              Next Step
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}