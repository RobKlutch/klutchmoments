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
  sessionId: string;
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

  const loopOwnerRef = useRef<string | null>(null);
  const loopSessionId = useRef<string>(`loop_${sessionId}_${Date.now()}`);
  const rafLoopCountRef = useRef(0);

  const videoBlobRef = useRef<Blob | null>(null);

  const getVideoBlob = useCallback(async (): Promise<Blob | null> => {
    try {
      if (!videoUrl) {
        console.error('❌ No videoUrl available for Blob fetch');
        return null;
      }

      if (!videoBlobRef.current) {
        console.log('⬇️ Fetching video Blob from videoUrl for detection:', {
          videoUrl: videoUrl.substring(0, 80)
        });
        const res = await fetch(videoUrl);
        const blob = await res.blob();
        videoBlobRef.current = blob;
      }

      return videoBlobRef.current;
    } catch (err) {
      console.error('❌ Failed to fetch video Blob from videoUrl:', err);
      return null;
    }
  }, [videoUrl]);
  
  const rafDebugOnceRef = useRef(false);
  const listenersRef = useRef<Array<[EventTarget, string, EventListener]>>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(timeSelection.start);
  const [duration, setDuration] = useState(0);
  const [trackedPosition, setTrackedPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const newLoopId = `loop_${sessionId}_${Date.now()}`;
    loopSessionId.current = newLoopId;
    console.log('🔄 Loop session ID updated for new session:', { sessionId, loopId: newLoopId });
    videoBlobRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = timeSelection.start;

    setTrackedPosition(null);

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      console.log('✅ Video metadata loaded:', { duration: video.duration });
    };
    
    const handleCanPlay = async () => {
      console.log('🚀 Running initial detection for clip (video-based)');
      
      try {
        const videoBlob = await getVideoBlob();
        if (!videoBlob) {
          console.error('❌ No videoBlob available for initial detection');
          return;
        }

        const formData = new FormData();
        formData.append('video', videoBlob, 'clip.mp4');
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
        
        console.log('📡 Initial detection API response (video-based):', {
          success: data.success,
          playerCount: data.players?.length || 0,
          hasSelectedPlayer: !!data.selectedPlayer,
          selectedPlayerData: data.selectedPlayer
        });

        if (data.success && data.selectedPlayer) {
          const player = data.selectedPlayer;
          if (typeof player.centerX === 'number' && typeof player.centerY === 'number') {
            setTrackedPosition({
              x: player.centerX,
              y: player.centerY
            });
            console.log('✅ Initial spotlight position set (video-based):', {
              x: player.centerX,
              y: player.centerY
            });
          }
        }

        startRAFLoop();
      } catch (error) {
        console.error('❌ Initial detection failed:', error);
      }
    };
    
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      
      if (video.currentTime >= timeSelection.end) {
        video.currentTime = timeSelection.start;
        video.pause();
      }
    };
    
    const handlePlay = () => {
      setIsPlaying(true);
      startDetection();
      startRAFLoop();
    };
    
    const handlePause = () => {
      setIsPlaying(false);
      stopDetection();
      stopRAFLoop();
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

      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [timeSelection.start, timeSelection.end, sessionId, selectedPlayer, getVideoBlob]);

  const startDetection = useCallback(() => {
    if (detectionIntervalRef.current) return;

    console.log('🎯 Starting detection (video-based pipeline)');

    const runDetection = async () => {
      const video = videoRef.current;
      if (!video || video.paused) return;

      try {
        const videoBlob = await getVideoBlob();
        if (!videoBlob) {
          console.error('❌ No videoBlob available for detection');
          return;
        }

        const formData = new FormData();
        formData.append('video', videoBlob, 'clip.mp4');
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
        
        console.log('📡 Detection API response (video-based):', { 
          success: data.success, 
          playerCount: data.players?.length || 0,
          hasSelectedPlayer: !!data.selectedPlayer,
          selectedPlayerData: data.selectedPlayer,
          fullResponse: data
        });
        
        if (data.success && data.selectedPlayer) {
          const player = data.selectedPlayer;
          
          console.log('🔍 Player object received (video-based):', { 
            player,
            centerX: player.centerX,
            centerY: player.centerY,
          });
          
          if (typeof player.centerX === 'number' && typeof player.centerY === 'number') {
            setTrackedPosition({
              x: player.centerX,
              y: player.centerY
            });
            
            console.log('✅ Tracked position updated (video-based):', { 
              id: player.id, 
              centerX: player.centerX, 
              centerY: player.centerY,
            });
          } else {
            console.warn('⚠️ Invalid selectedPlayer coordinates:', player);
          }
        } else if (data.success && data.players && data.players.length > 0) {
          const player =
            data.players.find((p: DetectedPlayer) => p.id === selectedPlayer.id) ||
            data.players[0];
          
          console.log('🔄 FALLBACK: Using player from array (video-based):', { 
            playerId: player.id,
            centerX: player.centerX,
            centerY: player.centerY
          });
          
          if (player && typeof player.centerX === 'number' && typeof player.centerY === 'number') {
            setTrackedPosition({
              x: player.centerX,
              y: player.centerY
            });
            console.log('✅ Spotlight position updated (fallback):', {
              id: player.id,
              x: player.centerX,
              y: player.centerY
            });
          }
        } else {
          console.log('ℹ️ No selectedPlayer or players detected in clip');
        }
      } catch (error) {
        console.error('❌ Detection failed (video-based):', error);
      }
    };

    runDetection();
    detectionIntervalRef.current = window.setInterval(runDetection, 1000);
  }, [getVideoBlob, sessionId, selectedPlayer.id]);

  const stopDetection = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
      console.log('⏹️ Stopped detection');
    }
  }, []);

  const renderSpotlight = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (!canvas || !video || !trackedPosition) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hasBBox =
      trackedPosition &&
      Number.isFinite(trackedPosition.x) &&
      Number.isFinite(trackedPosition.y);
    
    if (!hasBBox) {
      console.warn('[Preview:RAF] Invalid bbox, hiding overlay');
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

    const x = offsetX + trackedPosition.x * videoDisplayWidth;
    const y = offsetY + trackedPosition.y * videoDisplayHeight;
    const radius =
      (effectSettings.size / 100) *
      Math.sqrt(videoDisplayWidth ** 2 + videoDisplayHeight ** 2) /
      2;

    if (selectedEffect.effect.id === 'beam' || selectedEffect.effect.id === 'ring') {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const alpha = effectSettings.intensity / 100;
      
      gradient.addColorStop(
        0,
        `${effectSettings.color}${Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0')}`
      );
      gradient.addColorStop(
        0.5,
        `${effectSettings.color}${Math.round(alpha * 128)
          .toString(16)
          .padStart(2, '0')}`
      );
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [trackedPosition, effectSettings, selectedEffect]);

  const startRAFLoop = useCallback(() => {
    const mySessionId = loopSessionId.current;
    
    if (loopOwnerRef.current === mySessionId) {
      console.log('🔄 RAF loop already owned by this session:', mySessionId);
      return;
    }
    
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    loopOwnerRef.current = mySessionId;
    rafLoopCountRef.current = 0;
    
    const loop = () => {
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
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full"
            playsInline
            data-testid="video-preview"
          />
          
          <canvas
            ref={canvasRef}
            width={848}
            height={480}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ mixBlendMode: 'screen' }}
          />
        </div>

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

          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-100"
              style={{ width: `${timelinePercent}%` }}
            />
          </div>
        </div>
      </Card>

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
