import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useDevLogger } from './useDevLogger';

interface PreviewState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

interface PreviewController {
  state: PreviewState;
  videoRef: React.RefObject<HTMLVideoElement>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  onTimeUpdate: (handler: (time: number) => void) => void;
}

interface UsePreviewControllerOptions {
  initialTime?: number;
  timeRange?: { start: number; end: number };
  onPlaybackEnd?: () => void;
}

/**
 * Centralized video playback controller
 * Manages video element, playback state, and time updates with RAF throttling
 */
export function usePreviewController(options: UsePreviewControllerOptions = {}): PreviewController {
  const { initialTime = 0, timeRange, onPlaybackEnd } = options;
  const logger = useDevLogger('PreviewController');
  
  // **DEFENSIVE VALIDATION**: Normalize initialTime to prevent negative values
  // Use useMemo to ensure it updates when initialTime changes
  const normalizedInitialTime = useMemo(() => Math.max(0, initialTime ?? 0), [initialTime]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const timeUpdateHandlersRef = useRef<Set<(time: number) => void>>(new Set());
  const lastUpdateTimeRef = useRef<number>(0);
  const initialSeekDoneRef = useRef<boolean>(false); // **FIX**: Guard against repeated initial seeks
  
  const [state, setState] = useState<PreviewState>({
    isPlaying: false,
    currentTime: normalizedInitialTime,
    duration: 0,
  });

  // RAF loop for smooth time updates (only when playing)
  const startRAF = useCallback(() => {
    if (rafIdRef.current !== null) return; // Already running

    const updateLoop = () => {
      const video = videoRef.current;
      if (!video) {
        rafIdRef.current = null;
        return;
      }

      const currentTime = video.currentTime;
      const now = performance.now();
      
      // Throttle to ~30fps max (33ms between updates)
      if (now - lastUpdateTimeRef.current >= 33) {
        setState(prev => ({ ...prev, currentTime }));
        
        // Notify handlers
        timeUpdateHandlersRef.current.forEach(handler => handler(currentTime));
        
        lastUpdateTimeRef.current = now;
      }

      // Check time range bounds
      if (timeRange && currentTime >= timeRange.end) {
        console.log('🛑 AUTO-PAUSE: Reached end of timeRange', {
          currentTime,
          rangeEnd: timeRange.end,
          rangeStart: timeRange.start,
          exceeded: currentTime >= timeRange.end
        });
        video.pause();
        setState(prev => ({ ...prev, isPlaying: false }));
        onPlaybackEnd?.();
        rafIdRef.current = null;
        return;
      }

      rafIdRef.current = requestAnimationFrame(updateLoop);
    };

    rafIdRef.current = requestAnimationFrame(updateLoop);
    logger.log('RAF loop started');
  }, [timeRange, onPlaybackEnd, logger]);

  const stopRAF = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      logger.log('RAF loop stopped');
    }
  }, [logger]);

  // Play control
  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      logger.error('Cannot play: video element not found');
      return;
    }

    // Allow play with metadata (readyState >= 1) - browser will load frames during playback
    if (video.readyState < 1) {
      console.warn('⚠️ PLAY BLOCKED: Video has no metadata', { readyState: video.readyState });
      logger.warn('Play blocked - video not loaded');
      return;
    }

    try {
      await video.play();
      setState(prev => ({ ...prev, isPlaying: true }));
      startRAF();
      logger.log('Playback started');
    } catch (error) {
      logger.error('Play failed', error);
      throw error;
    }
  }, [startRAF, logger]);

  // Pause control
  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    setState(prev => ({ ...prev, isPlaying: false }));
    stopRAF();
    logger.log('Playback paused');
  }, [stopRAF, logger]);

  // Seek control
  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = time;
    setState(prev => ({ ...prev, currentTime: time }));
    logger.log('Seeked to', { time });
  }, [logger]);

  // Register time update handler
  const onTimeUpdate = useCallback((handler: (time: number) => void) => {
    timeUpdateHandlersRef.current.add(handler);
    return () => {
      timeUpdateHandlersRef.current.delete(handler);
    };
  }, []);

  // Initialize video metadata and wait for playable state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // **FIX**: Reset guard when normalizedInitialTime changes (allows seeking to new detection time)
    initialSeekDoneRef.current = false;

    const handleVideoReady = () => {
      setState(prev => ({ ...prev, duration: video.duration }));
      logger.log('Video ready to play', { 
        duration: video.duration, 
        readyState: video.readyState 
      });
      
      // **CRITICAL FIX**: Set initial time ONCE when video first becomes ready
      // Guard prevents repeated seeks on every canplay/loadeddata event (causes jolting)
      // **FIX 2025-10-07**: Use normalizedInitialTime (guaranteed >= 0) to handle all valid start times
      if (!initialSeekDoneRef.current) {
        video.currentTime = normalizedInitialTime;
        setState(prev => ({ ...prev, currentTime: normalizedInitialTime }));
        initialSeekDoneRef.current = true;
        logger.log('Initial seek performed', { initialTime: normalizedInitialTime });
      }
    };

    // **CRITICAL FIX**: Sync RAF with actual video playback state
    // This ensures RAF runs whenever video plays, regardless of how it starts
    const handlePlay = () => {
      setState(prev => ({ ...prev, isPlaying: true }));
      startRAF();
      logger.log('Video play event - RAF started');
    };

    const handlePause = () => {
      setState(prev => ({ ...prev, isPlaying: false }));
      stopRAF();
      logger.log('Video pause event - RAF stopped');
    };

    // **ERROR TRACKING**: Catch video loading failures
    const handleError = (e: Event) => {
      const error = (video as any).error;
      console.error('🚨 VIDEO LOAD ERROR:', {
        errorCode: error?.code,
        errorMessage: error?.message,
        src: video.src,
        networkState: video.networkState,
        readyState: video.readyState,
        event: e.type
      });
      logger.error('Video failed to load', { 
        code: error?.code, 
        message: error?.message,
        src: video.src?.slice(-50)
      });
    };

    const handleStalled = () => {
      console.warn('⚠️ VIDEO STALLED:', {
        src: video.src?.slice(-50),
        networkState: video.networkState,
        readyState: video.readyState,
        buffered: video.buffered.length
      });
      logger.warn('Video loading stalled');
    };

    // **CRITICAL DIAGNOSTIC**: Log initial video state
    console.log('📹 VIDEO SETUP:', {
      readyState: video.readyState,
      networkState: video.networkState,
      src: video.src?.slice(-50),
      preload: video.preload,
      hasValidSrc: !!video.src && video.src.startsWith('blob:')
    });
    
    // **CRITICAL FIX**: Ensure video element is configured for data loading
    video.preload = 'auto';
    
    // Check if already ready (has actual video data)
    if (video.readyState >= 2) {
      handleVideoReady();
    }
    
    // Listen for readiness events  
    video.addEventListener('loadedmetadata', handleVideoReady);
    video.addEventListener('loadeddata', handleVideoReady);
    video.addEventListener('canplay', handleVideoReady);
    video.addEventListener('canplaythrough', handleVideoReady);
    
    // **CRITICAL**: Sync RAF with video playback events
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    // **ERROR TRACKING**: Detect loading failures
    video.addEventListener('error', handleError);
    video.addEventListener('stalled', handleStalled);

    return () => {
      video.removeEventListener('loadedmetadata', handleVideoReady);
      video.removeEventListener('loadeddata', handleVideoReady);
      video.removeEventListener('canplay', handleVideoReady);
      video.removeEventListener('canplaythrough', handleVideoReady);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('error', handleError);
      video.removeEventListener('stalled', handleStalled);
      stopRAF();
    };
  }, [normalizedInitialTime, startRAF, stopRAF, logger]);

  return {
    state,
    videoRef,
    play,
    pause,
    seek,
    onTimeUpdate,
  };
}
