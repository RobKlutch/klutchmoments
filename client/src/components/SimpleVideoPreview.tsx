import { useState, useRef, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface DetectedPlayer {
  id: string;
  centerX: number;
  centerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface SimpleVideoPreviewProps {
  videoUrl: string;
  selectedPlayer: DetectedPlayer;
  timeSelection: { start: number; end: number };
  sessionId: string; // **NEW**: Unique session ID to isolate tracking per video
  effectSettings: {
    intensity: number;
    size: number;
    color: string;
  };
  selectedEffect: { effect: { id: string; name?: string } };
}

export function SimpleVideoPreview({
  videoUrl,
  selectedPlayer,
  timeSelection,
  sessionId,
  effectSettings,
  selectedEffect
}: SimpleVideoPreviewProps) {
  // **CRITICAL DIAGNOSTIC**: Log component mount with complete effect_config at PREVIEW STAGE ENTRY
  console.log('🎯 PREVIEW STAGE ENTRY - Complete effect_config received:', {
    timestamp: new Date().toISOString(),
    selectedEffect: selectedEffect,
    effectType: selectedEffect?.effect?.id,
    effectName: selectedEffect?.effect?.name,
    effectSettings: effectSettings,
    settingsDetail: {
      intensity: effectSettings?.intensity,
      size: effectSettings?.size,
      color: effectSettings?.color
    },
    selectedPlayer: {
      id: selectedPlayer?.id,
      centerX: selectedPlayer?.centerX,
      centerY: selectedPlayer?.centerY
    },
    timeSelection: timeSelection,
    sessionId: sessionId,
    videoUrl: videoUrl?.substring(0, 50)
  });
  
  // **VALIDATION**: Block Preview stage if critical prerequisites are missing
  useEffect(() => {
    const validationErrors: string[] = [];
    
    if (!selectedPlayer || !selectedPlayer.id) {
      validationErrors.push('Missing player_id');
    }
    
    if (!selectedEffect || !selectedEffect.effect || !selectedEffect.effect.id) {
      validationErrors.push('Missing effect_config or effect_id');
    }
    
    if (!effectSettings) {
      validationErrors.push('Missing effectSettings');
    }
    
    if (!sessionId) {
      validationErrors.push('Missing sessionId');
    }
    
    if (validationErrors.length > 0) {
      console.error('❌ PREVIEW STAGE VALIDATION FAILED:', {
        errors: validationErrors,
        receivedData: {
          hasSelectedPlayer: !!selectedPlayer,
          playerId: selectedPlayer?.id,
          hasSelectedEffect: !!selectedEffect,
          effectId: selectedEffect?.effect?.id,
          hasEffectSettings: !!effectSettings,
          hasSessionId: !!sessionId
        }
      });
    } else {
      console.log('✅ PREVIEW STAGE VALIDATION PASSED - All prerequisites present');
    }
  }, [selectedPlayer, selectedEffect, effectSettings, sessionId]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectionIntervalRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  
  // **CRITICAL**: RAF loop ownership to prevent multiple concurrent loops
  const loopOwnerRef = useRef<string | null>(null);
  const loopSessionId = useRef<string>(`loop_${sessionId}_${Date.now()}`);
  const rafLoopCountRef = useRef(0); // Track total RAF iterations
  
  // **FIX**: Regenerate loop session ID when sessionId changes
  useEffect(() => {
    const newLoopId = `loop_${sessionId}_${Date.now()}`;
    loopSessionId.current = newLoopId;
    console.log('🔄 Loop session ID updated for new session:', { sessionId, loopId: newLoopId });
  }, [sessionId]);
  
  // **LISTENER REGISTRY**: Track all event listeners for centralized cleanup
  const listenersRef = useRef<Array<[EventTarget, string, EventListener]>>([]);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(timeSelection.start);
  const [duration, setDuration] = useState(0);
  const [trackedPosition, setTrackedPosition] = useState<{ x: number; y: number } | null>(null);

  // **VIDEO SETUP** - Initialize video element
  // **CRITICAL: DO NOT RESET TRACKING** - Tracking must persist from Timeline stage to Video Preview
  // Resetting here would destroy the HighlightLock and break continuous player tracking

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Set initial time to clip start
    video.currentTime = timeSelection.start;
    
    // **CRITICAL FIX**: Clear stale frontend tracking data from previous sessions
    // This prevents showing spotlight at wrong position until fresh detection arrives
    setTrackedPosition(null);
    console.log('🧹 Cleared frontend tracking data, video set to clip start:', timeSelection.start);
    
    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      console.log('✅ Video metadata loaded:', { duration: video.duration });
    };
    
    const handleCanPlay = async () => {
      // **CRITICAL FIX**: Run detection ONCE when video has drawable frames (even if paused)
      // This provides the first spotlight position, then play/pause controls ongoing detection
      console.log('🚀 Running initial detection for first frame spotlight (canplay event)');
      
      try {
        // Capture initial frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(video, 0, 0);
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8);
        });

        // Call detection API for initial position
        const formData = new FormData();
        formData.append('frame', blob);
        formData.append('timestampMs', (video.currentTime * 1000).toString());
        formData.append('videoId', sessionId);
        formData.append('detectionMethod', 'replicate');
        formData.append('selectedPlayerId', selectedPlayer.id);

        const response = await fetch('/api/detect-players', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });

        const data = await response.json();
        
        if (data.success && data.selectedPlayer) {
          const player = data.selectedPlayer;
          if (typeof player.centerX === 'number' && typeof player.centerY === 'number') {
            setTrackedPosition({
              x: player.centerX,
              y: player.centerY
            });
            console.log('✅ Initial spotlight position set:', { x: player.centerX, y: player.centerY });
          }
        }
        
        // Start RAF loop to render the spotlight
        startRAFLoop();
      } catch (error) {
        console.error('❌ Initial detection failed:', error);
      }
    };
    
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      
      // Auto-rewind at clip end
      if (video.currentTime >= timeSelection.end) {
        video.currentTime = timeSelection.start;
        video.pause();
      }
    };
    
    const handlePlay = () => {
      setIsPlaying(true);
      startDetection();
      startRAFLoop(); // **NEW**: Start per-frame rendering
    };
    
    const handlePause = () => {
      setIsPlaying(false);
      stopDetection();
      stopRAFLoop(); // **NEW**: Stop per-frame rendering
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      // Cleanup on unmount
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [timeSelection.start, timeSelection.end, sessionId, selectedPlayer]);

  // **DETECTION** - Call Replicate API every 1s during playback
  const startDetection = useCallback(() => {
    if (detectionIntervalRef.current) return; // Already running

    console.log('🎯 Starting detection (1Hz)');
    
    const runDetection = async () => {
      const video = videoRef.current;
      if (!video || video.paused) return; // Only run during playback

      try {
        // Capture frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(video, 0, 0);
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8);
        });

        // Call detection API with authentication and correct payload
        const formData = new FormData();
        formData.append('frame', blob);
        formData.append('timestampMs', (video.currentTime * 1000).toString()); // Match backend contract
        formData.append('videoId', sessionId); // **CRITICAL**: Use unique session ID for isolated tracking
        formData.append('detectionMethod', 'replicate'); // Use Replicate GPU detection
        formData.append('selectedPlayerId', selectedPlayer.id);

        const response = await fetch('/api/detect-players', {
          method: 'POST',
          credentials: 'include', // **CRITICAL**: Send session cookies for authentication
          body: formData
        });

        const data = await response.json();
        
        console.log('📡 Detection API response:', { 
          success: data.success, 
          playerCount: data.players?.length || 0,
          hasSelectedPlayer: !!data.selectedPlayer,
          selectedPlayerData: data.selectedPlayer,
          fullResponse: data  // **DEBUG**: Log complete response
        });
        
        // **OPTION 2 FIX**: Use explicit selectedPlayer field from API response
        // This field contains either ID-locked player or HOLD position
        if (data.success && data.selectedPlayer) {
          const player = data.selectedPlayer;
          
          console.log('🔍 SPOTLIGHT DEBUG - Player object received:', { 
            player: player,
            type: typeof player,
            keys: Object.keys(player || {}),
            centerX: player.centerX,
            centerY: player.centerY,
            hasCenterX: 'centerX' in player,
            hasCenterY: 'centerY' in player,
            centerXType: typeof player.centerX,
            centerYType: typeof player.centerY
          });
          
          console.log('🎯 Using selectedPlayer from API:', { 
            playerId: player.id,
            centerX: player.centerX,
            centerY: player.centerY,
            confidence: player.confidence
          });
          
          // **NULL-SAFE**: Only update position if player has valid coordinates
          if (typeof player.centerX === 'number' && typeof player.centerY === 'number') {
            setTrackedPosition({
              x: player.centerX,
              y: player.centerY
            });
            
            console.log('✅ Tracked position updated from detection:', { 
              id: player.id, 
              centerX: player.centerX, 
              centerY: player.centerY,
              confidence: player.confidence,
              note: 'RAF loop will render on next frame'
            });
          } else {
            console.warn('⚠️ Invalid selectedPlayer coordinates:', player);
          }
        } else if (data.success && data.players && data.players.length > 0) {
          // Fallback: If no selectedPlayer field, try to find in players array (backward compatibility)
          const player = data.players.find((p: DetectedPlayer) => p.id === selectedPlayer.id) || data.players[0];
          
          console.log('🔄 FALLBACK: Using player from array:', { 
            playerId: player.id,
            centerX: player.centerX,
            centerY: player.centerY
          });
          
          if (player && typeof player.centerX === 'number' && typeof player.centerY === 'number') {
            setTrackedPosition({
              x: player.centerX,
              y: player.centerY
            });
            console.log('✅ Spotlight position updated (fallback):', { id: player.id, x: player.centerX, y: player.centerY });
          }
        } else {
          console.log('ℹ️ No selectedPlayer or players detected in frame');
        }
      } catch (error) {
        console.error('❌ Detection failed:', error);
      }
    };

    // Run immediately
    runDetection();
    
    // Then every 1s
    detectionIntervalRef.current = window.setInterval(runDetection, 1000);
  }, [sessionId, selectedPlayer.id]);

  const stopDetection = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
      console.log('⏹️ Stopped detection');
    }
  }, []);

  // **RAF LOOP**: Per-frame spotlight rendering for smooth tracking
  const rafDebugOnceRef = useRef(false);
  const renderSpotlight = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    // **DIAGNOSTIC 1**: Effect identity at first RAF tick
    if (!rafDebugOnceRef.current && trackedPosition) {
      console.info('[Preview:effect-at-first-RAF]', JSON.stringify({
        effectId: selectedEffect.effect.id,
        effectName: selectedEffect.effect.name,
        settings: effectSettings,
        trackedPosition,
        timestamp: video?.currentTime
      }));
      rafDebugOnceRef.current = true;
    }
    
    if (!canvas || !video || !trackedPosition) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // **DIAGNOSTIC 2**: Assert valid bbox before rendering
    const hasBBox = trackedPosition && 
                    Number.isFinite(trackedPosition.x) && 
                    Number.isFinite(trackedPosition.y);
    
    if (!hasBBox) {
      console.warn('[Preview:RAF] Invalid bbox, hiding overlay');
      return;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // **LETTERBOX COMPENSATION**: Calculate video display dimensions
    const videoAspect = video.videoWidth / video.videoHeight;
    const canvasAspect = canvas.width / canvas.height;
    
    let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
    
    if (videoAspect > canvasAspect) {
      videoDisplayWidth = canvas.width;
      videoDisplayHeight = canvas.width / videoAspect;
      offsetX = 0;
      offsetY = (canvas.height - videoDisplayHeight) / 2;
    } else {
      videoDisplayHeight = canvas.height;
      videoDisplayWidth = canvas.height * videoAspect;
      offsetX = (canvas.width - videoDisplayWidth) / 2;
      offsetY = 0;
    }

    // **DIAGNOSTIC 3**: Log transform details once
    if (!rafDebugOnceRef.current) {
      console.info('[Preview:transform-debug]', {
        videoAspect,
        canvasAspect,
        videoDisplayWidth,
        videoDisplayHeight,
        offsetX,
        offsetY,
        trackedPosition,
        canvasSize: { width: canvas.width, height: canvas.height },
        videoSize: { width: video.videoWidth, height: video.videoHeight }
      });
    }

    // **VIDEO-SPACE TO SCREEN-SPACE TRANSFORM**
    const x = offsetX + (trackedPosition.x * videoDisplayWidth);
    const y = offsetY + (trackedPosition.y * videoDisplayHeight);
    const radius = (effectSettings.size / 100) * Math.sqrt(videoDisplayWidth ** 2 + videoDisplayHeight ** 2) / 2;

    // Draw spotlight effect
    if (selectedEffect.effect.id === 'beam' || selectedEffect.effect.id === 'ring') {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const alpha = effectSettings.intensity / 100;
      
      gradient.addColorStop(0, `${effectSettings.color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
      gradient.addColorStop(0.5, `${effectSettings.color}${Math.round(alpha * 128).toString(16).padStart(2, '0')}`);
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [trackedPosition, effectSettings, selectedEffect]);

  // **RAF LOOP CONTROL**: Single-owner loop with session token
  const startRAFLoop = useCallback(() => {
    const mySessionId = loopSessionId.current;
    
    // Already owned by this session
    if (loopOwnerRef.current === mySessionId) {
      console.log('🔄 RAF loop already owned by this session:', mySessionId);
      return;
    }
    
    // Stop any existing loop from different owner
    stopRAFLoop();
    
    // Take ownership
    loopOwnerRef.current = mySessionId;
    rafLoopCountRef.current = 0;
    
    const loop = () => {
      // Ownership check - stop if another instance took over
      if (loopOwnerRef.current !== mySessionId) {
        console.warn('⚠️ RAF loop ownership lost, stopping loop');
        return;
      }
      
      rafLoopCountRef.current++;
      renderSpotlight();
      rafIdRef.current = requestAnimationFrame(loop);
    };
    
    loop();
    console.log('🎬 RAF loop started with ownership:', { 
      sessionId: mySessionId,
      prevOwner: loopOwnerRef.current 
    });
  }, [renderSpotlight]);

  const stopRAFLoop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    const iterations = rafLoopCountRef.current;
    loopOwnerRef.current = null;
    
    console.log('⏹️ RAF loop stopped', { 
      totalIterations: iterations,
      sessionId: loopSessionId.current 
    });
  }, []);

  // **LISTENER REGISTRY HELPERS**
  const addEventListener = useCallback((target: EventTarget, event: string, handler: EventListener) => {
    target.addEventListener(event, handler);
    listenersRef.current.push([target, event, handler]);
  }, []);

  const removeAllListeners = useCallback(() => {
    const count = listenersRef.current.length;
    for (const [target, event, handler] of listenersRef.current) {
      target.removeEventListener(event, handler);
    }
    listenersRef.current = [];
    console.log('🧹 Removed all event listeners:', { count });
  }, []);

  // **CENTRALIZED DISPOSE**: Clean up all resources
  const dispose = useCallback(() => {
    console.log('🗑️ DISPOSE called for Video Preview:', { 
      sessionId,
      loopIterations: rafLoopCountRef.current,
      activeListeners: listenersRef.current.length 
    });
    
    // Stop RAF loop
    stopRAFLoop();
    
    // Stop detection interval
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    
    // Remove all event listeners
    removeAllListeners();
    
    // Clear canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    console.log('✅ Video Preview disposed successfully');
  }, [sessionId, stopRAFLoop, removeAllListeners]);

  // **DISPOSE ON UNMOUNT**
  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  // **PLAYBACK CONTROLS**
  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    console.log('🎮 Play/Pause clicked');
    
    if (video.paused) {
      video.play().catch(err => console.error('Play failed:', err));
    } else {
      video.pause();
    }
  }, []);

  const handleRestart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    
    video.currentTime = timeSelection.start;
    setCurrentTime(timeSelection.start);
  }, [timeSelection.start]);

  const handleSeek = useCallback((values: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    
    video.currentTime = values[0];
    setCurrentTime(values[0]);
  }, []);

  const timelinePercent = duration > 0 
    ? ((currentTime - timeSelection.start) / (timeSelection.end - timeSelection.start)) * 100 
    : 0;

  return (
    <div className="space-y-6">
      {/* **DEBUG PANEL**: Show received props for diagnostics */}
      <div className="bg-yellow-100 dark:bg-yellow-900/20 border-2 border-yellow-500 rounded-lg p-4 text-sm font-mono space-y-1">
        <div className="font-bold text-lg mb-2">📋 Video Preview Received Data:</div>
        <div><strong>Effect ID:</strong> <span className="text-blue-600 dark:text-blue-400">{selectedEffect?.effect?.id || '⚠️ NONE'}</span></div>
        <div><strong>Effect Name:</strong> <span className="text-blue-600 dark:text-blue-400">{selectedEffect?.effect?.name || '⚠️ NONE'}</span></div>
        <div><strong>Settings:</strong> intensity={effectSettings.intensity}, size={effectSettings.size}, color={effectSettings.color}</div>
        <div><strong>Player ID:</strong> <span className="text-purple-600 dark:text-purple-400">{selectedPlayer?.id}</span> at ({selectedPlayer?.centerX?.toFixed(3)}, {selectedPlayer?.centerY?.toFixed(3)})</div>
        <div><strong>Time Range:</strong> {timeSelection.start.toFixed(2)}s → {timeSelection.end.toFixed(2)}s (duration: {(timeSelection.end - timeSelection.start).toFixed(2)}s)</div>
        <div><strong>Current Time:</strong> {currentTime.toFixed(2)}s</div>
        <div><strong>Tracked Position:</strong> {trackedPosition ? `(${trackedPosition.x.toFixed(3)}, ${trackedPosition.y.toFixed(3)})` : '⚠️ NONE - waiting for detection'}</div>
        <div><strong>Video Playing:</strong> {isPlaying ? '▶️ YES' : '⏸️ NO'}</div>
      </div>
      
      <Card className="overflow-hidden">
        <div className="relative bg-black aspect-video">
          {/* Video Element */}
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full"
            playsInline
            data-testid="video-preview"
          />
          
          {/* Spotlight Overlay Canvas */}
          <canvas
            ref={canvasRef}
            width={848}
            height={480}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ mixBlendMode: 'screen' }}
          />
        </div>

        {/* Playback Controls */}
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={togglePlayPause}
              data-testid="button-play-pause"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={handleRestart}
              data-testid="button-restart"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>

            <div className="flex-1">
              <Slider
                value={[currentTime]}
                min={timeSelection.start}
                max={timeSelection.end}
                step={0.1}
                onValueChange={handleSeek}
                className="w-full"
                data-testid="slider-timeline"
              />
            </div>

            <div className="text-sm text-muted-foreground min-w-[100px] text-right">
              {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
            </div>
          </div>

          {/* Visual Timeline Bar */}
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-100"
              style={{ width: `${timelinePercent}%` }}
            />
          </div>
        </div>
      </Card>

      {/* Applied Effect Info (Read-Only) */}
      <Card className="p-6">
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Applied Effect</h3>
          
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Effect Type:</span>
              <div className="font-medium mt-1">{selectedEffect.effect.name || selectedEffect.effect.id}</div>
            </div>
            
            <div>
              <span className="text-muted-foreground">Intensity:</span>
              <div className="font-medium mt-1">{effectSettings.intensity}%</div>
            </div>
            
            <div>
              <span className="text-muted-foreground">Size:</span>
              <div className="font-medium mt-1">{effectSettings.size}%</div>
            </div>
            
            <div>
              <span className="text-muted-foreground">Color:</span>
              <div className="font-medium mt-1 flex items-center gap-2">
                <div 
                  className="w-4 h-4 rounded border" 
                  style={{ backgroundColor: effectSettings.color }}
                />
                {effectSettings.color}
              </div>
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground pt-2 border-t">
            This effect was configured in the previous stage and will track the selected player throughout the clip.
          </p>
        </div>
      </Card>
    </div>
  );
}
