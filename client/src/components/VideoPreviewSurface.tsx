import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Settings, 
  Eye, 
  EyeOff,
  ArrowLeft,
  CheckCircle,
  MonitorPlay,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import SpotlightOverlay from "@/components/SpotlightOverlay";
import TrackingStatusIndicator from "@/components/TrackingStatusIndicator";
import { useSpotlightTracker, type DetectedPlayer } from "@/hooks/useSpotlightTracker";
import { usePreviewController } from "@/hooks/usePreviewController";
import { useDetectionScheduler } from "@/hooks/useDetectionScheduler";
import { useDevLogger } from "@/hooks/useDevLogger";

interface VideoPreviewSurfaceProps {
  videoUrl: string;
  videoId?: string; // **FIX**: Pass stable videoId for consistent tracking across stages
  timeSelection: { start: number; end: number };
  selectedPlayer: DetectedPlayer;
  selectedEffect: {
    effect: { id: string; name: string; description: string };
    settings: any;
  };
  detectionTime: number;
  timelineDetectionCache?: { timestamp: number; players: any[] } | null;
  onBack?: () => void;
  onConfirm?: () => void;
  onSettingsChange?: (newSettings: any) => void;
}

export default function VideoPreviewSurface({
  videoUrl,
  videoId = 'preview-video', // **FIX**: Use stable videoId for consistent tracking
  timeSelection,
  selectedPlayer,
  selectedEffect,
  detectionTime,
  timelineDetectionCache,
  onBack,
  onConfirm,
  onSettingsChange
}: VideoPreviewSurfaceProps) {
  console.log('🚨🚨🚨 VIDEO PREVIEW SURFACE EXECUTING', { videoUrl: videoUrl?.slice(-30), videoId });
  const logger = useDevLogger('VideoPreviewSurface');

  // **CRITICAL FIX**: Store onSettingsChange in ref to prevent infinite re-renders
  const onSettingsChangeRef = useRef(onSettingsChange);
  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
  }, [onSettingsChange]);

  // **CONCURRENCY CONTROL**: Request ID + cancellation token system to drop stale responses
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelTokenRef = useRef<object>({});
  const isMountedRef = useRef(true);

  // **MOUNT LOGGING**
  useEffect(() => {
    isMountedRef.current = true;
    console.log('🎬 PREVIEW_ENTER: VideoPreviewSurface component mounted');
    console.log('🎬 PREVIEW_ENTER: Props:', {
      videoUrl: videoUrl?.slice(-30),
      selectedPlayerId: selectedPlayer?.id,
      hasCache: !!timelineDetectionCache,
      timeRange: timeSelection,
      detectionTime: detectionTime,
      detectionTimeType: typeof detectionTime,
      detectionTimeIsZero: detectionTime === 0,
      effectName: selectedEffect?.effect?.name
    });
    
    logger.log('Component mounted', {
      videoUrl: videoUrl?.slice(-30),
      selectedPlayerId: selectedPlayer?.id,
      hasCache: !!timelineDetectionCache,
      timeRange: timeSelection,
      detectionTime
    });
    return () => {
      isMountedRef.current = false;
      // Cancel any in-flight detection requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        logger.log('Aborted in-flight detection request on unmount');
      }
      console.log('🎬 PREVIEW_EXIT: VideoPreviewSurface component unmounted');
      logger.log('Component unmounted');
    };
  }, [logger, videoUrl, selectedPlayer, timelineDetectionCache, timeSelection, detectionTime, selectedEffect?.effect?.name]);

  // **PREVIEW CONTROLS** - Initialize with settings from Effects stage
  const [effectSettings, setEffectSettings] = useState(() => {
    // **CRITICAL FIX**: Effects stage provides whole numbers (0-100), convert to decimals (0-1)
    // Effects stage format: {intensity: 80, size: 100, color: '#3b82f6'}
    // VideoPreview format: {intensity: 0.8, size: 1.0, feather: 0.2}
    const effectsStageSettings = selectedEffect?.settings || {};
    
    const settings = {
      intensity: typeof effectsStageSettings.intensity === 'number' 
        ? effectsStageSettings.intensity / 100  // Convert 80 → 0.8
        : 0.6,  // default 60%
      size: typeof effectsStageSettings.size === 'number'
        ? effectsStageSettings.size / 100  // Convert 100 → 1.0
        : 0.18,  // default 18%
      color: effectsStageSettings.color || '#3b82f6'  // Pass through color
    };
    
    // Clamp to functional spec bounds: intensity 0-100%, size 5-60%
    settings.intensity = Math.max(0, Math.min(1, settings.intensity));
    settings.size = Math.max(0.05, Math.min(0.6, settings.size));
    
    console.log('🎨 EFFECT SETTINGS INITIALIZED:', {
      fromEffectsStage: effectsStageSettings,
      normalized: settings,
      asPercentages: {
        intensity: Math.round(settings.intensity * 100) + '%',
        size: Math.round(settings.size * 100) + '%',
        color: settings.color
      },
      willPassToOverlay: {
        intensity: Math.max(0, Math.min(100, settings.intensity * 100)),
        size: Math.max(5, Math.min(60, settings.size * 100)),
        color: settings.color
      }
    });
    
    return settings;
  });

  // **SYNC EFFECT SETTINGS FROM PROPS**: Derive settings from props and track with ref for comparison
  const prevSettingsRef = useRef({ intensity: 0, size: 0, color: '' });
  
  useEffect(() => {
    const effectsStageSettings = selectedEffect?.settings || {};
    
    const newSettings = {
      intensity: typeof effectsStageSettings.intensity === 'number' 
        ? effectsStageSettings.intensity / 100
        : 0.6,
      size: typeof effectsStageSettings.size === 'number'
        ? effectsStageSettings.size / 100
        : 0.18,
      color: effectsStageSettings.color || '#3b82f6'
    };
    
    // Clamp to functional spec bounds
    newSettings.intensity = Math.max(0, Math.min(1, newSettings.intensity));
    newSettings.size = Math.max(0.05, Math.min(0.6, newSettings.size));
    
    // Only update if values actually changed (prevent render thrash from object identity changes)
    const prev = prevSettingsRef.current;
    const hasChanged = 
      Math.abs(prev.intensity - newSettings.intensity) > 0.001 ||
      Math.abs(prev.size - newSettings.size) > 0.001 ||
      prev.color !== newSettings.color;
    
    if (hasChanged) {
      console.log('🔄 SYNCING EFFECT SETTINGS FROM PROPS:', { 
        effectName: selectedEffect?.effect?.name,
        oldSettings: prev,
        newSettings
      });
      prevSettingsRef.current = newSettings;
      setEffectSettings(newSettings);
    }
  }, [selectedEffect?.effect?.name, selectedEffect?.settings?.intensity, selectedEffect?.settings?.size, selectedEffect?.settings?.color]);

  const [showEffects, setShowEffects] = useState(true);
  const [showTrackingBox, setShowTrackingBox] = useState(false);
  const [showNativeControls, setShowNativeControls] = useState(false);

  // **VALIDATE PLAYER** - Ensure valid bounding box, compute centerX/centerY if missing
  const validatedPlayer = useMemo(() => {
    if (!selectedPlayer || typeof selectedPlayer.id !== 'string') {
      logger.error('Invalid player data - no id', { selectedPlayer });
      return null;
    }
    
    if (typeof selectedPlayer.x !== 'number' || 
        typeof selectedPlayer.y !== 'number' || 
        typeof selectedPlayer.width !== 'number' || 
        typeof selectedPlayer.height !== 'number') {
      logger.error('Invalid player data - missing bounding box', { 
        selectedPlayer,
        hasX: typeof selectedPlayer.x === 'number',
        hasY: typeof selectedPlayer.y === 'number',
        hasWidth: typeof selectedPlayer.width === 'number',
        hasHeight: typeof selectedPlayer.height === 'number'
      });
      return null;
    }
    
    const player = { ...selectedPlayer };
    if (typeof player.centerX !== 'number') {
      player.centerX = player.x + player.width / 2;
      logger.log('Computed centerX from bounding box', { centerX: player.centerX });
    }
    if (typeof player.centerY !== 'number') {
      player.centerY = player.y + player.height / 2;
      logger.log('Computed centerY from bounding box', { centerY: player.centerY });
    }
    
    logger.log('Player validated successfully', { 
      id: player.id, 
      centerX: player.centerX, 
      centerY: player.centerY,
      bbox: { x: player.x, y: player.y, width: player.width, height: player.height }
    });
    return player;
  }, [selectedPlayer, logger]);

  // **PLAYBACK CONTROLLER** - Centralized state + RAF
  const shouldRewind = useRef(false);

  const controller = usePreviewController({
    initialTime: timeSelection.start,
    timeRange: timeSelection,
    onPlaybackEnd: () => {
      console.log('🏁 PLAYBACK END CALLBACK', { timeSelection });
      logger.log('Playback ended - setting rewind flag');
      shouldRewind.current = true;
    }
  });

  useEffect(() => {
    console.log('📏 TIME SELECTION RANGE:', {
      start: timeSelection.start,
      end: timeSelection.end,
      duration: timeSelection.end - timeSelection.start
    });
  }, [timeSelection]);

  const { state, videoRef, play, pause, seek } = controller;

  useEffect(() => {
    if (shouldRewind.current && !state.isPlaying) {
      shouldRewind.current = false;
      seek(timeSelection.start);
      logger.log('Rewound to clip start');
    }
  }, [state.isPlaying, seek, timeSelection.start, logger]);

  // **VIDEO INITIALIZATION**: Ensure video is ready for playback (NO auto-play)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    console.log('🎬 VIDEO INIT: Preparing video for manual playback', {
      readyState: video.readyState,
      src: video.src?.slice(-30)
    });

    video.load();
    
    const handleCanPlay = () => {
      console.log('✅ VIDEO READY: Can now be played via button click', {
        readyState: video.readyState,
        duration: video.duration,
        dimensions: `${video.videoWidth}x${video.videoHeight}`
      });
    };
    
    const handleMetadataLoaded = () => {
      console.log('✅ VIDEO METADATA LOADED: Dimensions available', {
        dimensions: `${video.videoWidth}x${video.videoHeight}`,
        readyState: video.readyState,
        duration: video.duration
      });
    };
    
    video.addEventListener('canplay', handleCanPlay, { once: true });
    video.addEventListener('loadedmetadata', handleMetadataLoaded, { once: true });
    
    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('loadedmetadata', handleMetadataLoaded);
    };
  }, [videoRef]);

  // **SPOTLIGHT TRACKER** - Uses videoRef from controller
  const selectionAnchor = useMemo(() => {
    if (!validatedPlayer || 
        typeof validatedPlayer.centerX !== 'number' || 
        typeof validatedPlayer.centerY !== 'number') {
      return null;
    }
    return { x: validatedPlayer.centerX, y: validatedPlayer.centerY };
  }, [validatedPlayer]);

  const {
    currentBox: trackingBox,
    status,
    trackingStatus,
    ingestDetections,
    manualOverride,
    enterManualMode,
    exitManualMode,
    resetTracking,
    getBoxByIdAtTime
  } = useSpotlightTracker(
    videoRef,
    selectionAnchor,
    {
      effect: selectedEffect.effect.id || selectedEffect.effect.name,
      settings: effectSettings,
      selectedPlayer: validatedPlayer,
      detectionTime,
      componentName: 'VideoPreviewSurface'
    }
  );

  // **🛡️ DEFENSIVE GUARD**: Stop all operations if validatedPlayer becomes null after mount
  useEffect(() => {
    if (!validatedPlayer) {
      logger.warn('ValidatedPlayer became null - stopping all operations');
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
    }
  }, [validatedPlayer, logger, videoRef]);

  // **TIMELINE CACHE INGESTION** - Load initial detections (wait for valid dimensions)
  useEffect(() => {
    console.log('📦 CACHE INGESTION EFFECT TRIGGERED:', {
      hasCache: !!timelineDetectionCache,
      hasPlayer: !!validatedPlayer,
      hasVideo: !!videoRef.current,
      cachePlayerCount: timelineDetectionCache?.players?.length,
      selectedPlayerId: validatedPlayer?.id
    });
    
    const video = videoRef.current;
    if (!timelineDetectionCache || !validatedPlayer || !video) {
      console.log('🚫 CACHE INGESTION BLOCKED:', {
        hasCache: !!timelineDetectionCache,
        hasPlayer: !!validatedPlayer,
        hasVideo: !!video
      });
      return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.log('⏳ CACHE INGESTION: Waiting for video metadata', {
        readyState: video.readyState,
        hasWidth: video.videoWidth > 0
      });
      
      const handleMetadataLoaded = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          console.log('✅ CACHE INGESTION: Video metadata loaded, ingesting now', {
            dimensions: `${video.videoWidth}x${video.videoHeight}`,
            cacheTime: timelineDetectionCache.timestamp,
            playerCount: timelineDetectionCache.players?.length
          });
          
          ingestDetections({
            players: timelineDetectionCache.players || [],
            frameWidth: video.videoWidth,
            frameHeight: video.videoHeight,
            timestampMs: timelineDetectionCache.timestamp * 1000
          });
        }
      };
      
      video.addEventListener('loadedmetadata', handleMetadataLoaded, { once: true });
      return () => video.removeEventListener('loadedmetadata', handleMetadataLoaded);
    }

    console.log('✅ CACHE INGESTION: Ingesting timeline cache immediately', {
      dimensions: `${video.videoWidth}x${video.videoHeight}`,
      cacheTime: timelineDetectionCache.timestamp,
      playerCount: timelineDetectionCache.players?.length,
      selectedId: validatedPlayer.id
    });

    ingestDetections({
      players: timelineDetectionCache.players || [],
      frameWidth: video.videoWidth,
      frameHeight: video.videoHeight,
      timestampMs: timelineDetectionCache.timestamp * 1000
    });
  }, [timelineDetectionCache, validatedPlayer?.id, videoRef, ingestDetections, logger]);

  // **1Hz DETECTION SCHEDULER** - Continuous tracking during playback (video URL → Replicate)
  const handleDetection = useCallback(async (
    playerId: string,
    currentTime: number,
    videoElement: HTMLVideoElement
  ) => {
    // Abort previous
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const myCancelToken = {};
    cancelTokenRef.current = myCancelToken;
    const currentRequestId = ++requestIdRef.current;
    
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    if (!isMountedRef.current) {
      logger.log('Dropping detection - component unmounted before request');
      return;
    }

    // Prepare selectedPlayer payload (spatial context)
    const { normalizePlayerForDetection } = await import('@/utils/playerCoordinates');

    let selectedPlayerPayload: any | null = null;

    if (trackingBox) {
      const centerX = trackingBox.x + trackingBox.width / 2;
      const centerY = trackingBox.y + trackingBox.height / 2;

      selectedPlayerPayload = {
        id: playerId,
        x: trackingBox.x,
        y: trackingBox.y,
        centerX,
        centerY,
        width: trackingBox.width,
        height: trackingBox.height,
      };
    } else if (selectedPlayer) {
      const normalizedPlayer = normalizePlayerForDetection(selectedPlayer);
      if (!normalizedPlayer) {
        logger.error('Failed to normalize selectedPlayer for detection', { selectedPlayer });
        return;
      }
      selectedPlayerPayload = normalizedPlayer;
    } else {
      logger.error('No selectedPlayer or trackingBox available for detection');
      return;
    }

    const payload = {
      videoUrl,                          // Replicate model expects video URL
      timestampMs: currentTime * 1000,
      sessionId: videoId,
      detectionMethod: 'replicate',
      selectedPlayerId: playerId,
      selectedPlayer: selectedPlayerPayload,
    };

    try {
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (cancelTokenRef.current !== myCancelToken) {
        logger.log('Dropping stale detection response - request cancelled', { 
          requestId: currentRequestId
        });
        return;
      }
      
      if (!isMountedRef.current) {
        logger.log('Dropping detection response - component unmounted');
        return;
      }

      if (!response.ok) {
        logger.error('Detection failed with HTTP status', { status: response.status });
        throw new Error(`Detection failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (cancelTokenRef.current !== myCancelToken) {
        logger.log('Dropping parsed detection - request cancelled');
        return;
      }
      
      if (!isMountedRef.current) {
        logger.log('Dropping parsed detection - component unmounted');
        return;
      }
      
      if (data.success && data.players) {
        const video = videoElement || videoRef.current;
        if (!video) {
          logger.error('Cannot ingest detections - no video element');
          return;
        }

        const ingestWithDimensions = (v: HTMLVideoElement) => {
          console.log('🔍 INGEST CHECK:', {
            hasWidth: !!v.videoWidth,
            hasHeight: !!v.videoHeight,
            dimensions: `${v.videoWidth}x${v.videoHeight}`,
            readyState: v.readyState
          });
          
          if (!v.videoWidth || !v.videoHeight) {
            logger.error('🚫 CANNOT INGEST - video has no dimensions!', {
              dimensions: `${v.videoWidth}x${v.videoHeight}`,
              readyState: v.readyState,
              src: v.src?.slice(-50)
            });
            return;
          }
          
          logger.throttled('✅ Detection successful - ingesting', { 
            playerCount: data.players.length,
            time: currentTime.toFixed(2),
            requestId: currentRequestId,
            dimensions: `${v.videoWidth}x${v.videoHeight}`,
            firstPlayerCoords: data.players[0] ? {
              x: data.players[0].x,
              y: data.players[0].y,
              centerX: data.players[0].centerX,
              centerY: data.players[0].centerY
            } : null
          }, 2000);

          ingestDetections({
            players: data.players,
            frameWidth: v.videoWidth,
            frameHeight: v.videoHeight,
            timestampMs: currentTime * 1000
          });
          
          console.log('✅ INGESTION COMPLETE');
        };
        
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          ingestWithDimensions(video);
        } else {
          logger.log('Waiting for video metadata before ingesting detection');
          const handleMetadata = () => {
            logger.log('Video metadata loaded, ingesting queued detection');
            ingestWithDimensions(video);
          };
          video.addEventListener('loadedmetadata', handleMetadata, { once: true });
        }
      } else {
        logger.log('Detection response did not include players', {
          success: data.success,
          keys: Object.keys(data || {}),
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.log('Detection request aborted');
        return;
      }
      logger.error('Detection API call failed', error);
    }
  }, [videoUrl, videoId, selectedPlayer, trackingBox, ingestDetections, logger]);

  useDetectionScheduler({
    enabled: state.isPlaying && !!validatedPlayer && (detectionTime == null || state.currentTime >= detectionTime),
    intervalMs: 1000,
    playerId: validatedPlayer?.id || null,
    videoRef,
    onDetection: handleDetection
  });

  // **PLAYBACK CONTROLS**
  const togglePlayPause = useCallback(async () => {
    console.log('🎮 PLAY/PAUSE BUTTON CLICKED:', {
      timestamp: new Date().toISOString(),
      currentState: state.isPlaying ? 'PLAYING' : 'PAUSED',
      willDoAction: state.isPlaying ? 'PAUSE' : 'PLAY',
      currentTime: state.currentTime,
      hasVideoRef: !!videoRef.current
    });
    
    if (state.isPlaying) {
      console.log('⏸️ Calling pause()...');
      pause();
      console.log('✅ pause() called');
    } else {
      try {
        console.log('▶️ Calling play()...');
        await play();
        console.log('✅ play() completed');
      } catch (error) {
        console.error('❌ PLAY FAILED:', error);
        logger.error('Play failed', error);
      }
    }
  }, [state.isPlaying, play, pause, logger, videoRef, state.currentTime]);

  const handleRestart = useCallback(() => {
    seek(timeSelection.start);
    logger.log('Restarted to beginning');
  }, [seek, timeSelection.start, logger]);

  const handleSeek = useCallback((values: number[]) => {
    const newTime = values[0];
    seek(newTime);
  }, [seek]);

  // **DEFENSIVE GUARD** - Show error UI if player is invalid
  if (!validatedPlayer) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertCircle className="w-16 h-16 text-destructive mb-4" />
        <h3 className="text-xl font-semibold mb-2">Player Data Error</h3>
        <p className="text-muted-foreground mb-4">
          The selected player data is invalid or missing. Please go back and select a player again.
        </p>
        <Button onClick={() => window.location.reload()} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Reload Page
        </Button>
      </div>
    );
  }

  const timelinePercent = state.duration > 0 
    ? ((state.currentTime - timeSelection.start) / (timeSelection.end - timeSelection.start)) * 100 
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="gap-2" data-testid="badge-preview-mode">
            <MonitorPlay className="w-4 h-4" />
            Live Video Preview
          </Badge>
          <Badge variant="secondary" data-testid="badge-effect-name">
            {selectedEffect.effect.name}
          </Badge>
          <TrackingStatusIndicator 
            trackingStatus={trackingStatus}
            onManualOverride={manualOverride}
            onEnterManualMode={enterManualMode}
            onExitManualMode={exitManualMode}
            onResetTracking={resetTracking}
            videoRef={videoRef}
            compact={true}
            className="border-0 p-0 bg-transparent"
          />
        </div>

        <div className="flex items-center gap-2">
          {onBack && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          )}
          {onConfirm && (
            <Button
              size="sm"
              onClick={onConfirm}
              data-testid="button-confirm"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Confirm & Process
            </Button>
          )}
        </div>
      </div>

      {/* Video Player */}
      <Card className="overflow-hidden">
        <div className="relative bg-black aspect-video">
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full"
            playsInline
            preload="auto"
            controls={showNativeControls}
            data-testid="video-preview"
          />
          
          {showEffects && validatedPlayer && (
            <SpotlightOverlay
              videoRef={videoRef}
              trackingBox={trackingBox}
              effect={selectedEffect?.effect?.id || 'beam'}
              settings={{
                intensity: Math.max(0, Math.min(100, (effectSettings.intensity || 0.6) * 100)),
                size: Math.max(5, Math.min(60, (effectSettings.size || 0.18) * 100)),
                color: effectSettings.color || '#3b82f6'
              }}
              isVisible={showEffects}
              selectedPlayerId={validatedPlayer.id}
              selectedPlayer={validatedPlayer as { id: string; centerX: number; centerY: number; x: number; y: number; width: number; height: number }}
              detectionTime={detectionTime}
              sampleTime={state.currentTime}
              realVideoTime={state.currentTime}
              getBoxByIdAtTime={getBoxByIdAtTime}
            />
          )}
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
              {state.isPlaying ? (
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
                value={[state.currentTime]}
                min={timeSelection.start}
                max={timeSelection.end}
                step={0.1}
                onValueChange={handleSeek}
                className="w-full"
                data-testid="slider-timeline"
              />
            </div>

            <div className="text-sm text-muted-foreground min-w-[100px] text-right">
              {state.currentTime.toFixed(2)}s / {state.duration.toFixed(2)}s
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

      {/* Effect Settings */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Effect Settings
            </h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={showEffects}
                  onCheckedChange={setShowEffects}
                  data-testid="switch-effects"
                />
                <label className="text-sm flex items-center gap-2">
                  {showEffects ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  Show Effects
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={showTrackingBox}
                  onCheckedChange={setShowTrackingBox}
                  data-testid="switch-tracking-box"
                />
                <label className="text-sm">Debug Box</label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={showNativeControls}
                  onCheckedChange={setShowNativeControls}
                  data-testid="switch-native-controls"
                />
                <label className="text-sm">Native Controls</label>
              </div>
            </div>
          </div>

          <Separator />

          {/* Effect-specific settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Intensity
                <span className="text-muted-foreground ml-2">
                  {Math.round((effectSettings.intensity ?? 0.6) * 100)}%
                </span>
              </label>
              <Slider
                value={[effectSettings.intensity ?? 0.6]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(values) => handleSettingChange('intensity', values[0])}
                data-testid="slider-intensity"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Size
                <span className="text-muted-foreground ml-2">
                  {Math.round((effectSettings.size ?? 0.18) * 100)}%
                </span>
              </label>
              <Slider
                value={[effectSettings.size ?? 0.18]}
                min={0.05}
                max={0.6}
                step={0.01}
                onValueChange={(values) => handleSettingChange('size', values[0])}
                data-testid="slider-size"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Color
              </label>
              <input
                type="color"
                value={effectSettings.color || '#ffffff'}
                onChange={(e) => handleSettingChange('color', e.target.value)}
                className="w-full h-10 rounded border cursor-pointer"
                data-testid="input-color"
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
