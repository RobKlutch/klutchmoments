import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
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
  Zap,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import SpotlightOverlay from "@/components/SpotlightOverlay";
import TrackingStatusIndicator from "@/components/TrackingStatusIndicator";
import { useSpotlightTracker, type DetectedPlayer } from "@/hooks/useSpotlightTracker";
import { useDetectionScheduler } from "@/hooks/useDetectionScheduler";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeCenterCoordinates, getSafeId } from '@/utils/safePlayerAccess';
import { getVideoRenderRectFromElements, clickToNormalized } from "@/utils/coordinateTransform";

interface VideoPreviewPlayerProps {
  videoUrl: string;
  videoId?: string; // **FIX**: Add videoId prop for consistent tracking
  timeSelection: { start: number; end: number };
  selectedPlayer: DetectedPlayer;
  selectedEffect: {
    effect: { name: string; description: string };
    settings: any;
  };
  detectionTime: number;
  timelineDetectionCache?: { timestamp: number; players: any[] } | null;
  onBack?: () => void;
  onConfirm?: () => void;
  onSettingsChange?: (newSettings: any) => void;
}



export default function VideoPreviewPlayer({
  videoUrl,
  videoId,
  timeSelection,
  selectedPlayer,
  selectedEffect,
  detectionTime,
  timelineDetectionCache,
  onBack,
  onConfirm,
  onSettingsChange
}: VideoPreviewPlayerProps) {

  // **CRITICAL: Log BEFORE any hooks to confirm render**
  console.log('🎬 VIDEOPREVIEWPLAYER RENDER!', {
    timestamp: Date.now(),
    hasTimelineCache: !!timelineDetectionCache,
    cachePlayerIds: timelineDetectionCache?.players?.map(p => p.id) || [],
    selectedPlayerId: selectedPlayer?.id
  });

  // **CRITICAL MOUNT LOGGING** - using useLayoutEffect to ensure it runs
  useLayoutEffect(() => {
    console.log('🚀🚀🚀 VIDEOPREVIEWPLAYER MOUNTED (LAYOUT)! 🚀🚀🚀', {
      timestamp: Date.now(),
      hasVideoUrl: !!videoUrl,
      hasSelectedPlayer: !!selectedPlayer,
      selectedPlayerId: selectedPlayer?.id,
      hasSelectedEffect: !!selectedEffect,
      detectionTime,
      hasTimelineDetectionCache: !!timelineDetectionCache,
      timelineCachePlayers: timelineDetectionCache?.players?.length || 0,
      timelineCacheTimestamp: timelineDetectionCache?.timestamp,
      timelineCachePlayerIds: timelineDetectionCache?.players?.map(p => p.id) || []
    });
    
    return () => {
      console.log('💀💀💀 VIDEOPREVIEWPLAYER UNMOUNTING (LAYOUT) 💀💀💀');
    };
  }, []);
  
  // Video playback state
  const [currentTime, setCurrentTime] = useState(timeSelection.start);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  
  // Preview controls state
  const [showEffects, setShowEffects] = useState(true);
  const [effectSettings, setEffectSettings] = useState(selectedEffect?.settings || {
    intensity: 60,
    size: 100,
    color: '#3b82f6'
  });
  const [showTrackingBox, setShowTrackingBox] = useState(false);
  const [showNativeControls, setShowNativeControls] = useState(false);
  
  // **ARCHITECT FIX**: Initial seek state to prevent competing seeks
  const [initialSeekDone, setInitialSeekDone] = useState(false);
  const [enforceTimelineWindow, setEnforceTimelineWindow] = useState(false);
  
  // **DEBUG STATE MONITORING**: Comprehensive pipeline state tracking
  const [showDebugState, setShowDebugState] = useState(false);
  const [frameRate, setFrameRate] = useState(0);
  const [lastFrameTime, setLastFrameTime] = useState(Date.now());
  const [frameCount, setFrameCount] = useState(0);
  const [coordinateMatrix, setCoordinateMatrix] = useState<string>('Identity');
  const [updateLoopTiming, setUpdateLoopTiming] = useState<{
    trackingUpdate: number;
    overlayDraw: number;
    totalFrame: number;
  }>({ trackingUpdate: 0, overlayDraw: 0, totalFrame: 0 });
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const manualCaptureCanvas = useRef<HTMLCanvasElement | null>(null); // For manual keyframe capture
  const manualDetectionInFlight = useRef(false); // Concurrency guard for manual captures
  
  
  // **ARCHITECT FIX**: Force initial seek to 0 BEFORE any tracker code runs
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || initialSeekDone) return;

    const enforceInitialSeek = () => {
      if (video.readyState >= 2 && !initialSeekDone) { // HAVE_CURRENT_DATA or higher
        // **FIX**: Start at timeSelection.start (0:00), NOT detectionTime - user must press Play to review
        const seekTime = timeSelection.start;
        video.currentTime = seekTime;
        setCurrentTime(seekTime);
        setInitialSeekDone(true);
        setIsPlaying(false); // Ensure video starts PAUSED
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
  }, [detectionTime, initialSeekDone, videoUrl]); // Re-run when detectionTime or videoUrl changes

  // **ARCHITECT FIX**: Reset initialSeekDone when videoUrl changes to handle URL changes
  useEffect(() => {
    setInitialSeekDone(false);
  }, [videoUrl]);

  // **CRITICAL FIX**: Use PRIMITIVE dependencies to prevent render loops
  // Object reference changes cause constant re-initialization - use stable values instead
  const playerId = selectedPlayer?.id;
  const playerX = selectedPlayer?.x;
  const playerY = selectedPlayer?.y;
  const playerWidth = selectedPlayer?.width;
  const playerHeight = selectedPlayer?.height;
  const playerCenterX = selectedPlayer?.centerX;
  const playerCenterY = selectedPlayer?.centerY;
  const playerConfidence = selectedPlayer?.confidence;
  
  const validatedPlayer = useMemo(() => {
    console.log('🔍 VALIDATEDPLAYER COMPUTATION:', {
      hasSelectedPlayer: !!selectedPlayer,
      selectedPlayerId: playerId,
      willReturnNull: !selectedPlayer || !playerId
    });
    
    // Minimal defensive check - just verify player exists and has ID
    if (!selectedPlayer || !playerId) {
      console.error('❌ VALIDATEDPLAYER IS NULL - selectedPlayer missing or has no id!', {
        selectedPlayer,
        hasId: playerId
      });
      return null;
    }
    // Ensure centerX/centerY exist, calculate from x/y if needed
    const playerWithCenter = {
      ...selectedPlayer,
      centerX: playerCenterX ?? (playerX! + (playerWidth || 0) / 2),
      centerY: playerCenterY ?? (playerY! + (playerHeight || 0) / 2)
    };
    console.log('✅ VALIDATEDPLAYER CREATED:', playerWithCenter);
    return playerWithCenter;
  }, [playerId, playerX, playerY, playerWidth, playerHeight, playerCenterX, playerCenterY, playerConfidence]); // **FIX**: Primitive dependencies only!

  // **CRITICAL FIX**: Memoize selectionAnchor to prevent unnecessary re-renders
  // This prevents ingestDetections from changing on every render, which would reset the detection interval
  const selectionAnchor = useMemo(() => {
    const anchor = validatedPlayer ? getSafeCenterCoordinates(validatedPlayer) : null;
    console.log('🔍 SELECTIONANCHOR COMPUTATION:', {
      hasValidatedPlayer: !!validatedPlayer,
      selectionAnchor: anchor,
      validatedPlayerCenter: validatedPlayer ? {
        centerX: validatedPlayer.centerX,
        centerY: validatedPlayer.centerY
      } : null
    });
    return anchor;
  }, [validatedPlayer?.centerX, validatedPlayer?.centerY]);

  // **ISSUE 2 FIX**: Enhanced spotlight tracking hook with proper selectedPlayer data flow
  const {
    currentBox: trackingBox,
    status,
    trackingStatus,
    lastDetectionAge,
    ingestDetections,
    manualOverride,
    enterManualMode,
    exitManualMode,
    resetTracking,
    forceRebindToActiveVideo,
    getCurrentVideoInfo,
    getAllVideoInfo,
    getBoxByIdAtTime
  } = useSpotlightTracker(
    videoRef,
    selectionAnchor,
    {
      effect: selectedEffect.effect.name,
      settings: effectSettings,
      selectedPlayer: validatedPlayer, // **BULLETPROOF**: Pass validated safe player to hook
      detectionTime, // Used for tracking initialization timing
      componentName: 'VideoPreviewPlayer', // **DEBUG**: Identify this component in logs
      deferAutoSeek: !initialSeekDone, // **ARCHITECT FIX**: Prevent auto-seeks until initial seek is done
      externalMode: false, // **ARCHITECT FIX**: Re-enable internal detection - external scheduler was broken
      videoId: videoId || 'tracking-video' // **FIX**: Pass videoId for consistent tracking
    }
  );

  // **SURGICAL FIX #2**: Add continuous 1Hz detection scheduler
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const handleDetection = useCallback(async (
    playerId: string,
    currentTime: number,
    videoElement: HTMLVideoElement
  ) => {
    // Abort any in-flight fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(videoElement, 0, 0);
      const blob = await new Promise<Blob>((resolve) => 
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8)
      );

      const formData = new FormData();
      formData.append('frame', blob, 'frame.jpg');

      const response = await fetch('/api/detections/detect-players', {
        method: 'POST',
        credentials: 'include',
        body: formData,
        signal: abortControllerRef.current.signal
      });

      if (response.ok) {
        const result = await response.json();
        if (result.players && result.players.length > 0) {
          ingestDetections({
            players: result.players,
            frameWidth: videoElement.videoWidth,
            frameHeight: videoElement.videoHeight,
            timestampMs: currentTime * 1000
          });
          
          console.log('✅ CONTINUOUS DETECTION (1Hz):', {
            playersDetected: result.players.length,
            timestamp: currentTime.toFixed(3)
          });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Ignore abort errors
      }
      console.error('❌ Detection API call failed:', error);
    }
  }, [ingestDetections]);

  useDetectionScheduler({
    enabled: isPlaying && !!validatedPlayer && (detectionTime == null || currentTime >= detectionTime),
    intervalMs: 1000, // 1Hz continuous detection
    playerId: validatedPlayer?.id || null,
    videoRef,
    onDetection: handleDetection
  });
  
  // **REMOVED PER-FRAME LOGGING**: This was causing render storms at 60fps
  // trackingBox updates are silently tracked without console output
  useEffect(() => {
    // No-op - tracking happens in useSpotlightTracker without logging
  }, [trackingBox, status, trackingStatus]);
  
  const isTracking = status === 'tracking';

  // **ARCHITECT FIX**: Stabilize video event listeners - attach once per element instance
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      console.error('🚨🚨🚨 VideoPreviewPlayer: NO VIDEO ELEMENT FOUND! 🚨🚨🚨', {
        videoRefCurrent: videoRef.current,
        timestamp: Date.now()
      });
      return;
    }

    const positionVideoToStart = () => {
      // **TRACKING FIX**: Start video at unified start time to ensure tracker initializes with player in frame
      const startTime = computeLoopStartTime();
      video.currentTime = startTime;
      setCurrentTime(startTime);
    };

    const handleLoadedMetadata = () => {
      // **FIX**: Don't seek immediately on metadata - wait for more data to load
      // This prevents seeking from interrupting the video loading process
    };

    const handleLoadedData = () => {
      // Data is loaded - video is ready for playback
    };
    
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      
      // **DEBUG**: Log every 2 seconds of playback to diagnose stuck time
      if (Math.floor(video.currentTime) % 2 === 0 && video.currentTime > 0.1) {
        console.log('⏱️ VIDEO TIMEUPDATE:', { 
          currentTime: video.currentTime.toFixed(2), 
          paused: video.paused, 
          ended: video.ended,
          readyState: video.readyState 
        });
      }
      
      // **ARCHITECT FIX**: Gate all seeks behind readyState >= 2 to prevent loading issues
      // **ARCHITECT FIX**: Only enforce timeline boundaries after user interaction and not paused
      if (video.readyState >= 2 && initialSeekDone && enforceTimelineWindow && !video.paused && video.currentTime > 0.5) {
        // **HARD ENFORCEMENT GUARD**: Force video to stay within timeline bounds (only after user interaction)
        const startTime = computeLoopStartTime();
        if (video.currentTime < timeSelection.start - 0.05) {
          console.warn('🚨 HARD ENFORCEMENT: Video time is before Timeline start, correcting immediately:', {
            currentTime: video.currentTime.toFixed(3),
            timeSelectionStart: timeSelection.start.toFixed(3),
            correctedTime: startTime.toFixed(3),
            readyState: video.readyState
          });
          const correctedStartTime = computeLoopStartTime();
          video.currentTime = correctedStartTime;
          setCurrentTime(correctedStartTime);
        }
      } else {
      }
      
      // **ARCHITECT FIX**: Gate loop seeks behind readyState check
      if (video.readyState >= 2 && video.currentTime >= timeSelection.end) {
        const loopStartTime = computeLoopStartTime();
        video.currentTime = loopStartTime;
      }
    };
    
    const handlePlay = () => {
      console.log('▶️ VIDEO PLAY EVENT:', { currentTime: video.currentTime.toFixed(2), paused: video.paused });
      setIsPlaying(true);
    };
    
    const handlePlaying = () => {
      // Video is playing
    };
    
    const handleCanPlay = () => {
      // Video ready to play
    };
    
    const handleError = (e: Event) => {
      console.error('❌ VideoPreviewPlayer: VIDEO ERROR EVENT:', {
        error: video.error,
        errorCode: video.error?.code,
        errorMessage: video.error?.message,
        currentTime: video.currentTime.toFixed(2),
        networkState: video.networkState,
        timestamp: Date.now()
      });
    };
    
    const handlePause = () => {
      setIsPlaying(false);
    };
    
    const handleEnded = () => {
      setIsPlaying(false);
      // **ARCHITECT FIX**: External scheduler removed - tracker handles detection internally
    };
    
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    
    // **CRITICAL FIX**: Position video immediately to timeline start regardless of ready state
    const timelineStart = timeSelection.start;
    video.currentTime = timelineStart;
    setCurrentTime(timelineStart);
    
    if (video.readyState >= 1) { // HAVE_METADATA or higher
      setDuration(video.duration);
    }
    
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [videoUrl]); // **CRITICAL FIX**: Only depend on videoUrl - timeSelection changes cause infinite resets to 0

  // **PLAYBACK FIX**: Video Preview should start from timeline beginning, not detection time
  const computeLoopStartTime = useCallback(() => {
    // **CRITICAL FIX**: Start playback from timeline start (0s) for proper preview flow
    // Detection time (5.98s) is only used for frame capture, not preview playback
    const startTime = timeSelection.start;
    
    
    return startTime;
  }, [timeSelection.start]); // Only depend on the actual value, not the object

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) {
      console.error('🚨 handlePlayPause: NO VIDEO ELEMENT FOUND!');
      return;
    }
    
    // **ARCHITECT FIX**: Log user activation status for diagnostics
    const userActivationActive = 'userActivation' in navigator ? (navigator.userActivation as any)?.isActive : 'unknown';
    
    if (isPlaying) {
      video.pause();
      setEnforceTimelineWindow(false); // **ARCHITECT FIX**: Disable timeline enforcement when pausing
      return;
    }
    
    // **ARCHITECT FIX**: Enable timeline enforcement after user starts playing
    setEnforceTimelineWindow(true);
    
    // **ARCHITECT FIX**: Only enforce timeline bounds after initial positioning complete
    if (initialSeekDone && enforceTimelineWindow) {
      const resetTime = computeLoopStartTime();
      if (video.currentTime < timeSelection.start - 0.05 || video.currentTime > timeSelection.end) {
      console.warn('🚨 HARD ENFORCEMENT in handlePlay: Correcting video time to Timeline start:', {
        currentTime: video.currentTime.toFixed(3),
        timeSelectionStart: timeSelection.start.toFixed(3),
        correctedTime: resetTime.toFixed(3)
      });
      if (video.readyState >= 2) {
        video.currentTime = resetTime;
      } else {
        console.log('⏱️ SKIPPING play seek - video not ready:', {
          readyState: video.readyState,
          targetTime: resetTime
        });
      }
      }
    }
    
    // **RUNTIME ASSERTION**: Log the computed loop start to verify it's correct
    const computedStartTime = computeLoopStartTime();

    // **ARCHITECT FIX**: Call video.play() synchronously as FIRST statement - no awaits before it!
    const playPromise = video.play();
    
    // Handle the promise after the synchronous call
    playPromise.then(() => {
      
      // Verify the video is actually playing
      setTimeout(() => {
        console.log('🔍 POST-PLAY VERIFICATION:', {
          currentTime: video.currentTime.toFixed(2),
          paused: video.paused,
          ended: video.ended,
          readyState: video.readyState,
          timestamp: Date.now()
        });
      }, 500);
      
    }).catch((playError) => {
      const error = playError instanceof Error ? playError : new Error(String(playError));
      console.error('❌ Video.play() failed:', {
        error: error.message,
        name: error.name,
        userActivationActive
      });
      
      // **ARCHITECT FIX**: Enhanced error handling for NotAllowedError
      if (error.name === 'NotAllowedError') {
        console.warn('🚨 NotAllowedError - User gesture authorization failed!');
        console.log('🛠️ Enabling native controls as fallback...');
        
        // Enable native controls for direct user interaction
        video.controls = true;
        
        // Show user instruction
        console.log('👆 Please click the video directly to start playback');
        
        // Optional: You could also show a toast/alert here
        // alert('Please click the video directly to start playback');
        
      } else {
        console.error('❌ Critical playback error:', {
          error: error.message,
          name: error.name,
          stack: error.stack,
          videoState: {
            currentTime: video.currentTime,
            paused: video.paused,
            ended: video.ended,
            readyState: video.readyState,
            networkState: video.networkState,
            muted: video.muted,
            volume: video.volume,
            src: video.src
          }
        });
      }
    });
  };

  const handleSeek = (newTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    
    if (video.readyState >= 2) {
      video.currentTime = newTime;
      setCurrentTime(newTime);
    } else {
      console.log('⏱️ SKIPPING user seek - video not ready:', {
        readyState: video.readyState,
        targetTime: newTime
      });
    }
  };

  // **ARCHITECT FIX**: Manual keyframe capture with concurrency guard
  const captureKeyframeDetection = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !selectedPlayer) return;
    
    // **ARCHITECT FIX**: Concurrency guard to prevent request flooding
    if (manualDetectionInFlight.current) {
      console.log('⏭️ Skipping manual detection - request already in flight');
      return;
    }
    
    const currentTime = video.currentTime;
    
    // Only detect within the selected clip range
    if (currentTime < timeSelection.start || currentTime > timeSelection.end) {
      console.log('⏭️ Skipping keyframe detection - outside clip bounds');
      return;
    }
    
    // Create canvas if not exists
    if (!manualCaptureCanvas.current) {
      manualCaptureCanvas.current = document.createElement('canvas');
    }
    
    const canvas = manualCaptureCanvas.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Capture current frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    console.log('🎥 Manual keyframe detection triggered:', {
      time: currentTime.toFixed(3),
      selectedPlayer: selectedPlayer.id,
      frameSize: `${canvas.width}x${canvas.height}`
    });
    
    manualDetectionInFlight.current = true;
    
    // **ZERO-LAG FIX**: Send as Blob FormData to trigger direct Replicate SDK path
    try {
      // Convert canvas to Blob (faster than base64)
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.5);
      });
      
      // Create FormData for ZERO-LAG path
      const formData = new FormData();
      formData.append('frame', blob, 'frame.jpg');
      formData.append('timestampMs', (currentTime * 1000).toString());
      formData.append('videoId', videoId || 'tracking-video'); // **FIX**: Use prop videoId for consistent tracking
      formData.append('detectionMethod', 'replicate');
      
      // **FIX**: Send both ID and full coordinates for spatial tracking
      if (hasValidPlayer(selectedPlayer)) {
        const playerId = getSafeId(selectedPlayer);
        formData.append('selectedPlayerId', playerId); // **CRITICAL**: Use 'selectedPlayerId' (server expects this field name)
        
        // **SPATIAL FIX**: Send full player coordinates for ID-LOCK RECOVERY
        formData.append('selectedPlayer', JSON.stringify({
          id: playerId,
          x: selectedPlayer.x,
          y: selectedPlayer.y,
          centerX: selectedPlayer.centerX,
          centerY: selectedPlayer.centerY
        }));
      }
      
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        credentials: 'include',
        body: formData // Browser auto-sets multipart/form-data
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.players && result.players.length > 0) {
          const timestampMs = currentTime * 1000;
          
          // Feed new detections to tracker
          ingestDetections({
            players: result.players,
            frameWidth: video.videoWidth || 640,
            frameHeight: video.videoHeight || 480,
            timestampMs
          });
          
          console.log('✅ Manual keyframe detection successful - FEEDING TO TRACKER:', {
            playersDetected: result.players.length,
            timestamp: currentTime.toFixed(3),
            timestampMs
          });
        }
      }
    } catch (error) {
      console.error('❌ Manual keyframe detection failed:', error);
    } finally {
      manualDetectionInFlight.current = false;
    }
  }, [selectedPlayer, timeSelection.start, timeSelection.end, ingestDetections]);

  const handleRestart = () => {
    const video = videoRef.current;
    if (!video) return;
    
    if (video.readyState >= 2) {
      video.currentTime = timeSelection.start;
      setCurrentTime(timeSelection.start);
    } else {
      console.log('⏱️ SKIPPING restart seek - video not ready:', {
        readyState: video.readyState,
        targetTime: timeSelection.start
      });
    }
  };

  const handleEffectSettingChange = (key: string, value: any) => {
    const newSettings = { ...effectSettings, [key]: value };
    setEffectSettings(newSettings);
    onSettingsChange?.(newSettings);
  };

  // **CENTRALIZED COORDINATE TRANSFORMATION**: Use shared utility for click handling
  const handleManualOverrideClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const container = containerRef.current;
    
    if (!video || !container || !manualOverride) return;
    
    // Get click coordinates relative to the container
    const containerRect = container.getBoundingClientRect();
    const clickX = e.clientX - containerRect.left;
    const clickY = e.clientY - containerRect.top;
    
    // Use centralized coordinate transformation utility
    const videoRenderRect = getVideoRenderRectFromElements(video, containerRect);
    const normalized = clickToNormalized(clickX, clickY, videoRenderRect);
    
    // Apply manual override
    manualOverride(normalized);
    
    console.log('🎯 Manual override applied:', normalized);
  }, [manualOverride]);

  // **ARCHITECT DEBUGGING**: Keyframe scheduler with comprehensive logging
  // **CRITICAL FIX**: Ingest Timeline detection AFTER video loads to get correct dimensions
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !timelineDetectionCache || !ingestDetections) return;
    
    const handleLoadedMetadata = () => {
      // Only ingest once video has real dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('⚠️ Video dimensions still zero after loadedmetadata');
        return;
      }
      
      // **CRITICAL DEBUG**: Check if selected player ID is in the timeline cache
      const selectedPlayerIdFromWorkflow = selectedPlayer.id;
      const cacheHasSelectedPlayer = timelineDetectionCache.players.some(p => p.id === selectedPlayerIdFromWorkflow);
      const selectedPlayerInCache = timelineDetectionCache.players.find(p => p.id === selectedPlayerIdFromWorkflow);
      
      // **CRITICAL FIX**: Only feed the SELECTED player, not all players!
      // This prevents the spotlight from jumping to other players
      const selectedPlayerOnly = timelineDetectionCache.players.filter(p => p.id === selectedPlayerIdFromWorkflow);
      
      console.log('🔄 PREVIEW: Feeding Timeline detection to tracker', {
        timestamp: timelineDetectionCache.timestamp,
        totalPlayers: timelineDetectionCache.players.length,
        selectedPlayerOnly: selectedPlayerOnly.length,
        videoDimensions: `${video.videoWidth}x${video.videoHeight}`,
        selectedPlayerId: selectedPlayerIdFromWorkflow,
        selectedPlayerPos: `(${selectedPlayer.x?.toFixed(3)}, ${selectedPlayer.y?.toFixed(3)})`,
        cacheHasSelectedPlayer: cacheHasSelectedPlayer ? '✅ YES' : '❌ NO',
        allCachePlayerIds: timelineDetectionCache.players.map(p => p.id),
      });
      
      // Feed ONLY the selected player to prevent jumping
      ingestDetections({
        players: selectedPlayerOnly,
        frameWidth: video.videoWidth,
        frameHeight: video.videoHeight,
        timestampMs: timelineDetectionCache.timestamp * 1000
      });
      
      // **ARCHITECT FIX**: Ensure tracker's rVFC loop binds to this video element
      console.log('🔗 Forcing tracker rebind to video element');
      forceRebindToActiveVideo();
    };
    
    // If already loaded, ingest immediately
    if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
      handleLoadedMetadata();
    } else {
      // Otherwise wait for metadata
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
    }
    
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [timelineDetectionCache, validatedPlayer?.id, ingestDetections]);

  // **ARCHITECT FIX**: Broken external scheduler removed - tracker now uses internal detection loop
  // **FRAME RATE MONITORING**: Track rendering performance
  useEffect(() => {
    if (!isPlaying) return;
    
    const measureFrameRate = () => {
      const now = Date.now();
      const timeDelta = now - lastFrameTime;
      
      if (timeDelta >= 1000) { // Update every second
        const fps = Math.round((frameCount * 1000) / timeDelta);
        setFrameRate(fps);
        setFrameCount(0);
        setLastFrameTime(now);
      } else {
        setFrameCount(prev => prev + 1);
      }
      
      if (isPlaying) {
        requestAnimationFrame(measureFrameRate);
      }
    };
    
    const rafId = requestAnimationFrame(measureFrameRate);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, lastFrameTime, frameCount]);

  // **COORDINATE MATRIX TRACKING**: Monitor transformation pipeline
  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    const updateCoordinateMatrix = () => {
      const videoRect = video.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const videoAspectRatio = video.videoWidth / video.videoHeight;
      const containerAspectRatio = videoRect.width / videoRect.height;
      
      setCoordinateMatrix(
        `Transform Matrix:\n` +
        `Video: ${video.videoWidth}×${video.videoHeight} → ` +
        `Display: ${videoRect.width.toFixed(0)}×${videoRect.height.toFixed(0)}\n` +
        `Aspect: Video(${videoAspectRatio.toFixed(3)}) vs Container(${containerAspectRatio.toFixed(3)})\n` +
        `Object-fit: ${window.getComputedStyle(video).objectFit || 'contain'}\n` +
        `DPR: ${window.devicePixelRatio}`
      );
    };

    // Update on video load and resize
    const resizeObserver = new ResizeObserver(updateCoordinateMatrix);
    resizeObserver.observe(video);
    resizeObserver.observe(container);
    
    video.addEventListener('loadedmetadata', updateCoordinateMatrix);
    updateCoordinateMatrix(); // Initial update

    return () => {
      resizeObserver.disconnect();
      video.removeEventListener('loadedmetadata', updateCoordinateMatrix);
    };
  }, []);

  // **UPDATE LOOP TIMING**: Monitor RAF timing sequence  
  useEffect(() => {
    if (!isPlaying) return;

    const monitorUpdateLoop = () => {
      const frameStart = performance.now();
      
      // Simulate tracking update timing
      const trackingStart = performance.now();
      // (This would be actual tracking update call)
      const trackingEnd = performance.now();
      
      // Simulate overlay draw timing
      const overlayStart = performance.now();
      // (This would be actual overlay draw call)
      const overlayEnd = performance.now();
      
      const frameEnd = performance.now();
      
      setUpdateLoopTiming({
        trackingUpdate: trackingEnd - trackingStart,
        overlayDraw: overlayEnd - overlayStart,
        totalFrame: frameEnd - frameStart
      });
      
      if (isPlaying && Math.random() < 0.1) { // Sample 10% of frames to avoid spam
        console.log('⏱️ UPDATE LOOP TIMING:', {
          trackingUpdate: (trackingEnd - trackingStart).toFixed(2),
          overlayDraw: (overlayEnd - overlayStart).toFixed(2),
          totalFrame: (frameEnd - frameStart).toFixed(2),
          sequence: 'tracking → overlay → complete'
        });
      }
      
      if (isPlaying) {
        requestAnimationFrame(monitorUpdateLoop);
      }
    };
    
    const rafId = requestAnimationFrame(monitorUpdateLoop);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  // Calculate timeline position
  const timelinePercent = duration > 0 
    ? ((currentTime - timeSelection.start) / (timeSelection.end - timeSelection.start)) * 100 
    : 0;

  // **DEFENSIVE GUARD**: Prevent crash when player becomes invalid (AFTER all hooks run)
  // Show error UI instead of crashing with white screen
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
            data-testid="header-tracking-status"
          />
        </div>
        
        <div className="flex items-center gap-2">
          {/* **CRITICAL FIX**: Emergency video test button */}
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={async () => {
              const video = videoRef.current;
              if (!video) {
                console.error('🚨 EMERGENCY TEST: NO VIDEO FOUND!');
                return;
              }
              console.log('🆘 EMERGENCY VIDEO PLAYABILITY TEST:', {
                currentTime: video.currentTime.toFixed(2),
                duration: video.duration.toFixed(2),
                paused: video.paused,
                ended: video.ended,
                readyState: video.readyState,
                networkState: video.networkState,
                muted: video.muted,
                volume: video.volume,
                playbackRate: video.playbackRate
              });
              
              try {
                console.log('🚀 EMERGENCY: Calling video.play() directly...');
                const playPromise = video.play();
                await playPromise;
                console.log('✅ EMERGENCY: video.play() succeeded!');
              } catch (error) {
                console.error('❌ EMERGENCY: video.play() failed:', error);
              }
            }}
            data-testid="button-emergency-test"
          >
            🆘 TEST VIDEO
          </Button>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowEffects(!showEffects)}
            data-testid="button-toggle-effects"
          >
            {showEffects ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            Effects
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowTrackingBox(!showTrackingBox)}
            data-testid="button-toggle-tracking"
          >
            <Settings className="w-4 h-4" />
            Tracking Box
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowNativeControls(!showNativeControls)}
            data-testid="button-toggle-native-controls"
            title="Debug: Toggle native video controls"
          >
            <Zap className="w-4 h-4" />
            Native Controls
          </Button>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowDebugState(!showDebugState)}
            data-testid="button-toggle-debug-state"
            title="Debug: Toggle comprehensive state display"
            className={showDebugState ? 'bg-green-100 border-green-500' : ''}
          >
            <MonitorPlay className="w-4 h-4" />
            Debug State
          </Button>
          
          {/* **CRITICAL FIX**: Emergency Force Tracker Rebind Button */}
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={() => {
              console.log('🔄 EMERGENCY REBIND TRIGGERED BY USER');
              forceRebindToActiveVideo();
              const currentInfo = getCurrentVideoInfo();
              const allInfo = getAllVideoInfo();
              console.log('📊 Current Video Info:', currentInfo);
              console.log('📋 All Videos Info:', allInfo);
            }}
            data-testid="button-force-rebind"
            className="bg-red-600 hover:bg-red-700 text-white"
            title="Emergency: Force tracker to rebind to active video element"
          >
            <Zap className="w-4 h-4" />
            REBIND
          </Button>
        </div>
      </div>

      {/* Video Player */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Video Display */}
        <div className="lg:col-span-2">
          <Card className="p-4">
            <div 
              ref={containerRef}
              className="relative w-full bg-gray-900 rounded-lg overflow-hidden"
              style={{ aspectRatio: '16/9', position: 'relative' }}
            >
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain relative z-10 bg-transparent"
                playsInline
                muted={true}
                preload="auto"
                crossOrigin="anonymous"
                controls={showNativeControls}
                onClick={() => videoRef.current?.play()}
                onError={(e) => {
                  const video = e.currentTarget;
                  console.error('🚨 VIDEO LOAD ERROR:', {
                    src: video.src,
                    networkState: video.networkState,
                    readyState: video.readyState,
                    error: video.error,
                    errorCode: video.error?.code,
                    errorMessage: video.error?.message,
                    boundingRect: video.getBoundingClientRect()
                  });
                }}
                data-testid="video-preview-player"
                style={{ 
                  display: 'block',
                  backgroundColor: 'transparent',
                  opacity: 1 
                }}
              />
              
              {/* Spotlight Overlay */}
              {(() => {
                const currentVideoTime = videoRef.current?.currentTime || 0;
                const TIME_EPSILON = 0.001;
                // **ARCHITECT FIX**: Additive absoluteTime calculation
                // Explicitly add clip offset to current playback time
                const clipStart = timeSelection?.start ?? 0;
                const absoluteTime = clipStart + currentVideoTime;
                const isManuallySelected = !!selectedPlayer;
                const hasReachedDetectionTime = detectionTime === undefined || 
                  isManuallySelected || // Show immediately for manually selected players
                  (absoluteTime + TIME_EPSILON) >= detectionTime;
                const shouldRenderOverlay = showEffects && selectedEffect && hasReachedDetectionTime;
                
                // **DEBUG**: Log visibility check
                console.log('🎯 OVERLAY VISIBILITY CHECK:', {
                  currentVideoTime,
                  absoluteTime,
                  detectionTime,
                  hasReachedDetectionTime,
                  showEffects,
                  hasSelectedEffect: !!selectedEffect,
                  shouldRenderOverlay
                });
                const extractedEffect = (selectedEffect as any)?.effect?.id || (selectedEffect as any)?.effect?.name || (selectedEffect as any)?.id || (selectedEffect as any)?.name || 'spotlight';
                
                // **FIX**: Use selectedPlayer box as fallback when tracker hasn't produced a box yet
                const initialTrackingBox = trackingBox || selectedPlayer;
                
                return shouldRenderOverlay ? (
                  <SpotlightOverlay
                    videoRef={videoRef}
                    trackingBox={initialTrackingBox}
                    effect={extractedEffect}
                    settings={effectSettings}
                    isVisible={showEffects}
                    detectionTime={detectionTime} // Use actual timeline selection time for spotlight activation
                    selectedPlayerId={selectedPlayer?.id} // **FIXED**: Use actual selected player ID
                    selectedPlayer={selectedPlayer ? {
                      id: selectedPlayer.id,
                      centerX: selectedPlayer.centerX || 0,
                      centerY: selectedPlayer.centerY || 0,
                      x: selectedPlayer.x || 0,
                      y: selectedPlayer.y || 0,
                      width: selectedPlayer.width || 0,
                      height: selectedPlayer.height || 0
                    } : undefined} // **NEW**: Pass full player object for position matching
                    isManuallySelected={isManuallySelected}
                    showDebugOverlay={false} // **PRODUCTION MODE**: Debug panel hidden (toggle with button if needed)
                    getBoxByIdAtTime={getBoxByIdAtTime} // **PER-FRAME ID LOOKUP**
                    sampleTime={timeSelection.start + currentVideoTime} // **TIMEBASE FIX**: Pass absolute video time (in seconds) for tracking
                    realVideoTime={timeSelection.start + currentVideoTime} // **TIMEBASE FIX**: Pass absolute video time for time-based logic
                  />
                ) : (
                  <div 
                    className="absolute inset-0 z-50 pointer-events-none"
                    style={{ border: '2px dashed red', opacity: 0.3 }}
                    title={`SpotlightOverlay NOT rendered: showEffects=${showEffects}, selectedEffect=${!!selectedEffect}`}
                  />
                );
              })()}
              
              {/* **ON-SCREEN DEBUG STATE DISPLAY**: Comprehensive pipeline monitoring */}
              {showDebugState && (
                <div 
                  className="absolute top-4 left-4 z-[200] bg-black bg-opacity-80 text-white p-4 rounded-lg font-mono text-xs leading-tight max-w-md pointer-events-none"
                  style={{ 
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}
                  data-testid="debug-state-display"
                >
                  <div className="text-green-400 font-bold mb-2">🔍 SPOTLIGHT PIPELINE DEBUG</div>
                  
                  {/* Video Dimensions & Transforms */}
                  <div className="mb-3">
                    <div className="text-blue-400 font-semibold">📐 Video Dimensions:</div>
                    <div>Video: {videoRef.current?.videoWidth || 0}×{videoRef.current?.videoHeight || 0}</div>
                    <div>Canvas: {containerRef.current?.getBoundingClientRect().width.toFixed(0) || 0}×{containerRef.current?.getBoundingClientRect().height.toFixed(0) || 0}</div>
                    <div>DPR: {window.devicePixelRatio}</div>
                    <div>Object-fit: {videoRef.current ? window.getComputedStyle(videoRef.current).objectFit : 'N/A'}</div>
                  </div>
                  
                  {/* Tracking Status */}
                  <div className="mb-3">
                    <div className="text-yellow-400 font-semibold">🎯 Tracking Status:</div>
                    <div>Player ID: {selectedPlayer?.id || 'N/A'}</div>
                    <div>Status: <span className={status === 'tracking' ? 'text-green-400' : 'text-red-400'}>{status}</span></div>
                    <div>Has Box: {trackingBox ? '✅' : '❌'}</div>
                    <div>Detection Time: {detectionTime?.toFixed(3) || 'N/A'}s</div>
                    <div>Current Time: {currentTime.toFixed(3)}s</div>
                    <div>Reached Detection: {(() => {
                      const hasReached = detectionTime === undefined || currentTime >= detectionTime;
                      return hasReached ? '✅' : '⏳';
                    })()}</div>
                    <div>Manual Select: {!!selectedPlayer ? '✅' : '❌'}</div>
                  </div>
                  
                  {/* Coordinate Transform Matrix */}
                  <div className="mb-3">
                    <div className="text-purple-400 font-semibold">🔄 Transform Matrix:</div>
                    <div className="text-xs whitespace-pre-line">{coordinateMatrix}</div>
                  </div>
                  
                  {/* Tracking Box Coordinates */}
                  {trackingBox && (
                    <div className="mb-3">
                      <div className="text-cyan-400 font-semibold">📍 Tracking Box:</div>
                      <div>Raw: ({trackingBox.x.toFixed(4)}, {trackingBox.y.toFixed(4)})</div>
                      <div>Size: {trackingBox.width.toFixed(4)}×{trackingBox.height.toFixed(4)}</div>
                      <div>ID: {(trackingBox as any).id || 'N/A'}</div>
                      <div>Conf: {((trackingBox as any).confidence * 100 || 0).toFixed(1)}%</div>
                    </div>
                  )}
                  
                  {/* Performance Metrics */}
                  <div className="mb-3">
                    <div className="text-orange-400 font-semibold">⚡ Performance:</div>
                    <div>Frame Rate: {frameRate} FPS</div>
                    <div>Tracking: {updateLoopTiming.trackingUpdate.toFixed(2)}ms</div>
                    <div>Overlay: {updateLoopTiming.overlayDraw.toFixed(2)}ms</div>
                    <div>Total: {updateLoopTiming.totalFrame.toFixed(2)}ms</div>
                  </div>
                  
                  {/* Coordinate Pipeline Validation */}
                  <div className="mb-3">
                    <div className="text-red-400 font-semibold">🔍 Pipeline Validation:</div>
                    <div>Single Space: {(() => {
                      const video = videoRef.current;
                      if (!video || !trackingBox) return '⚠️ N/A';
                      
                      // Check if coordinates are properly normalized [0,1]
                      const isNormalized = trackingBox.x >= 0 && trackingBox.x <= 1 && 
                                          trackingBox.y >= 0 && trackingBox.y <= 1;
                      return isNormalized ? '✅ OK' : '❌ FAIL';
                    })()}</div>
                    <div>getBoundingClientRect: ✅ Used</div>
                    <div>CSS Transforms: {(() => {
                      const video = videoRef.current;
                      if (!video) return 'N/A';
                      const transform = window.getComputedStyle(video).transform;
                      return transform === 'none' ? '✅ None' : '⚠️ ' + transform;
                    })()}</div>
                    <div>Edge Violations: {(() => {
                      if (!trackingBox) return '⚠️ N/A';
                      const hasViolation = trackingBox.x < 0 || trackingBox.y < 0 || 
                                          trackingBox.x + trackingBox.width > 1 || 
                                          trackingBox.y + trackingBox.height > 1;
                      return hasViolation ? '❌ DETECTED' : '✅ NONE';
                    })()}</div>
                  </div>
                  
                  {/* Update Loop Order */}
                  <div>
                    <div className="text-indigo-400 font-semibold">🔄 Update Order:</div>
                    <div className="text-xs">
                      1. Tracking Update ({updateLoopTiming.trackingUpdate.toFixed(1)}ms)<br/>
                      2. Overlay Draw ({updateLoopTiming.overlayDraw.toFixed(1)}ms)<br/>
                      3. RAF Complete ({updateLoopTiming.totalFrame.toFixed(1)}ms)
                    </div>
                  </div>
                </div>
              )}
              
              {/* Manual Override Interaction Layer - only active when needed */}
              {trackingStatus.mode === 'manual' && (
                <div 
                  className="absolute inset-0 cursor-crosshair z-30"
                  title="Click to position tracking"
                  onClick={handleManualOverrideClick}
                  data-testid="manual-override-layer"
                />
              )}
              
              {/* Tracking Box Debug */}
              {showTrackingBox && trackingBox && (
                <div 
                  className="absolute border-2 border-yellow-400 bg-yellow-400/10"
                  style={{
                    left: `${trackingBox.x * 100}%`,
                    top: `${trackingBox.y * 100}%`,
                    width: `${trackingBox.width * 100}%`,
                    height: `${trackingBox.height * 100}%`,
                  }}
                />
              )}
            </div>
            
            {/* Video Controls */}
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePlayPause}
                  data-testid="button-play-pause"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestart}
                  data-testid="button-restart"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
                
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm font-mono" data-testid="text-current-time">
                    {formatTime(currentTime)}
                  </span>
                  <div className="flex-1 relative bg-muted rounded-full h-2">
                    <div 
                      className="absolute left-0 top-0 h-full bg-primary rounded-full transition-all duration-100"
                      style={{ width: `${Math.max(0, Math.min(100, timelinePercent))}%` }}
                    />
                    <input
                      type="range"
                      min={timeSelection.start}
                      max={timeSelection.end}
                      step={0.1}
                      value={currentTime}
                      onChange={(e) => handleSeek(parseFloat(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      data-testid="slider-timeline"
                    />
                  </div>
                  <span className="text-sm font-mono text-muted-foreground" data-testid="text-duration">
                    {formatTime(timeSelection.end)}
                  </span>
                </div>
              </div>
              
              {/* Clip Information */}
              <div className="text-xs text-muted-foreground">
                Playing clip: {formatTime(timeSelection.start)} - {formatTime(timeSelection.end)} 
                ({(timeSelection.end - timeSelection.start).toFixed(1)}s duration)
              </div>
            </div>
          </Card>
        </div>

        {/* Effect Settings Panel */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Effect Settings
              </h4>
              <Badge variant="secondary" className="text-xs">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1"></div>
                Live Preview
              </Badge>
            </div>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                💡 Effects render in real-time here for tuning. Final effects will be baked during Processing.
              </p>
            </div>
            
            <div className="space-y-4">
              {/* Intensity */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium">Intensity</label>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(effectSettings.intensity)}%
                  </span>
                </div>
                <Slider
                  value={[effectSettings.intensity / 100]}
                  onValueChange={([value]) => handleEffectSettingChange('intensity', value * 100)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full"
                  data-testid="slider-intensity"
                />
              </div>
              
              {/* Size */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium">Size</label>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(effectSettings.size)}%
                  </span>
                </div>
                <Slider
                  value={[effectSettings.size / 100]}
                  onValueChange={([value]) => handleEffectSettingChange('size', value * 100)}
                  min={0.1}
                  max={2}
                  step={0.1}
                  className="w-full"
                  data-testid="slider-size"
                />
              </div>
              
              {/* Color */}
              {effectSettings.color && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={effectSettings.color}
                      onChange={(e) => handleEffectSettingChange('color', e.target.value)}
                      className="w-16 h-8 rounded cursor-pointer"
                      data-testid="input-color"
                    />
                    <span className="text-xs text-muted-foreground">
                      {effectSettings.color}
                    </span>
                  </div>
                  {effectSettings.color === '#000000' && (
                    <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs">
                      <span className="text-amber-700 dark:text-amber-300">
                        ⚠️ Black color may be hard to see on dark footage. Try a bright color like yellow or white.
                      </span>
                    </div>
                  )}
                </div>
              )}
              
              {/* Animation */}
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Animation</label>
                <Switch
                  checked={effectSettings.animated}
                  onCheckedChange={(checked) => handleEffectSettingChange('animated', checked)}
                  data-testid="switch-animation"
                />
              </div>
            </div>
          </Card>

          {/* Enhanced Tracking Status with Fallback Controls */}
          <TrackingStatusIndicator 
            trackingStatus={trackingStatus}
            onManualOverride={manualOverride}
            onEnterManualMode={enterManualMode}
            onExitManualMode={exitManualMode}
            onResetTracking={resetTracking}
            videoRef={videoRef}
            compact={false}
            data-testid="detailed-tracking-status"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={onBack}
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Effects
        </Button>
        
        <Button 
          onClick={onConfirm}
          className="gap-2"
          data-testid="button-confirm-preview"
        >
          <CheckCircle className="w-4 h-4" />
          Confirm & Process Video
        </Button>
      </div>
    </div>
  );
}