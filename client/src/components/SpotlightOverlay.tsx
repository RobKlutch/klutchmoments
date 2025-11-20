import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo, type RefObject } from 'react';
import { renderSpotlightEffectSvg, type EffectSettings } from "@/lib/effectRendererSvg";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';

// **UNIVERSAL OVERLAY SYSTEM**: Spotlight effect rendering over videos
interface SpotlightOverlayProps {
  videoRef: RefObject<HTMLVideoElement>;
  trackingBox: { x: number; y: number; width: number; height: number; id?: string; confidence?: number } | null;
  effect: string;
  settings: EffectSettings;
  className?: string;
  isVisible?: boolean;
  detectionTime?: number; // **NEW**: When spotlight should activate (default always visible)
  selectedPlayerId?: string; // **DEBUG**: For ID-lock status display
  selectedPlayer?: { id: string; centerX: number; centerY: number; x: number; y: number; width: number; height: number; }; // **NEW**: Full player object for position matching
  isManuallySelected?: boolean; // **DEBUG**: For tracking mode display
  showDebugOverlay?: boolean; // **DEBUG**: Enable visual debugging
  sampleTime: number; // **CRITICAL**: Current video time for coordinate lookups
  realVideoTime: number; // **CRITICAL**: Current video time for time-based logic
  // **PER-FRAME ID LOOKUP**: Required function for ID-specific box retrieval
  getBoxByIdAtTime: (selectedPlayerId: string, lookupTime: number) => {
    box: { x: number; y: number; width: number; height: number; id?: string } | null;
    boxTimestamp: number | null;
    timeDelta: number;
    found: boolean;
    reason?: string;
  };
}

interface VideoRenderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function SpotlightOverlay({
  videoRef,
  trackingBox,
  effect,
  settings,
  className = '',
  isVisible = true,
  detectionTime,
  selectedPlayerId,
  selectedPlayer,
  isManuallySelected = false,
  showDebugOverlay = false,
  sampleTime,
  realVideoTime,
  getBoxByIdAtTime
}: SpotlightOverlayProps) {
  // **ARCHITECT FIX**: Health check state - MUST be at top before any returns
  const [timebaseHealthy, setTimebaseHealthy] = useState(false);
  const [healthCheckAttempts, setHealthCheckAttempts] = useState(0);
  const lastHealthCheckTime = useRef<number>(0);
  const timebaseStartTime = useRef<number>(0);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // **🚨 TIMEBASE REFS**: Critical for live timebase advancement tracking
  const lastVideoTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);

  // **ARCHITECT FIX**: Run timebase health check immediately - BEFORE any returns
  useEffect(() => {
    const video = videoRef?.current;
    console.log('🚨🚨🚨 TIMEBASE HEALTH CHECK STARTED 🚨🚨🚨:', {
      hasVideo: !!video,
      readyState: video?.readyState || 'no video',
      paused: video?.paused || 'no video',
      timestamp: Date.now()
    });
    
    if (!video) {
      console.log('❌ No video element found - setting unhealthy');
      setTimebaseHealthy(false);
      return;
    }

    // **CRITICAL OVERRIDE**: For paused videos, immediately mark as healthy to bypass architect gate
    if (video.paused && video.readyState >= 2) {
      console.log('✅ PAUSED VIDEO DETECTED - IMMEDIATELY MARKING TIMEBASE HEALTHY:', {
        paused: video.paused,
        readyState: video.readyState,
        currentTime: video.currentTime.toFixed(3)
      });
      setTimebaseHealthy(true);
      setHealthCheckAttempts(0);
      return;
    }

    // Original health check logic for playing videos... (rest of health check logic will be preserved)
    let checkInterval: NodeJS.Timeout;
    let initialTime = video.currentTime;
    let checksPerformed = 0;
    const maxChecks = 5;

    const startCheck = setTimeout(() => {
      console.log('🏥 TIMEBASE HEALTH CHECK STARTING FOR PLAYING VIDEO:', {
        initialTime: initialTime.toFixed(3),
        paused: video.paused,
        readyState: video.readyState
      });
      
      checkInterval = setInterval(() => {
        checksPerformed++;
        const currentTime = video.currentTime;
        const timeAdvanced = Math.abs(currentTime - initialTime) > 0.01;
        
        console.log(`🏥 TIMEBASE HEALTH CHECK ${checksPerformed}/${maxChecks}:`, {
          initialTime: initialTime.toFixed(3),
          currentTime: currentTime.toFixed(3),
          timeAdvanced,
          timeDelta: (currentTime - initialTime).toFixed(3),
          paused: video.paused
        });

        if (timeAdvanced || video.paused) {
          setTimebaseHealthy(true);
          setHealthCheckAttempts(0);
          clearInterval(checkInterval);
          clearTimeout(startCheck);
          console.log('✅ TIMEBASE HEALTHY: Video time advancing properly');
          return;
        }

        if (checksPerformed >= maxChecks) {
          setTimebaseHealthy(false);
          setHealthCheckAttempts(prev => prev + 1);
          clearInterval(checkInterval);
          console.warn('🚨 TIMEBASE UNHEALTHY: Video time not advancing after multiple checks');
        }
      }, 100);
    }, 250);

    return () => {
      clearTimeout(startCheck);
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);  // Run once on mount

  // **CRITICAL GATING**: Only render overlay when video is healthy and timebase advancing
  const video = videoRef?.current;
  const videoReady = video && video.readyState >= 2;
  
  // **ARCHITECT FIX**: Enable immediate manual activation - relax hasValidTracking condition
  // Use real isManuallySelected prop, don't shadow it with local variable
  const hasValidTracking = !!selectedPlayerId && (!!trackingBox || isManuallySelected || !!selectedPlayer);
  
  // **ARCHITECT PRESCRIBED**: Health-gated visibility check
  const healthGatedVisibility = videoReady && hasValidTracking && timebaseHealthy && isVisible;
  
  console.log('🔥🔥🔥 SPOTLIGHT COMPONENT - HOOKS EXECUTED FIRST 🔥🔥🔥', { 
    detectionTime, 
    isVisible,
    videoReady,
    hasValidTracking,
    timebaseHealthy,
    healthGatedVisibility,
    hasVideoRef: !!videoRef?.current 
  });
  
  // **HOOKS MUST COME FIRST**: Store conditional rendering logic for later
  
  console.log('📦 SPOTLIGHT OVERLAY: Component rendering with active health checks:', {
    selectedPlayerId: selectedPlayerId || 'null',
    hasGetBoxByIdAtTime: !!getBoxByIdAtTime,
    hasTrackingBox: !!trackingBox,
    detectionTime: detectionTime ? detectionTime.toFixed(3) : 'null'
  });
  
  // **REMOVED DUPLICATE DECLARATIONS**: Variables already declared at top
  useEffect(() => {
    const video = videoRef?.current;
    console.log('🚨🚨🚨 IMMEDIATE TIMEBASE HEALTH OVERRIDE TRIGGERED 🚨🚨🚨:', {
      hasVideo: !!video,
      readyState: video?.readyState || 'no video',
      paused: video?.paused || 'no video',
      timestamp: Date.now()
    });
    
    if (!video) {
      console.log('❌ No video element found - setting unhealthy');
      setTimebaseHealthy(false);
      return;
    }

    // **CRITICAL OVERRIDE**: For paused videos, immediately mark as healthy to bypass architect gate
    if (video.paused && video.readyState >= 2) {
      console.log('✅ PAUSED VIDEO DETECTED - IMMEDIATELY MARKING TIMEBASE HEALTHY:', {
        paused: video.paused,
        readyState: video.readyState,
        currentTime: video.currentTime.toFixed(3)
      });
      setTimebaseHealthy(true);
      setHealthCheckAttempts(0);
      return;
    }

    // Original health check logic for playing videos
    let checkInterval: NodeJS.Timeout;
    let initialTime = video.currentTime;
    let checksPerformed = 0;
    const maxChecks = 5;

    const startCheck = setTimeout(() => {
      console.log('🏥 TIMEBASE HEALTH CHECK STARTING FOR PLAYING VIDEO:', {
        initialTime: initialTime.toFixed(3),
        paused: video.paused,
        readyState: video.readyState
      });
      
      checkInterval = setInterval(() => {
        checksPerformed++;
        const currentTime = video.currentTime;
        const timeAdvanced = Math.abs(currentTime - initialTime) > 0.01;
        
        console.log(`🏥 TIMEBASE HEALTH CHECK ${checksPerformed}/${maxChecks}:`, {
          initialTime: initialTime.toFixed(3),
          currentTime: currentTime.toFixed(3),
          timeAdvanced,
          timeDelta: (currentTime - initialTime).toFixed(3),
          paused: video.paused
        });

        if (timeAdvanced || video.paused) {
          setTimebaseHealthy(true);
          setHealthCheckAttempts(0);
          clearInterval(checkInterval);
          clearTimeout(startCheck);
          console.log('✅ TIMEBASE HEALTHY: Video time advancing properly');
          return;
        }

        if (checksPerformed >= maxChecks) {
          setTimebaseHealthy(false);
          setHealthCheckAttempts(prev => prev + 1);
          clearInterval(checkInterval);
          console.warn('🚨 TIMEBASE UNHEALTHY: Video time not advancing after multiple checks');
        }
      }, 100);
    }, 250);

    return () => {
      clearTimeout(startCheck);
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);  // Run once on mount

  // **FIXED**: Use refs for performance tracking to prevent re-renders
  const isVideoPlayingRef = useRef(false);
  const [isPageVisible, setIsPageVisible] = useState(!document.hidden);
  const lastRenderDataRef = useRef<string>('');
  
  // **VERIFICATION HUD STATE**: Track prerequisite validation and render status
  const [verificationHudData, setVerificationHudData] = useState<{
    effectsMounted: boolean;
    videoReady: boolean;
    contentRect: { w: number; h: number } | null;
    canvas: { w: number; h: number } | null;
    dpr: number;
    rAFStarted: boolean;
    rAFFrameCount: number;
    lastErrorMessage: string | null;
    lastSuccessfulDrawTime: number | null;
    prerequisitesValid: boolean;
    // **TIMEBASE FIELDS**
    currentVideoTime: number;
    clipStartOffset: number;
    sampleTime: number;
    selectedActivationTime: number | null;
    // **TRACKING FIELDS**
    selectedPlayerId: string | null;
    trackingBoxId: string | null;
    idMatch: boolean;
    boxTimestamp: number | null;
    timeDelta: number | null;
    // **RENDER FIELDS**
    hasValidBoxForSelected: boolean;
    freezeActive: boolean;
    framesSinceLastValid: number;
    finalIsSpotlightActive: boolean;
  }>({
    effectsMounted: false,
    videoReady: false,
    contentRect: null,
    canvas: null,
    dpr: window.devicePixelRatio || 1,
    rAFStarted: false,
    rAFFrameCount: 0,
    lastErrorMessage: null,
    lastSuccessfulDrawTime: null,
    prerequisitesValid: false,
    currentVideoTime: 0,
    clipStartOffset: 0,
    sampleTime: 0,
    selectedActivationTime: null,
    selectedPlayerId: null,
    trackingBoxId: null,
    idMatch: false,
    boxTimestamp: null,
    timeDelta: null,
    hasValidBoxForSelected: false,
    freezeActive: false,
    framesSinceLastValid: 0,
    finalIsSpotlightActive: false
  });

  // **FIXED**: Use ref instead of state to prevent re-renders
  const currentVideoTimeRef = useRef(0);
  
  // **VISIBILITY CHANGE HANDLING**: Stop rAF when page hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      setIsPageVisible(isVisible);
      
      if (!isVisible && animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        setVerificationHudData(prev => ({ ...prev, rAFStarted: false }));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // **RESIZE OBSERVER**: Recompute contentRect and canvas on resize
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      validatePrerequisites();
    });

    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, []);
  
  // **PREREQUISITE VALIDATION**: Gate rAF startup with comprehensive checks
  const validatePrerequisites = useCallback(() => {
    try {
      // **EFFECTSMOUNTED CHECK**: Must be mounted first
      setVerificationHudData(prev => ({ ...prev, effectsMounted: true }));
      
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        setVerificationHudData(prev => ({ 
          ...prev, 
          videoReady: false,
          lastErrorMessage: 'Video not ready (readyState < 2)',
          prerequisitesValid: false
        }));
        return false;
      }
      
      const container = svgContainerRef.current;
      if (!container) {
        setVerificationHudData(prev => ({ 
          ...prev, 
          contentRect: null,
          canvas: null,
          lastErrorMessage: 'SVG container not found',
          prerequisitesValid: false
        }));
        return false;
      }
      
      const contentRect = container?.getBoundingClientRect();
      if (!contentRect || contentRect.width === 0 || contentRect.height === 0) {
        setVerificationHudData(prev => ({ 
          ...prev, 
          contentRect: null,
          canvas: null,
          lastErrorMessage: 'Container rect invalid or zero size',
          prerequisitesValid: false
        }));
        return false;
      }
      
      const dpr = window.devicePixelRatio || 1;
      if (!isFinite(dpr) || dpr <= 0) {
        setVerificationHudData(prev => ({ 
          ...prev, 
          lastErrorMessage: 'Invalid device pixel ratio',
          prerequisitesValid: false
        }));
        return false;
      }
      
      // **SUCCESS**: All prerequisites met
      setVerificationHudData(prev => ({ 
        ...prev, 
        videoReady: true,
        contentRect: { w: contentRect.width, h: contentRect.height },
        canvas: { w: video.videoWidth, h: video.videoHeight },
        dpr,
        lastErrorMessage: null,
        prerequisitesValid: true
      }));
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      setVerificationHudData(prev => ({ 
        ...prev, 
        lastErrorMessage: errorMessage,
        prerequisitesValid: false
      }));
      return false;
    }
  }, []);

  
  // **CRITICAL FIX**: Calculate effective visibility based on tracking data availability
  // REQUIREMENT: Show spotlight when we have valid tracking data, don't wait for detection time
  // Add small tolerance to handle floating point precision errors
  const TIME_EPSILON = 0.001; // 1ms tolerance for floating point comparison
  
  // **HARD PREREQUISITE GATE**: Define once and use everywhere
  const requireReady = verificationHudData.videoReady && 
    verificationHudData.contentRect != null;

  // **HARD RESET ON STAGE ENTRY**: Reset state on selection change
  useEffect(() => {
    if (selectedPlayerId) {
      // Reset all tracking state for clean start
      setVerificationHudData(prev => ({
        ...prev,
        framesSinceLastValid: 0,
        freezeActive: false,
        lastErrorMessage: null,
        finalIsSpotlightActive: false
      }));
      
      // Trigger prerequisite validation
      validatePrerequisites();
    }
  }, [selectedPlayerId, validatePrerequisites]);

  // **LIVE TIMEBASE WIRING**: Per-frame driver for continuous updates
  const [currentFrameTime, setCurrentFrameTime] = useState(0);
  const clipStartOffset = 0; // Will be wired later when available
  
  // **CRITICAL FIX**: Use actual video time even when paused to enable coordinate lookup
  const liveVideoTime = videoRef.current?.currentTime || 0;
  const calculatedSampleTime = Math.max(currentFrameTime, liveVideoTime) + clipStartOffset;
  
  // **UNIFIED rAF LOOP**: Single source - read time → fetch box → compute position → smooth → draw
  useEffect(() => {
    let rafId: number;
    
    const unifiedRafLoop = () => {
      const video = videoRef.current;
      if (video) {
        // **STEP 1**: Read time
        const newTime = video.currentTime;
        setCurrentFrameTime(newTime);
        
        // **STEP 2**: Fetch box will happen in the useEffect that watches sampleTime changes
        // **STEP 3**: Compute position will happen in overlayPosPx calculation  
        // **STEP 4**: Smooth → draw handled by render function
      }
      rafId = requestAnimationFrame(unifiedRafLoop);
    };
    
    rafId = requestAnimationFrame(unifiedRafLoop);
    
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [videoRef]);
  
  // **TIMEBASE ADVANCEMENT ASSERTION**: Log if timebase doesn't advance
  const lastSampleTimeRef = useRef(0);
  if (sampleTime < lastSampleTimeRef.current) {
    console.warn('⚠️ TIMEBASE REGRESSION:', { 
      currentSampleTime: sampleTime.toFixed(3), 
      lastSampleTime: lastSampleTimeRef.current.toFixed(3) 
    });
  }
  lastSampleTimeRef.current = sampleTime;
  
  // **CORRECTED GATING LOGIC**: Manual selection only applies to Preview, not Timeline state leakage
  const hasSelectedPlayer = selectedPlayerId != null && selectedPlayerId !== '';
  
  // **SINGLE-SOURCE SELECTION WITH HYSTERESIS**: Prevent coordinate jumping between sources
  const [liveTrackingBox, setLiveTrackingBox] = useState<any>(null);
  const [boxTimestamp, setBoxTimestamp] = useState<number | null>(null);
  const [timeDelta, setTimeDelta] = useState<number | null>(null);
  
  // **SOURCE SELECTION STATE**: Track current source and prevent flapping
  const [currentSource, setCurrentSource] = useState<'server' | 'anchor' | null>(null);
  const [sourceLockedUntil, setSourceLockedUntil] = useState<number>(0);
  const [serverLockUsed, setServerLockUsed] = useState<boolean>(false); // Permanently disable anchor after server use
  
  // **DEBUG TELEMETRY STATE**: Track source transitions and position jumps
  const [lastSourceTransition, setLastSourceTransition] = useState<{source: string, timestamp: number} | null>(null);
  const [lastPosition, setLastPosition] = useState<{x: number, y: number} | null>(null);
  const [positionJumpCount, setPositionJumpCount] = useState<number>(0);
  const [toleranceViolationCount, setToleranceViolationCount] = useState<number>(0);
  
  // **STABILITY IMPROVEMENTS**: Track consecutive misses and last known box with refs for reliability
  const consecutiveMissesRef = useRef<number>(0);
  const [consecutiveMisses, setConsecutiveMisses] = useState<number>(0);
  const lastKnownBoxRef = useRef<any>(null);
  const [lastKnownBox, setLastKnownBox] = useState<any>(null);
  const [serverHoldActive, setServerHoldActive] = useState<boolean>(false); // Decouple from time lock
  
  // **MOTION SMOOTHING STATE**: Exponential moving average and velocity capping
  const smoothedBoxRef = useRef<any>(null);
  const [smoothedBox, setSmoothedBox] = useState<any>(null);
  const lastSmoothingTimeRef = useRef<number>(0);
  const [rawVsSmoothedDelta, setRawVsSmoothedDelta] = useState<{raw: {x: number, y: number}, smoothed: {x: number, y: number}, delta: number} | null>(null);
  
  // **CANONICAL COORDINATE CONVERSION**: Convert selectedPlayer anchor to normalized top-left
  const getCanonicalAnchorBox = useCallback(() => {
    if (!selectedPlayer) return null;
    
    // Convert centerX,centerY to top-left normalized coordinates
    const canonicalBox = {
      x: Math.max(0, Math.min(1, selectedPlayer.centerX - selectedPlayer.width / 2)),
      y: Math.max(0, Math.min(1, selectedPlayer.centerY - selectedPlayer.height / 2)),
      width: Math.max(0, Math.min(1, selectedPlayer.width)),
      height: Math.max(0, Math.min(1, selectedPlayer.height)),
      id: selectedPlayer.id
    };
    
    return canonicalBox;
  }, [selectedPlayer]);
  
  // **MOTION SMOOTHING RESET**: Reset smoothing state on transitions
  const resetMotionSmoothing = useCallback(() => {
    smoothedBoxRef.current = null;
    lastSmoothingTimeRef.current = 0;
    setSmoothedBox(null);
    setLastPosition(null);
    setRawVsSmoothedDelta(null);
  }, []);
  
  // **MOTION SMOOTHING FUNCTION**: Apply time-based EMA and velocity capping to reduce jitter
  const applyMotionSmoothing = useCallback((rawBox: any, shouldResetOnTransition = false) => {
    if (!rawBox) return null;
    
    // **RESET ON TRANSITIONS**: Clear smoothing state for clean start
    if (shouldResetOnTransition) {
      resetMotionSmoothing();
    }
    
    const now = performance.now();
    const rawDt = lastSmoothingTimeRef.current ? (now - lastSmoothingTimeRef.current) / 1000 : 0; // Raw time delta
    const dt = Math.min(0.1, rawDt); // Capped dt for EMA calculations
    lastSmoothingTimeRef.current = now;
    
    // **INITIALIZE SMOOTHING**: Use raw box for first frame or after reset
    if (!smoothedBoxRef.current || rawDt === 0) {
      smoothedBoxRef.current = { ...rawBox };
      if (showDebugOverlay) setSmoothedBox({ ...rawBox });
      return rawBox;
    }
    
    // **FRAME GAP RESET**: Reset on long frame stalls using raw time
    if (rawDt > 0.5) {
      resetMotionSmoothing();
      smoothedBoxRef.current = { ...rawBox };
      if (showDebugOverlay) {
        setSmoothedBox({ ...rawBox });
        console.log(`🔄 SPOTLIGHT: FRAME GAP RESET: rawDt=${rawDt.toFixed(3)}s > 0.5s`);
      }
      return rawBox;
    }
    
    // **OPTIMIZED EMA**: Higher responsiveness to reduce lag
    const baseAlpha = 0.4; // Increased for better responsiveness
    const targetFrameTime = 1/60; // 60fps target
    const alphaEff = 1 - Math.pow(1 - baseAlpha, dt / targetFrameTime);
    
    // **CALCULATE RAW CENTERS**
    const rawCenterX = rawBox.x + rawBox.width / 2;
    const rawCenterY = rawBox.y + rawBox.height / 2;
    const smoothedCenterX = smoothedBoxRef.current.x + smoothedBoxRef.current.width / 2;
    const smoothedCenterY = smoothedBoxRef.current.y + smoothedBoxRef.current.height / 2;
    
    // **COMPUTE DELTAS**
    const deltaX = rawCenterX - smoothedCenterX;
    const deltaY = rawCenterY - smoothedCenterY;
    const deltaDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // **ANTI-DOUBLE-DAMPING**: Use velocity cap OR EMA, not both
    const maxVelocityPerSecond = 2.5; // Max movement per second
    const maxMovementThisFrame = maxVelocityPerSecond * rawDt; // Use raw time
    
    let newCenterX, newCenterY;
    
    if (deltaDistance > maxMovementThisFrame) {
      // **VELOCITY CAPPED**: Move at max speed toward target (no EMA)
      const cappingFactor = maxMovementThisFrame / deltaDistance;
      newCenterX = smoothedCenterX + deltaX * cappingFactor;
      newCenterY = smoothedCenterY + deltaY * cappingFactor;
      if (showDebugOverlay) {
        console.log(`🎯 SPOTLIGHT: VELOCITY CAPPED: ${deltaDistance.toFixed(3)} → ${maxMovementThisFrame.toFixed(3)} (no EMA)`);
      }
    } else {
      // **EMA SMOOTHING**: Apply exponential moving average for small movements
      newCenterX = smoothedCenterX + alphaEff * deltaX;
      newCenterY = smoothedCenterY + alphaEff * deltaY;
    }
    
    // **SMOOTH SIZE WITH TIME-BASED EMA**
    const newWidth = smoothedBoxRef.current.width + alphaEff * (rawBox.width - smoothedBoxRef.current.width);
    const newHeight = smoothedBoxRef.current.height + alphaEff * (rawBox.height - smoothedBoxRef.current.height);
    
    // **CONVERT BACK TO TOP-LEFT COORDINATES**
    const smoothedResult = {
      x: Math.max(0, Math.min(1, newCenterX - newWidth / 2)),
      y: Math.max(0, Math.min(1, newCenterY - newHeight / 2)),
      width: Math.max(0, Math.min(1, newWidth)),
      height: Math.max(0, Math.min(1, newHeight)),
      id: rawBox.id
    };
    
    // **UPDATE REFS AND STATE**: Only update state when debug overlay is active
    smoothedBoxRef.current = smoothedResult;
    if (showDebugOverlay) {
      setSmoothedBox(smoothedResult);
      setRawVsSmoothedDelta({
        raw: { x: rawCenterX, y: rawCenterY },
        smoothed: { x: newCenterX, y: newCenterY },
        delta: Math.sqrt((rawCenterX - newCenterX) ** 2 + (rawCenterY - newCenterY) ** 2)
      });
    }
    
    return smoothedResult;
  }, [showDebugOverlay, resetMotionSmoothing]);
  
  // **PLAYER CHANGE DETECTION**: Reset smoothing state on player ID changes
  const prevSelectedPlayerIdRef = useRef<string | null>(null);
  
  // **SOURCE SELECTION WITH PRECEDENCE AND HYSTERESIS**: Single canonical source per frame
  useEffect(() => {
    // **RESET ON PLAYER CHANGE**: Clear all state when player changes
    if (prevSelectedPlayerIdRef.current && prevSelectedPlayerIdRef.current !== selectedPlayerId) {
      resetMotionSmoothing();
      setCurrentSource(null);
      setSourceLockedUntil(0);
      setServerHoldActive(false);
      setServerLockUsed(false);
      consecutiveMissesRef.current = 0;
      setConsecutiveMisses(0);
      console.log(`🔄 SPOTLIGHT: PLAYER CHANGE: ${prevSelectedPlayerIdRef.current} → ${selectedPlayerId} (full state reset)`);
    }
    prevSelectedPlayerIdRef.current = selectedPlayerId || null;
    
    if (showDebugOverlay) {
      console.log('📦 SPOTLIGHT: useEffect TRIGGER:', {
        selectedPlayerId: selectedPlayerId || 'null', 
        hasGetBoxByIdAtTime: !!getBoxByIdAtTime,
        sampleTime: sampleTime.toFixed(3),
        isManuallySelected: isManuallySelected || false,
        detectionTime: detectionTime ? detectionTime.toFixed(3) : 'null',
        realVideoTime: realVideoTime.toFixed(3)
      });
    }
    
    const now = Date.now();
    const isSourceLocked = now < sourceLockedUntil;
    
    if (selectedPlayerId && getBoxByIdAtTime) {
      // **MANUAL SELECTION TIME LOGIC**: Use detection time only initially, switch to sampleTime after first server lock
      const lookupTime = (isManuallySelected && detectionTime && !serverLockUsed) ? detectionTime : sampleTime;
      
      const lookupResult = getBoxByIdAtTime(selectedPlayerId, lookupTime);
      
      if (showDebugOverlay) {
        console.log('📦 SPOTLIGHT: COORDINATE LOOKUP:', {
          selectedPlayerId,
          isManuallySelected,
          currentVideoTime: realVideoTime.toFixed(3),
          detectionTime: detectionTime ? detectionTime.toFixed(3) : 'null',
          sampleTime: sampleTime.toFixed(3),
          lookupTime: lookupTime.toFixed(3),
          foundBox: !!lookupResult.box,
          boxTimestamp: lookupResult.boxTimestamp
        });
      }
      
      // **PRECEDENCE 1: Server ID-locked data** (RELAXED: timeDelta ≤ 500ms for stability)
      const timeDeltaAbs = lookupResult.boxTimestamp !== null ? Math.abs(lookupResult.boxTimestamp - lookupTime) : Infinity;
      const serverAvailable = lookupResult.box && (lookupResult.boxTimestamp !== null) && (timeDeltaAbs <= 0.5);
      
      // **DEBUG TELEMETRY**: Track tolerance violations (now 500ms threshold)
      if (lookupResult.box && timeDeltaAbs > 0.5) {
        setToleranceViolationCount(prev => {
          const newCount = prev + 1;
          if (showDebugOverlay) {
            console.log(`⚠️ SPOTLIGHT: TOLERANCE VIOLATION: timeDelta=${timeDeltaAbs.toFixed(3)}s > 0.5s (violation #${newCount})`);
          }
          return newCount;
        });
      }
      
      // **PRECEDENCE 2: Anchor fallback** (only if server never used)
      const anchorAvailable = !serverLockUsed && selectedPlayer;
      
      // **DECOUPLED SERVER HOLD LOGIC**: Miss tracking independent of time lock
      let selectedSource: 'server' | 'anchor' | null = null;
      let selectedBox: any = null;
      let selectedTimestamp: number | null = null;
      let selectedTimeDelta: number = 0;
      
      // **SERVER HOLD LOGIC**: Maintain server hold while misses < 3, regardless of time lock
      if (serverHoldActive || (currentSource === 'server' && isSourceLocked)) {
        if (serverAvailable) {
          // **SERVER SUCCESS**: Reset miss counter and use live server data
          selectedSource = 'server';
          selectedBox = lookupResult.box;
          selectedTimestamp = lookupResult.boxTimestamp;
          selectedTimeDelta = lookupResult.timeDelta;
          
          // **UPDATE REFS AND STATE**: Use functional updates for reliability
          consecutiveMissesRef.current = 0;
          setConsecutiveMisses(0);
          lastKnownBoxRef.current = selectedBox;
          setLastKnownBox(selectedBox);
          setServerHoldActive(true);
          
          // **EXTEND TIME LOCK**: Keep source locked during successful server use
          setSourceLockedUntil(now + 1000);
        } else {
          // **SERVER MISS**: Increment miss counter with ref for reliability
          const newMissCount = consecutiveMissesRef.current + 1;
          consecutiveMissesRef.current = newMissCount;
          setConsecutiveMisses(newMissCount);
          console.log(`⚠️ SPOTLIGHT: Server miss #${newMissCount}/3 - timeDelta=${timeDeltaAbs.toFixed(3)}s`);
          
          if (newMissCount >= 3) {
            // **RELEASE AFTER 3+ MISSES**: End server hold with graceful fallback
            console.log(`🔄 SPOTLIGHT: Server hold released after ${newMissCount} consecutive misses`);
            setServerHoldActive(false);
            setSourceLockedUntil(now + 500); // Brief grace period before full release
            
            // **GRACEFUL FALLBACK**: Use last known box for grace period
            if (lastKnownBoxRef.current) {
              selectedSource = 'server';
              selectedBox = lastKnownBoxRef.current;
              selectedTimestamp = sampleTime;
              selectedTimeDelta = 0;
            }
          } else {
            // **HOLD SERVER**: Continue with server source using cached box
            selectedSource = 'server';
            selectedBox = lastKnownBoxRef.current || lastKnownBox;
            selectedTimestamp = sampleTime;
            selectedTimeDelta = 0;
            setServerHoldActive(true);
            
            // **EXTEND HOLD**: Keep server hold active during misses < 3
            setSourceLockedUntil(now + 1000);
          }
        }
      } else if (isSourceLocked && currentSource === 'anchor' && anchorAvailable) {
        // **ANCHOR SOURCE**: Only used before first server lock
        selectedSource = 'anchor';
        selectedBox = getCanonicalAnchorBox();
        selectedTimestamp = sampleTime;
        selectedTimeDelta = 0;
        consecutiveMissesRef.current = 0;
        setConsecutiveMisses(0);
      }
      
      if (!selectedSource) {
        // **FRESH SOURCE SELECTION WITH PRECEDENCE**
        if (serverAvailable) {
          selectedSource = 'server';
          selectedBox = lookupResult.box;
          selectedTimestamp = lookupResult.boxTimestamp;
          selectedTimeDelta = lookupResult.timeDelta;
          
          // **INITIALIZE SERVER HOLD**: Set hold active and reset miss tracking
          setServerHoldActive(true);
          consecutiveMissesRef.current = 0;
          setConsecutiveMisses(0);
          lastKnownBoxRef.current = selectedBox;
          setLastKnownBox(selectedBox);
          
          // **PERMANENT SERVER LOCK**: Disable anchor after first server use
          if (!serverLockUsed) {
            setServerLockUsed(true);
            console.log(`🔒 SPOTLIGHT: Server source used - permanently disabling anchor fallback`);
          }
        } else if (anchorAvailable) {
          selectedSource = 'anchor';
          selectedBox = getCanonicalAnchorBox();
          selectedTimestamp = sampleTime;
          selectedTimeDelta = 0;
        }
        
        // **ENHANCED SOURCE LOCK**: Prevent flapping with 1000ms window for stability
        if (selectedSource) {
          // **DEBUG TELEMETRY**: Track source transitions and reset smoothing
          if (selectedSource !== currentSource) {
            setLastSourceTransition({source: selectedSource, timestamp: now});
            resetMotionSmoothing(); // Reset smoothing state on source transition
            console.log(`🔄 SPOTLIGHT: SOURCE TRANSITION: ${currentSource || 'null'} → ${selectedSource} at ${now} (smoothing reset)`);
          }
          
          setCurrentSource(selectedSource);
          setSourceLockedUntil(now + 1000); // 1000ms hysteresis for stability
          setConsecutiveMisses(0); // Reset miss counter on fresh selection
          console.log(`🎯 SPOTLIGHT: Selected source "${selectedSource}" locked for 1000ms`);
        }
      }
      
      // **APPLY SELECTED SOURCE WITH MOTION SMOOTHING**
      if (selectedBox) {
        // **MOTION SMOOTHING**: Apply EMA and velocity capping with reset detection
        const shouldReset = selectedSource !== currentSource || timeDeltaAbs > 0.5; // Reset on source change or large time gap
        const smoothedResult = applyMotionSmoothing(selectedBox, shouldReset);
        const finalBox = smoothedResult || selectedBox; // Fallback to raw if smoothing fails
        
        // **DEBUG TELEMETRY**: Track position jumps (use smoothed box center for accuracy)
        const centerX = finalBox.x + finalBox.width / 2;
        const centerY = finalBox.y + finalBox.height / 2;
        const currentPos = {x: centerX, y: centerY};
        
        if (lastPosition) {
          const deltaX = Math.abs(currentPos.x - lastPosition.x);
          const deltaY = Math.abs(currentPos.y - lastPosition.y);
          const jumpDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          
          // **POSITION JUMP DETECTION**: Flag significant moves (>20% of screen) after smoothing
          if (jumpDistance > 0.2) {
            setPositionJumpCount(prev => {
              const newCount = prev + 1;
              if (showDebugOverlay) {
                console.log(`🚨 SPOTLIGHT: POSITION JUMP DETECTED: ${jumpDistance.toFixed(3)} (Δx=${deltaX.toFixed(3)}, Δy=${deltaY.toFixed(3)}) from source="${selectedSource}" jump #${newCount} (post-smoothing)`);
              }
              return newCount;
            });
          }
        }
        setLastPosition(currentPos);
        
        setLiveTrackingBox(finalBox); // Use smoothed box for rendering
        setBoxTimestamp(selectedTimestamp);
        setTimeDelta(selectedTimeDelta);
        
        if (showDebugOverlay) {
          console.log(`📦 SPOTLIGHT: FINAL_SOURCE "${selectedSource}" coords=(${finalBox.x.toFixed(3)}, ${finalBox.y.toFixed(3)}) timeDelta=${selectedTimeDelta.toFixed(3)} ${smoothedResult ? '(smoothed)' : '(raw)'}`);
        }
      } else {
        setLiveTrackingBox(null);
        setBoxTimestamp(null);
        setTimeDelta(null);
        setLastPosition(null); // Clear position tracking when no box available
      }
    } else {
      setLiveTrackingBox(null);
      setBoxTimestamp(null);
      setTimeDelta(null);
      setCurrentSource(null);
      setSourceLockedUntil(0);
      setLastPosition(null); // Clear position tracking when no player selected
    }
  }, [selectedPlayerId, sampleTime, getBoxByIdAtTime, currentSource, sourceLockedUntil, serverLockUsed, serverHoldActive, getCanonicalAnchorBox, isManuallySelected, detectionTime, realVideoTime]);
  
  // **SINGLE SOURCE OF TRUTH**: Use liveTrackingBox for both HUD and renderer gating
  const hasValidBoxForSelected = Boolean(liveTrackingBox); // ID-lookup already guarantees identity
  
  // **ARCHITECT FIX**: Respect detectionTime strictly - no manual bypass
  // Only activate when video time reaches the selection moment, or if selection was made at current time
  const currentVideoTime = realVideoTime;
  const shouldActivateByTime = detectionTime == null || (currentVideoTime + TIME_EPSILON >= detectionTime);
  
  // **FINAL GATING WITH PREREQUISITES**: Must have valid prerequisites and proper timing
  const isSpotlightActive = requireReady &&
    hasSelectedPlayer && 
    shouldActivateByTime && 
    hasValidBoxForSelected;
    
  const effectiveVisibility = isVisible && isSpotlightActive;
  
  // **LEGACY REFERENCES**: For compatibility with existing debug logs
  const canActivateByTime = shouldActivateByTime;
  const canActivateByManual = false; // No longer used - manual activation now respects timing
  
  // **CALCULATE OVERLAY POSITION**: Convert normalized coords to actual pixel coords
  const getVideoRenderBox = useCallback(() => {
    const video = videoRef.current;
    const container = svgContainerRef.current;
    if (!video || !container) return null;
    
    const containerRect = container.getBoundingClientRect();
    const videoAspect = video.videoWidth / video.videoHeight;
    const containerAspect = containerRect.width / containerRect.height;
    
    let renderWidth, renderHeight, renderX, renderY;
    if (videoAspect > containerAspect) {
      renderWidth = containerRect.width;
      renderHeight = containerRect.width / videoAspect;
      renderX = 0;
      renderY = (containerRect.height - renderHeight) / 2;
    } else {
      renderWidth = containerRect.height * videoAspect;
      renderHeight = containerRect.height;
      renderX = (containerRect.width - renderWidth) / 2;
      renderY = 0;
    }
    
    return { x: renderX, y: renderY, width: renderWidth, height: renderHeight };
  }, [videoRef]);
  
  const overlayPosPx = useMemo(() => {
    if (!liveTrackingBox) return { x: 0, y: 0 };
    
    const renderBox = getVideoRenderBox();
    if (!renderBox) return { x: 0, y: 0 };
    
    const centerX = liveTrackingBox.x + liveTrackingBox.width / 2;
    const centerY = liveTrackingBox.y + liveTrackingBox.height / 2;
    
    return {
      x: Math.round(renderBox.x + centerX * renderBox.width),
      y: Math.round(renderBox.y + centerY * renderBox.height)
    };
  }, [liveTrackingBox, getVideoRenderBox]);
  
  // **POSITION MOVEMENT TRACKING**: Track frame-to-frame movement
  const [lastOverlayPos, setLastOverlayPos] = useState({ x: 0, y: 0 });
  const [frameUpdateCount, setFrameUpdateCount] = useState(0);
  const [lastUpdateFrameId, setLastUpdateFrameId] = useState(0);
  
  // **DIAGNOSTIC FLAGS**: Track position source for debugging
  const usingManualAnchor = !hasValidBoxForSelected && selectedPlayerId != null;
  const usingFreeze = selectedPlayerId != null && !hasValidBoxForSelected; // Active when player ID missing
  const usingLiveBox = hasValidBoxForSelected && Boolean(liveTrackingBox);
  
  // **CALCULATE MOVEMENT DELTA**: Track position changes per frame
  const deltaPosPx = useMemo(() => {
    const dx = overlayPosPx.x - lastOverlayPos.x;
    const dy = overlayPosPx.y - lastOverlayPos.y;
    return {
      dx: Math.round(dx),
      dy: Math.round(dy),
      magnitude: Math.round(Math.sqrt(dx * dx + dy * dy))
    };
  }, [overlayPosPx, lastOverlayPos]);
  
  // **NORMALIZED BOX CENTER**: Extract center coordinates from liveTrackingBox
  const boxCenterNorm = useMemo(() => {
    if (!liveTrackingBox) return { x: 0, y: 0 };
    return {
      x: parseFloat((liveTrackingBox.x + liveTrackingBox.width / 2).toFixed(6)),
      y: parseFloat((liveTrackingBox.y + liveTrackingBox.height / 2).toFixed(6))
    };
  }, [liveTrackingBox]);
  
  // **UPDATE VERIFICATION HUD**: Keep all fields current with required fields
  useEffect(() => {
    // Update position tracking
    if (overlayPosPx.x !== lastOverlayPos.x || overlayPosPx.y !== lastOverlayPos.y) {
      setLastOverlayPos(overlayPosPx);
      setFrameUpdateCount(prev => prev + 1);
      setLastUpdateFrameId(Date.now());
    }
    
    setVerificationHudData(prev => ({
      ...prev,
      sampleTime,
      selectedActivationTime: detectionTime || null,
      selectedPlayerId: selectedPlayerId || null,
      trackingBoxId: liveTrackingBox?.id || null,
      idMatch: (selectedPlayerId || null) === (liveTrackingBox?.id || null),
      boxTimestamp,
      timeDelta,
      boxTimestampDiff: boxTimestamp !== null && sampleTime !== null ? Math.abs(boxTimestamp - sampleTime) : null,
      
      // **REQUIRED POSITION FIELDS**
      boxCenterNorm,
      overlayPosPx,
      deltaPosPx,
      lastUpdateFrameId,
      frameUpdateCount,
      
      // **REQUIRED DIAGNOSTIC FLAGS**
      usingManualAnchor,
      usingFreeze,
      usingLiveBox,
      
      hasValidBoxForSelected,
      framesSinceLastValid: 0, // Will be wired when freeze logic implemented
      freezeActive: usingFreeze,
      finalIsSpotlightActive: isSpotlightActive
    }));
  }, [sampleTime, detectionTime, selectedPlayerId, liveTrackingBox?.id, boxTimestamp, timeDelta, hasValidBoxForSelected, isSpotlightActive, overlayPosPx, boxCenterNorm, deltaPosPx, lastUpdateFrameId, frameUpdateCount, usingManualAnchor, usingFreeze, usingLiveBox]);

  // **SINGLE SOURCE ASSERTION**: Compare HUD display against actual renderer usage  
  const rendererWillRender = effectiveVisibility; // What renderer actually uses
  const hudDisplaysActive = isSpotlightActive; // What HUD displays
  if (hudDisplaysActive !== rendererWillRender) {
    console.error('🚨 SINGLE SOURCE VIOLATION: HUD and renderer states differ!', {
      hudDisplaysActive, rendererWillRender, selectedPlayerId, sampleTime: sampleTime.toFixed(3),
      requireReady, hasSelectedPlayer, canActivateByTime, canActivateByManual, hasValidBoxForSelected
    });
  }

  // **ENHANCED TIMEBASE AUDIT**: Comprehensive per-frame debug state for timebase verification
  const [debugOverlayData, setDebugOverlayData] = useState<{
    // **SELECTION & GATING**
    selectedPlayerId: string;
    hasSelectedPlayer: boolean;
    isManuallySelected: boolean;
    isTimeActivated: boolean;
    isActivationConditionMet: boolean;
    hasValidBoxForSelected: boolean;
    isSpotlightActive: boolean;
    finalBooleanExpression: string;
    // **TIMEBASE AUDIT FIELDS**
    currentVideoTime: number;
    clipStartOffset: number;
    sampleTime: number;
    selectedActivationTime: number | null;
    trackingBoxId: string | null;
    boxTimestamp: number | null;
    // **FREEZE & VALIDITY**
    freezeActive: boolean;
    framesSinceLastValid: number;
    // **COORDINATE DATA**
    rawDetectorBox: { x: number; y: number; width: number; height: number } | null;
    transformedOverlayBox: { x: number; y: number; width: number; height: number } | null;
    videoRect: { x: number; y: number; width: number; height: number } | null;
    canvasRect: { x: number; y: number; width: number; height: number } | null;
    devicePixelRatio: number;
    frameCount: number;
    lastUpdateTime: number;
    coordinateMatrix: string;
  } | null>(null);

  // **DEBUG**: Log activation state changes with enhanced instrumentation
  useEffect(() => {
    console.log('🎯 SPOTLIGHT ACTIVATION STATE (SELECTION-DRIVEN):', {
      // **SELECTION-DRIVEN COMPONENTS**:
      selectedPlayerId: selectedPlayerId || 'null',
      hasSelectedPlayer,
      isManuallySelected,
      currentVideoTime: currentVideoTimeRef.current.toFixed(3),
      detectionTime: detectionTime?.toFixed(3) || 'undefined',
      isTimeActivated: canActivateByTime,
      isActivationConditionMet: canActivateByTime || canActivateByManual,
      hasValidBoxForSelected,
      trackingBoxId: liveTrackingBox?.id || 'null',
      // **FINAL RESULTS**:
      isSpotlightActive,
      effectiveVisibility,
      // **BOOLEAN EXPRESSION**: Show the exact final expression for verification
      finalExpression: `(${hasSelectedPlayer}) && (${canActivateByTime || canActivateByManual}) && (${hasValidBoxForSelected}) = ${isSpotlightActive}`,
      liveTrackingBoxCoords: liveTrackingBox ? `(${liveTrackingBox.x.toFixed(3)}, ${liveTrackingBox.y.toFixed(3)})` : null
    });
  }, [detectionTime, selectedPlayerId, hasSelectedPlayer, canActivateByTime, canActivateByManual, hasValidBoxForSelected, isSpotlightActive, effectiveVisibility, liveTrackingBox]);

  // **LIFECYCLE EVENT HANDLING**: Set videoReady on proper events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateVideoReady = () => {
      const isReady = video.readyState >= 2; // HAVE_CURRENT_DATA or higher
      setVerificationHudData(prev => ({ 
        ...prev, 
        videoReady: isReady,
        currentVideoTime: video.currentTime,
        lastErrorMessage: isReady ? null : prev.lastErrorMessage
      }));
      currentVideoTimeRef.current = video.currentTime;
      isVideoPlayingRef.current = !video.paused;
      
      // **TRIGGER PREREQUISITE VALIDATION**
      if (isReady) {
        validatePrerequisites();
      }
    };

    const handleRafControl = () => {
      const isPlaying = !video.paused && !video.ended;
      if (isPlaying && verificationHudData.prerequisitesValid) {
        // Start rAF on play if prerequisites are valid
        setVerificationHudData(prev => ({ ...prev, rAFStarted: true }));
      } else {
        // Stop rAF on pause/ended
        setVerificationHudData(prev => ({ ...prev, rAFStarted: false }));
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      }
    };

    // Initial state
    updateVideoReady();

    // **LIFECYCLE EVENTS**: Set videoReady on metadata/canplay
    video.addEventListener('loadedmetadata', updateVideoReady);
    video.addEventListener('canplay', updateVideoReady);
    video.addEventListener('timeupdate', updateVideoReady);
    
    // **RAF CONTROL EVENTS**: Start/stop rAF based on playback state
    video.addEventListener('play', handleRafControl);
    video.addEventListener('pause', handleRafControl);
    video.addEventListener('ended', handleRafControl);

    return () => {
      video.removeEventListener('loadedmetadata', updateVideoReady);
      video.removeEventListener('canplay', updateVideoReady);
      video.removeEventListener('timeupdate', updateVideoReady);
      video.removeEventListener('play', handleRafControl);
      video.removeEventListener('pause', handleRafControl);
      video.removeEventListener('ended', handleRafControl);
    };
  }, [videoRef, verificationHudData.prerequisitesValid]);

  // **CRITICAL**: Add comprehensive mount/unmount logging  
  useEffect(() => {
    console.log('🚀🚀🚀 SpotlightOverlay COMPONENT MOUNTED 🚀🚀🚀:', {
      props: {
        effect,
        settings,
        className,
        isVisible,
        hasLiveTrackingBox: !!liveTrackingBox,
        liveTrackingBox: liveTrackingBox ? {
          x: liveTrackingBox.x.toFixed(3),
          y: liveTrackingBox.y.toFixed(3),
          width: liveTrackingBox.width.toFixed(3),
          height: liveTrackingBox.height.toFixed(3)
        } : null
      },
      videoRef: !!videoRef.current,
      videoElement: videoRef.current ? {
        src: videoRef.current.src ? videoRef.current.src.slice(-30) : 'NO_SOURCE',
        videoWidth: videoRef.current.videoWidth,
        videoHeight: videoRef.current.videoHeight,
        readyState: videoRef.current.readyState
      } : null,
      timestamp: Date.now()
    });
    
    // Mark effects as mounted
    setVerificationHudData(prev => ({ ...prev, effectsMounted: true }));

    return () => {
      console.log('💀💀💀 SpotlightOverlay COMPONENT UNMOUNTING 💀💀💀:', {
        timestamp: Date.now()
      });
      // Clean up any running rAF
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setVerificationHudData(prev => ({ 
        ...prev, 
        effectsMounted: false,
        rAFStarted: false 
      }));
    };
  }, []); // Empty deps = mount/unmount only

  // **CRITICAL UI BINDING DEBUG**: Track trackingBox prop changes
  const prevLiveTrackingBoxRef = useRef<typeof liveTrackingBox>(null);
  useEffect(() => {
    if (liveTrackingBox !== prevLiveTrackingBoxRef.current) {
      const prev = prevLiveTrackingBoxRef.current;
      console.log('📍📍📍 SpotlightOverlay: liveTrackingBox STATE CHANGED 📍📍📍:', {
        prevLiveTrackingBox: prev ? {
          x: prev.x.toFixed(3),
          y: prev.y.toFixed(3),
          width: prev.width.toFixed(3),
          height: prev.height.toFixed(3)
        } : null,
        newLiveTrackingBox: liveTrackingBox ? {
          x: liveTrackingBox.x.toFixed(3),
          y: liveTrackingBox.y.toFixed(3),
          width: liveTrackingBox.width.toFixed(3),
          height: liveTrackingBox.height.toFixed(3)
        } : null,
        hasChanged: !!liveTrackingBox !== !!prev || 
                   (liveTrackingBox && prev && (
                     Math.abs(liveTrackingBox.x - prev.x) > 0.001 ||
                     Math.abs(liveTrackingBox.y - prev.y) > 0.001 ||
                     Math.abs(liveTrackingBox.width - prev.width) > 0.001 ||
                     Math.abs(liveTrackingBox.height - prev.height) > 0.001
                   )),
        coordinateDelta: liveTrackingBox && prev ? {
          deltaX: (liveTrackingBox.x - prev.x).toFixed(4),
          deltaY: (liveTrackingBox.y - prev.y).toFixed(4),
          deltaWidth: (liveTrackingBox.width - prev.width).toFixed(4),
          deltaHeight: (liveTrackingBox.height - prev.height).toFixed(4)
        } : 'N/A',
        renderWillTrigger: effectiveVisibility && !!liveTrackingBox,
        timestamp: Date.now()
      });
      prevLiveTrackingBoxRef.current = liveTrackingBox;
    }
  }, [liveTrackingBox, isVisible]);


  // **MANDATORY INSTRUMENTATION**: Update per-frame debug data
  const updateDebugInstrumentation = useCallback((
    rawBox: { x: number; y: number; width: number; height: number } | null,
    transformedBox: { x: number; y: number; width: number; height: number } | null,
    videoRenderBox: VideoRenderBox | null,
    svgContainer: HTMLDivElement | null,
    sampleTime?: number,
    currentVideoTime?: number
  ) => {
    if (!showDebugOverlay) return;
    
    const video = videoRef.current;
    
    // **🚨 LIVE TIMEBASE**: Use passed timebase or fall back to video.currentTime
    const clipStartOffset = 0; // TODO: Get from clip metadata if available
    const realCurrentVideoTime = currentVideoTime ?? (video ? video.currentTime : 0);
    const liveSampleTime = sampleTime ?? (realCurrentVideoTime + clipStartOffset);
    
    // **FREEZE STATUS**: Detect if tracker is frozen on stale coordinates
    const freezeActive = liveTrackingBox ? false : false; // TODO: Get from tracker freeze state
    const framesSinceLastValid = 0; // TODO: Get from tracker state
    
    setDebugOverlayData({
      // **SELECTION & GATING**
      selectedPlayerId: selectedPlayerId || 'none',
      hasSelectedPlayer,
      isManuallySelected: false, // **RESET**: Timeline state no longer leaks
      isTimeActivated: canActivateByTime,
      isActivationConditionMet: canActivateByTime || canActivateByManual,
      hasValidBoxForSelected,
      isSpotlightActive,
      finalBooleanExpression: `(${hasSelectedPlayer}) && (${canActivateByTime || canActivateByManual}) && (${hasValidBoxForSelected}) = ${isSpotlightActive}`,
      // **TIMEBASE AUDIT FIELDS**
      currentVideoTime: realCurrentVideoTime,
      clipStartOffset,
      sampleTime: liveSampleTime,
      selectedActivationTime: detectionTime || null,
      trackingBoxId: liveTrackingBox?.id || null,
      boxTimestamp: liveSampleTime, // TODO: Get actual box timestamp from detection
      // **FREEZE & VALIDITY**
      freezeActive,
      framesSinceLastValid,
      // **COORDINATE DATA**
      rawDetectorBox: rawBox,
      transformedOverlayBox: transformedBox,
      videoRect: videoRenderBox,
      canvasRect: svgContainer ? {
        x: 0,
        y: 0, 
        width: svgContainer.clientWidth,
        height: svgContainer.clientHeight
      } : null,
      devicePixelRatio: window.devicePixelRatio,
      frameCount: Date.now(), // Simplified frame counter
      lastUpdateTime: Date.now(),
      coordinateMatrix: video ? `video(${video.videoWidth}x${video.videoHeight}) -> container(${svgContainer?.clientWidth || 0}x${svgContainer?.clientHeight || 0})` : 'no_video'
    });
  }, [showDebugOverlay, selectedPlayerId, hasSelectedPlayer, canActivateByTime, canActivateByManual, hasValidBoxForSelected, isSpotlightActive, liveTrackingBox, detectionTime]);

  // **SPOTLIGHT RENDERING**: Enhanced with coordinate tracking and debug instrumentation
  // Now uses shared effect renderer for consistency with full audit trail

  /**
   * **DEBUG OVERLAY VISUALIZATION**: Create comprehensive debugging elements
   * Shows tracked bounding box, center crosshair, coordinates, and status indicators
   */
  const createDebugOverlay = useCallback((
    containerWidth: number,
    containerHeight: number,
    pixelCenterX: number,
    pixelCenterY: number,
    trackingBoxPixels: { width: number; height: number },
    normalizedBox: { x: number; y: number; width: number; height: number },
    originalBox: { x: number; y: number; width: number; height: number; id?: string; confidence?: number },
    renderBox: VideoRenderBox,
    selectedPlayerId?: string,
    isManuallySelected?: boolean,
    video?: HTMLVideoElement
  ): SVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', containerWidth.toString());
    svg.setAttribute('height', containerHeight.toString());
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '100'; // Above spotlight effect

    // **DEBUG COLOR CODING**: Determine debug colors based on confidence and ID-lock status
    const confidence = originalBox.confidence || 0;
    const hasId = !!originalBox.id;
    const isIdLocked = hasId && selectedPlayerId === originalBox.id;
    const isHighConfidence = confidence >= 0.7;
    
    let borderColor: string;
    let centerColor: string;
    let labelBgColor: string;
    
    if (isIdLocked) {
      borderColor = '#00ff00'; // Green - ID locked
      centerColor = '#00ff00';
      labelBgColor = '#00ff0080';
    } else if (isManuallySelected) {
      borderColor = '#ffaa00'; // Orange - Manual mode
      centerColor = '#ffaa00';
      labelBgColor = '#ffaa0080';
    } else if (isHighConfidence) {
      borderColor = '#0088ff'; // Blue - High confidence
      centerColor = '#0088ff';
      labelBgColor = '#0088ff80';
    } else {
      borderColor = '#ff4444'; // Red - Low confidence
      centerColor = '#ff4444';
      labelBgColor = '#ff444480';
    }

    // **1. TRACKED BOUNDING BOX OUTLINE**: Draw bounding box with adaptive stroke width
    const strokeWidth = Math.max(2, Math.min(4, containerWidth / 400)); // Scale with container size
    const boundingBoxRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    boundingBoxRect.setAttribute('x', (pixelCenterX - trackingBoxPixels.width / 2).toString());
    boundingBoxRect.setAttribute('y', (pixelCenterY - trackingBoxPixels.height / 2).toString());
    boundingBoxRect.setAttribute('width', trackingBoxPixels.width.toString());
    boundingBoxRect.setAttribute('height', trackingBoxPixels.height.toString());
    boundingBoxRect.setAttribute('fill', 'none');
    boundingBoxRect.setAttribute('stroke', borderColor);
    boundingBoxRect.setAttribute('stroke-width', strokeWidth.toString());
    boundingBoxRect.setAttribute('stroke-dasharray', isIdLocked ? '0' : '8,4');
    svg.appendChild(boundingBoxRect);

    // **2. CENTER POINT CROSSHAIR**: Show exact center with crosshair
    const crosshairSize = Math.max(10, Math.min(20, containerWidth / 80));
    const crosshairGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    // Horizontal line
    const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hLine.setAttribute('x1', (pixelCenterX - crosshairSize).toString());
    hLine.setAttribute('y1', pixelCenterY.toString());
    hLine.setAttribute('x2', (pixelCenterX + crosshairSize).toString());
    hLine.setAttribute('y2', pixelCenterY.toString());
    hLine.setAttribute('stroke', centerColor);
    hLine.setAttribute('stroke-width', (strokeWidth * 1.5).toString());
    crosshairGroup.appendChild(hLine);
    
    // Vertical line
    const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    vLine.setAttribute('x1', pixelCenterX.toString());
    vLine.setAttribute('y1', (pixelCenterY - crosshairSize).toString());
    vLine.setAttribute('x2', pixelCenterX.toString());
    vLine.setAttribute('y2', (pixelCenterY + crosshairSize).toString());
    vLine.setAttribute('stroke', centerColor);
    vLine.setAttribute('stroke-width', (strokeWidth * 1.5).toString());
    crosshairGroup.appendChild(vLine);
    
    // Center dot
    const centerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerDot.setAttribute('cx', pixelCenterX.toString());
    centerDot.setAttribute('cy', pixelCenterY.toString());
    centerDot.setAttribute('r', (strokeWidth * 1.5).toString());
    centerDot.setAttribute('fill', centerColor);
    crosshairGroup.appendChild(centerDot);
    
    svg.appendChild(crosshairGroup);

    // **3. PLAYER ID LABEL**: Show selected player ID with status
    const fontSize = Math.max(12, Math.min(16, containerWidth / 80));
    const labelText = selectedPlayerId 
      ? `ID: ${selectedPlayerId}${isIdLocked ? ' (LOCKED)' : ''}${isManuallySelected ? ' (MANUAL)' : ''}`
      : `ID: ${originalBox.id || 'N/A'}${isManuallySelected ? ' (MANUAL)' : ''}`;
    
    const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    // Label background
    const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const labelWidth = labelText.length * fontSize * 0.6;
    const labelHeight = fontSize + 8;
    labelBg.setAttribute('x', (pixelCenterX - labelWidth / 2).toString());
    labelBg.setAttribute('y', (pixelCenterY - trackingBoxPixels.height / 2 - labelHeight - 5).toString());
    labelBg.setAttribute('width', labelWidth.toString());
    labelBg.setAttribute('height', labelHeight.toString());
    labelBg.setAttribute('fill', labelBgColor);
    labelBg.setAttribute('rx', '4');
    labelGroup.appendChild(labelBg);
    
    // Label text
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', pixelCenterX.toString());
    label.setAttribute('y', (pixelCenterY - trackingBoxPixels.height / 2 - 8).toString());
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#ffffff');
    label.setAttribute('font-family', 'monospace');
    label.setAttribute('font-size', fontSize.toString());
    label.setAttribute('font-weight', 'bold');
    label.textContent = labelText;
    labelGroup.appendChild(label);
    
    svg.appendChild(labelGroup);

    // **4. COORDINATE INFORMATION**: Show raw vs transformed coordinates
    const coordInfoGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const coordInfoLines = [
      `Raw: (${originalBox.x.toFixed(3)}, ${originalBox.y.toFixed(3)})`,
      `Norm: (${normalizedBox.x.toFixed(3)}, ${normalizedBox.y.toFixed(3)})`,
      `Pixel: (${pixelCenterX.toFixed(1)}, ${pixelCenterY.toFixed(1)})`,
      `Conf: ${(confidence * 100).toFixed(1)}%`,
      `Video: ${video?.videoWidth || 0}×${video?.videoHeight || 0}`,
      `Render: ${renderBox.width.toFixed(0)}×${renderBox.height.toFixed(0)}`
    ];
    
    const infoStartY = pixelCenterY + trackingBoxPixels.height / 2 + 20;
    coordInfoLines.forEach((line, index) => {
      const infoText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      infoText.setAttribute('x', (pixelCenterX + trackingBoxPixels.width / 2 + 10).toString());
      infoText.setAttribute('y', (infoStartY + index * (fontSize + 2)).toString());
      infoText.setAttribute('fill', borderColor);
      infoText.setAttribute('font-family', 'monospace');
      infoText.setAttribute('font-size', (fontSize * 0.8).toString());
      infoText.setAttribute('font-weight', 'normal');
      infoText.textContent = line;
      coordInfoGroup.appendChild(infoText);
    });
    
    svg.appendChild(coordInfoGroup);

    return svg;
  }, []);

  /**
   * **RENDER LOOP**: Main SVG rendering function
   * Performance optimized: Only runs when video is playing and page is visible
   * Returns boolean indicating if render was successful
   */
  const render = useCallback((): boolean => {
    const svgContainer = svgContainerRef.current;
    const video = videoRef.current;
    
    console.log('🎭 SpotlightOverlay render() CALLED:', {
      hasSvgContainer: !!svgContainer,
      hasVideo: !!video,
      videoWidth: video?.videoWidth || 'N/A',
      videoHeight: video?.videoHeight || 'N/A',
      hasLiveTrackingBox: !!liveTrackingBox,
      liveTrackingBox,
      isVisible,
      effect,
      timestamp: Date.now()
    });
    
    // Stop RAF if elements not ready
    if (!svgContainer || !video) {
      console.log('❌ SpotlightOverlay early exit: missing elements', {
        reason: !svgContainer ? 'no svgContainer' : 'no video',
        svgContainer: !!svgContainer,
        video: !!video
      });
      return false;
    }
    
    // Wait for video metadata to load
    if (!video.videoWidth || !video.videoHeight) {
      console.log('❌ SpotlightOverlay early exit: video dimensions not ready', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        reason: 'zero video dimensions'
      });
      return false;
    }
    
    // **PREREQUISITE GATE**: Early return if overlay shouldn't render at all
    if (!effectiveVisibility) {
      // Overlay is already gated at component level, this should not execute
      console.log('🧹 SpotlightOverlay: Early exit - not effective visible');
      return false; // Don't render anything
    }
    
    // Clear container when no tracking box (but overlay is still visible)
    if (!liveTrackingBox) {
      console.log('🧹 SpotlightOverlay clearing container:', {
        reason: 'no liveTrackingBox',
        effectiveVisibility,
        isVisible,
        hasLiveTrackingBox: !!liveTrackingBox
      });
      svgContainer.innerHTML = '';
      return true; // Successfully cleared
    }
    
    // **COORDINATE CONVERSION**: Handle both percentage (0-100) and normalized (0-1) coordinates
    const renderBox = getVideoRenderBox();
    if (!renderBox) {
      console.log('❌ SpotlightOverlay early exit: getVideoRenderBox returned null', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        videoRect: video.getBoundingClientRect(),
        svgContainerRect: svgContainer.getBoundingClientRect(),
        reason: 'getVideoRenderBox failed'
      });
      return false; // Video not ready for rendering
    }
    
    console.log('📐 SpotlightOverlay renderBox computed:', {
      renderBox,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      containerRect: svgContainer.getBoundingClientRect()
    });
    
    // **INTERIM SAFEGUARDS**: Normalize and clamp liveTrackingBox coordinates
    const needsNormalization = liveTrackingBox.x > 1 || liveTrackingBox.y > 1 || liveTrackingBox.width > 1 || liveTrackingBox.height > 1;
    
    // **COORDINATE CLAMPING**: Ensure coordinates stay within [0,1] bounds to prevent off-screen rendering
    let normalizedBox = needsNormalization ? {
      x: liveTrackingBox.x / 100,
      y: liveTrackingBox.y / 100, 
      width: liveTrackingBox.width / 100,
      height: liveTrackingBox.height / 100
    } : { ...liveTrackingBox };
    
    // **CRITICAL SAFEGUARD**: Clamp all coordinates to valid [0,1] range
    normalizedBox = {
      x: Math.max(0, Math.min(1 - normalizedBox.width, normalizedBox.x)), // Prevent right edge overflow
      y: Math.max(0, Math.min(1 - normalizedBox.height, normalizedBox.y)), // Prevent bottom edge overflow
      width: Math.max(0.01, Math.min(1, normalizedBox.width)), // Minimum 1% width, max 100%
      height: Math.max(0.01, Math.min(1, normalizedBox.height)) // Minimum 1% height, max 100%
    };
    
    // **CONSISTENT ORIGIN HANDLING**: Always use TOP-LEFT as single source of truth
    // Convert normalized TOP-LEFT coordinates to pixel space within video content rect
    const pixelTopLeftX = renderBox.x + (normalizedBox.x * renderBox.width);
    const pixelTopLeftY = renderBox.y + (normalizedBox.y * renderBox.height);
    
    // **CLAMP TO VIDEO CONTENT RECT**: Ensure spotlight stays within actual video area
    const clampedPixelX = Math.max(renderBox.x, Math.min(renderBox.x + renderBox.width - (normalizedBox.width * renderBox.width), pixelTopLeftX));
    const clampedPixelY = Math.max(renderBox.y, Math.min(renderBox.y + renderBox.height - (normalizedBox.height * renderBox.height), pixelTopLeftY));
    
    // Calculate pixel center from clamped top-left for effect rendering
    const pixelCenterX = clampedPixelX + ((normalizedBox.width * renderBox.width) / 2);
    const pixelCenterY = clampedPixelY + ((normalizedBox.height * renderBox.height) / 2);
    
    // Calculate actual trackingBox pixel dimensions using normalized coordinates
    const trackingBoxPixels = {
      width: normalizedBox.width * renderBox.width,
      height: normalizedBox.height * renderBox.height
    };
    
    // Get container dimensions for SVG rendering
    const containerRect = svgContainer.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    // Generate SVG effect using the SVG renderer
    const svgElement = renderSpotlightEffectSvg(
      containerWidth,
      containerHeight,
      pixelCenterX,
      pixelCenterY,
      effect,
      settings,
      trackingBoxPixels
    );
    
    // **MANDATORY INSTRUMENTATION UPDATE**: Track coordinate transformations
    updateDebugInstrumentation(
      liveTrackingBox, // Raw detector box (normalized)
      { x: pixelCenterX - trackingBoxPixels.width/2, y: pixelCenterY - trackingBoxPixels.height/2, 
        width: trackingBoxPixels.width, height: trackingBoxPixels.height }, // Transformed overlay box (pixels)
      renderBox, // Video render area
      svgContainer // Canvas container
    );

    // Clear previous SVG and insert new one
    svgContainer.innerHTML = '';
    svgContainer.appendChild(svgElement);
    
    // **DEBUG OVERLAY VISUALIZATION**: Add comprehensive debugging elements
    if (showDebugOverlay && liveTrackingBox) {
      const debugOverlay = createDebugOverlay(
        containerWidth,
        containerHeight,
        pixelCenterX,
        pixelCenterY,
        trackingBoxPixels,
        normalizedBox,
        liveTrackingBox,
        renderBox,
        selectedPlayerId,
        isManuallySelected,
        video
      );
      svgContainer.appendChild(debugOverlay);
    }
    
    console.log('✨ SVG EFFECT RENDERED:', {
      effect,
      centerX: pixelCenterX.toFixed(1),
      centerY: pixelCenterY.toFixed(1),
      containerSize: `${containerWidth}×${containerHeight}`,
      liveTrackingBox: {
        original: liveTrackingBox,
        normalized: normalizedBox,
        pixels: { centerX: pixelCenterX, centerY: pixelCenterY }
      },
      renderBox,
      svgElementCreated: !!svgElement,
      debugOverlayEnabled: showDebugOverlay,
      timestamp: Date.now()
    });
    
    return true; // Successfully rendered
  }, [videoRef, liveTrackingBox, effect, settings, isVisible, effectiveVisibility, hasSelectedPlayer, canActivateByTime, canActivateByManual, hasValidBoxForSelected, getVideoRenderBox]);

  /**
   * **RENDERING RESILIENCE**: Enhanced render trigger with micro-movement detection
   * Ensures smooth rendering even with tiny coordinate changes
   */
  const renderIfNeeded = useCallback((sampleTime?: number, currentVideoTime?: number) => {
    const video = videoRef.current;
    const svgContainer = svgContainerRef.current;
    
    // **RESILIENCE FIX**: High precision fingerprint WITHOUT timestamps (to avoid over-rendering)
    const renderData = JSON.stringify({
      hasLiveTrackingBox: !!liveTrackingBox,
      videoReady: Boolean(video?.videoWidth && video?.videoHeight),
      containerReady: !!svgContainer,
      liveTrackingBox: liveTrackingBox ? {
        x: liveTrackingBox.x.toFixed(6), // **INCREASED PRECISION** for micro-movements
        y: liveTrackingBox.y.toFixed(6),
        width: liveTrackingBox.width.toFixed(6),
        height: liveTrackingBox.height.toFixed(6)
      } : null,
      effect,
      settings,
      isVisible: effectiveVisibility // Use computed visibility
      // **PERFORMANCE FIX**: Removed timestamp to prevent forced per-frame renders
    });
    
    // **RESILIENCE FIX**: Epsilon-based change detection for tiny movements using liveTrackingBox
    const hasTrackingBoxChanged = liveTrackingBox && lastRenderDataRef.current ? (() => {
      try {
        const lastData = JSON.parse(lastRenderDataRef.current);
        const lastBox = lastData.liveTrackingBox;
        if (!lastBox) return true;
        
        // Detect changes smaller than normal precision would catch
        const EPSILON = 0.0001; // Sub-pixel precision for ultra-smooth tracking
        return Math.abs(liveTrackingBox.x - parseFloat(lastBox.x)) > EPSILON ||
               Math.abs(liveTrackingBox.y - parseFloat(lastBox.y)) > EPSILON ||
               Math.abs(liveTrackingBox.width - parseFloat(lastBox.width)) > EPSILON ||
               Math.abs(liveTrackingBox.height - parseFloat(lastBox.height)) > EPSILON;
      } catch {
        return true; // Force render on parse error
      }
    })() : true;
    
    // Force render on data change OR micro-movements
    if (renderData !== lastRenderDataRef.current || hasTrackingBoxChanged) {
      const didRender = render();
      
      // **CRITICAL FIX**: Only update fingerprint after successful render
      if (didRender) {
        lastRenderDataRef.current = renderData;
      }
    }
  }, [render, liveTrackingBox, effect, settings, isVisible, effectiveVisibility]);

  /**
   * **RENDERING RESILIENCE RAF**: Continuous animation loop with enhanced smoothness
   * Guarantees smooth rendering even with tiny coordinate changes
   */
  const startRenderLoop = useCallback(() => {
    if (animationFrameRef.current) {
      console.log('🔄 SpotlightOverlay: RAF loop already running');
      return; // Already running
    }
    
    console.log('🚀 SpotlightOverlay: Starting ENHANCED RAF loop with LIVE TIMEBASE');
    
    const loop = () => {
      // **🚨 CRITICAL TIMEBASE FIX**: Read video.currentTime directly each frame
      const video = videoRef.current;
      const currentVideoTime = video ? video.currentTime : 0;
      const clipStartOffset = 0; // TODO: Get from clip metadata if available
      const sampleTime = currentVideoTime + clipStartOffset;
      
      // **PER-FRAME ID LOOKUP**: Use live tracking box from main gating logic
      // (liveTrackingBox is computed above in main gating section)
      
      // **TIMEBASE ADVANCEMENT CHECK**: Detect if video time is advancing during playback
      const lastVideoTime = lastVideoTimeRef.current || 0;
      const timeAdvancing = !video?.paused && Math.abs(currentVideoTime - lastVideoTime) > 0.001;
      lastVideoTimeRef.current = currentVideoTime;
      
      // **REGRESSION FIX**: Assert sampleTime increases while playing; skip draw if stuck
      if (!video?.paused && !timeAdvancing && currentVideoTime === lastVideoTime && frameCountRef.current > 30) {
        console.error('🚨 TIMEBASE STUCK: sampleTime not advancing during playback - skipping draw', {
          currentVideoTime: currentVideoTime.toFixed(3),
          lastVideoTime: lastVideoTime.toFixed(3),
          isPaused: video?.paused,
          frame: frameCountRef.current
        });
        animationFrameRef.current = requestAnimationFrame(loop);
        return; // Skip draw when timebase is stuck
      }
      
      // **RESILIENCE FIX**: More granular rendering conditions  
      const hasActiveTracking = !!liveTrackingBox;
      const isPageActive = isPageVisible;
      const shouldAttemptRender = isPageActive && effectiveVisibility;
      
      // **ENHANCED LOGGING**: Show timebase advancement every 30 frames (~1 second at 30fps)
      if (frameCountRef.current % 30 === 0) {
        console.log('⏰ RAF TIMEBASE CHECK:', {
          currentVideoTime: currentVideoTime.toFixed(3),
          sampleTime: sampleTime.toFixed(3),
          timeAdvancing,
          isPaused: video?.paused,
          hasActiveTracking,
          trackingBoxSample: liveTrackingBox ? `(${liveTrackingBox.x.toFixed(3)}, ${liveTrackingBox.y.toFixed(3)})` : null,
          frame: frameCountRef.current
        });
      }
      frameCountRef.current = (frameCountRef.current || 0) + 1;
      
      // **PERFORMANCE FIX**: Optimized rendering logic to avoid unnecessary work
      if (shouldAttemptRender) {
        // **🚨 CRITICAL FIX**: Pass live timebase to render function
        renderIfNeeded(sampleTime, currentVideoTime);
      } else if (hasActiveTracking && !isPageActive) {
        // Page hidden - preserve state but don't render
      } else {
        // **PERFORMANCE FIX**: Clear container only once when state changes, not every frame
        const svgContainer = svgContainerRef.current;
        if (svgContainer && svgContainer.innerHTML !== '') {
          console.log('🧹 SpotlightOverlay: Clearing idle overlay (state change)');
          svgContainer.innerHTML = '';
        }
      }
      
      // **CONTINUOUS LOOP**: Always continue for maximum responsiveness
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    
    animationFrameRef.current = requestAnimationFrame(loop);
  }, [isPageVisible, effectiveVisibility, liveTrackingBox, renderIfNeeded]);

  const stopRenderLoop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Note: SVG container automatically sizes to match video container via CSS

  /**
   * **PAGE VISIBILITY API**: Pause tracking when tab is hidden
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  /**
   * **VIDEO STATE TRACKING**: Monitor play/pause state
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      console.log('🎬 SpotlightOverlay: Video PLAY event detected');
      isVideoPlayingRef.current = true;
    };
    const handlePause = () => {
      console.log('⏸️ SpotlightOverlay: Video PAUSE event detected');
      isVideoPlayingRef.current = false;
    };
    const handleEnded = () => {
      console.log('🏁 SpotlightOverlay: Video ENDED event detected');
      isVideoPlayingRef.current = false;
    };
    
    // Set initial state
    const initialPlaying = !video.paused && !video.ended;
    console.log('🎭 SpotlightOverlay: Video initial state:', {
      paused: video.paused,
      ended: video.ended,
      initialPlaying,
      currentTime: video.currentTime,
      duration: video.duration
    });
    isVideoPlayingRef.current = initialPlaying;
    
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoRef]);

  /**
   * **VIDEO READINESS**: Trigger render when video metadata loads
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      console.log('🎬 Video metadata loaded - dimensions:', { width: video.videoWidth, height: video.videoHeight });
      // Force fingerprint reset to trigger render
      lastRenderDataRef.current = '';
      renderIfNeeded();
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    
    // Also try immediate render if video is already ready
    if (video.videoWidth && video.videoHeight) {
      console.log('📹 Video already ready - forcing render');
      handleLoadedMetadata();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoRef, renderIfNeeded]);

  /**
   * **RENDER LOOP CONTROLLER**: Start/stop based on video and visibility state
   */
  useEffect(() => {
    console.log('🎮 RAF CONTROLLER useEffect triggered:', {
      isVisible,
      hasTrackingBox: !!liveTrackingBox,
      trackingBox: liveTrackingBox,
      willStartUnconditionally: true
    });

    // **ARCHITECT FIX**: Start RAF loop unconditionally on mount
    console.log('🚀 UNCONDITIONAL RAF START: Starting render loop regardless of conditions');
    startRenderLoop();
    
    return stopRenderLoop;
  }, [startRenderLoop, stopRenderLoop]);

  /**
   * **PROP CHANGE HANDLER**: Update overlay when trackingBox, effect, or settings change
   * This ensures the overlay updates even when video is paused
   */
  useEffect(() => {
    console.log('🎨 PROP CHANGE - calling renderIfNeeded');
    renderIfNeeded();
  }, [liveTrackingBox, effect, settings, renderIfNeeded]);



  /**
   * **SETUP LIFECYCLE**: Wait for elements and attach observers/listeners
   * Performance optimized: Removed excessive debug logging
   */
  useLayoutEffect(() => {
    console.log('🎬 SpotlightOverlay: useLayoutEffect MOUNTING - waiting for elements');
    let raf: number;
    let cleanupFns: Array<() => void> = [];
    
    const attach = () => {
      const video = videoRef.current;
      const svgContainer = svgContainerRef.current;
      
      console.log('🔍 SpotlightOverlay: Checking element availability:', {
        hasVideo: !!video,
        hasSvgContainer: !!svgContainer,
        videoReady: !!(video?.videoWidth && video?.videoHeight),
        attempt: 'waiting for both elements'
      });
      
      if (!video || !svgContainer) {
        raf = requestAnimationFrame(attach);
        return;
      }
      
      console.log('✅ SpotlightOverlay: SVG CONTAINER MOUNTED SUCCESSFULLY:', {
        svgContainer: {
          element: svgContainer,
          className: svgContainer.className,
          rect: svgContainer.getBoundingClientRect(),
          parentElement: svgContainer.parentElement?.tagName
        },
        video: {
          element: video,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          readyState: video.readyState,
          currentTime: video.currentTime,
          rect: video.getBoundingClientRect()
        },
        timestamp: Date.now()
      });

      // **TRIGGER VALIDATION NOW**: Both elements are ready
      console.log('🚀 SpotlightOverlay: Elements ready - triggering validation');
      validatePrerequisites();
      
      // Add video metadata listener for initial rendering
      const handleLoadedMetadata = () => {
        // Render once when metadata loads
        renderIfNeeded();
      };
      
      // Create ResizeObserver to track video size changes
      resizeObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === video) {
            // Trigger render when size changes
            renderIfNeeded();
          }
        }
      });
      
      // Start observing video element
      resizeObserverRef.current.observe(video);
      
      // Listen for video metadata loaded
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      // Store cleanup functions
      cleanupFns.push(
        () => {
          if (resizeObserverRef.current) {
            resizeObserverRef.current.disconnect();
            resizeObserverRef.current = null;
          }
        },
        () => video.removeEventListener('loadedmetadata', handleLoadedMetadata),
        stopRenderLoop
      );
    };
    
    attach();
    
    return () => {
      if (raf) cancelAnimationFrame(raf);
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, [renderIfNeeded, stopRenderLoop]);

  // **CONDITIONAL RENDERING MOVED TO END**: After all hooks are declared
  if (!healthGatedVisibility) {
    console.log('⏸️ SpotlightOverlay: Staying mounted but invisible (health-gated):', {
      videoReady,
      hasValidTracking,
      timebaseHealthy,
      isVisible
    });
    return <div className="absolute inset-0 pointer-events-none opacity-0" />;
  }

  // **RENDER SVG CONTAINER**: Always render so validation can find it
  // Effects will be hidden if not ready, but container must exist for validation

  return (
    <div className={`pointer-events-none absolute inset-0 z-50 w-full h-full ${className}`}>
      {/* SVG CONTAINER: Holds dynamically generated SVG effects */}
      <div
        ref={svgContainerRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          zIndex: 40,
          display: 'block',
          visibility: 'visible',
          opacity: 1,
          backgroundColor: 'transparent' // Ensure transparent background
        }}
        data-testid="spotlight-overlay-svg-container"
      />
      
      {/* **COMPACT DEBUG HUD**: Minimal overlay for tracking verification */}
      {showDebugOverlay && debugOverlayData && (
        <div 
          className="absolute top-2 right-2 bg-black/95 text-white text-xs font-mono p-3 rounded z-50 pointer-events-none"
          style={{ minWidth: '280px', backdropFilter: 'blur(6px)' }}
          data-testid="enhanced-timebase-audit-hud"
        >
          <div className="text-green-400 font-bold text-xs mb-2">🎯 TIMEBASE AUDIT & TRACKING</div>
          
          {/* **TIMEBASE AUDIT** */}
          <div className="border-b border-gray-600 pb-2 mb-2">
            <div className="text-yellow-400 font-semibold mb-1">⏰ TIMEBASE VERIFICATION:</div>
            <div className="space-y-1 text-xs">
              <div>currentVideoTime: <span className="text-cyan-400">{debugOverlayData.currentVideoTime?.toFixed(3)}s</span></div>
              <div>clipStartOffset: <span className="text-blue-400">{debugOverlayData.clipStartOffset?.toFixed(3)}s</span></div>
              <div>sampleTime: <span className="text-lime-400">{debugOverlayData.sampleTime?.toFixed(3)}s</span></div>
              <div>selectedActivationTime: <span className="text-purple-400">{debugOverlayData.selectedActivationTime?.toFixed(3) || 'null'}s</span></div>
            </div>
          </div>

          {/* **ID LOCK STATUS** */}
          <div className="border-b border-gray-600 pb-2 mb-2">
            <div className="text-yellow-400 font-semibold mb-1">🔒 ID-LOCK STATUS:</div>
            <div className="space-y-1 text-xs">
              <div>selectedPlayerId: <span className="text-yellow-400">{debugOverlayData.selectedPlayerId}</span></div>
              <div>trackingBoxId: <span className="text-orange-400">{debugOverlayData.trackingBoxId || 'null'}</span></div>
              <div>boxTimestamp: <span className="text-gray-400">{debugOverlayData.boxTimestamp?.toFixed(3) || 'null'}s</span></div>
              <div>ID Match: <span className={debugOverlayData.selectedPlayerId === debugOverlayData.trackingBoxId ? 'text-green-400' : 'text-red-400'}>
                {debugOverlayData.selectedPlayerId === debugOverlayData.trackingBoxId ? 'YES' : 'NO'}
              </span></div>
            </div>
          </div>

          {/* **FREEZE & VALIDITY** */}
          <div className="border-b border-gray-600 pb-2 mb-2">
            <div className="text-yellow-400 font-semibold mb-1">🧊 FREEZE STATUS:</div>
            <div className="space-y-1 text-xs">
              <div>freezeActive: <span className={debugOverlayData.freezeActive ? 'text-red-400' : 'text-green-400'}>{debugOverlayData.freezeActive ? 'YES' : 'NO'}</span></div>
              <div>framesSinceLastValid: <span className="text-orange-400">{debugOverlayData.framesSinceLastValid}</span></div>
              <div>hasValidBoxForSelected: <span className={debugOverlayData.hasValidBoxForSelected ? 'text-green-400' : 'text-red-400'}>{debugOverlayData.hasValidBoxForSelected ? 'YES' : 'NO'}</span></div>
            </div>
          </div>

          {/* **FINAL STATUS** */}
          <div className="space-y-1 text-xs">
            <div>isSpotlightActive: <span className={debugOverlayData.isSpotlightActive ? 'text-green-400' : 'text-red-400'}>{debugOverlayData.isSpotlightActive ? 'YES' : 'NO'}</span></div>
            {debugOverlayData.rawDetectorBox && (
              <div>Pos: <span className="text-cyan-400">({debugOverlayData.rawDetectorBox.x.toFixed(3)}, {debugOverlayData.rawDetectorBox.y.toFixed(3)})</span></div>
            )}
            <div className="text-gray-400">Frame: {debugOverlayData.frameCount}</div>
          </div>
        </div>
      )}
      {/* **VERIFICATION HUD**: Always visible debugging panel for development */}
      <div 
        className="fixed top-4 right-4 bg-black/90 text-white p-3 rounded-lg text-xs font-mono z-50 max-w-xs"
        style={{ fontSize: '10px', lineHeight: '12px' }}
      >
        <div className="text-yellow-400 font-semibold mb-2 text-center">VERIFICATION HUD</div>
        
        <div className="space-y-1">
          <div>effectsMounted: <span className={verificationHudData.effectsMounted ? 'text-green-400' : 'text-red-400'}>
            {verificationHudData.effectsMounted ? 'YES' : 'NO'}
          </span></div>
          
          <div>videoReady: <span className={verificationHudData.videoReady ? 'text-green-400' : 'text-red-400'}>
            {verificationHudData.videoReady ? 'YES' : 'NO'}
          </span></div>
          
          <div>contentRect: <span className="text-cyan-400">
            {verificationHudData.contentRect ? `${verificationHudData.contentRect.w}x${verificationHudData.contentRect.h}` : 'NULL'}
          </span></div>
          
          <div>canvas: <span className="text-blue-400">
            {verificationHudData.canvas ? `${verificationHudData.canvas.w}x${verificationHudData.canvas.h}` : 'NULL'}
          </span></div>
          
          <div>dpr: <span className="text-purple-400">{verificationHudData.dpr.toFixed(1)}</span></div>
          
          <div>rAFStarted: <span className={verificationHudData.rAFStarted ? 'text-green-400' : 'text-red-400'}>
            {verificationHudData.rAFStarted ? 'YES' : 'NO'}
          </span></div>
          
          <div>rAFFrameCount: <span className="text-orange-400">{verificationHudData.rAFFrameCount}</span></div>
          
          <div className="border-t border-gray-600 pt-1 mt-1">
            <div className="text-yellow-400 font-semibold">TIMEBASE:</div>
            <div>currentVideoTime: <span className="text-cyan-400">{verificationHudData.currentVideoTime.toFixed(3)}s</span></div>
            <div>clipStartOffset: <span className="text-blue-400">{verificationHudData.clipStartOffset.toFixed(3)}s</span></div>
            <div>sampleTime: <span className="text-lime-400">{verificationHudData.sampleTime.toFixed(3)}s</span></div>
            <div>selectedActivationTime: <span className="text-purple-400">
              {verificationHudData.selectedActivationTime?.toFixed(3) || 'null'}s
            </span></div>
          </div>
          
          <div className="border-t border-gray-600 pt-1 mt-1">
            <div className="text-yellow-400 font-semibold">TRACKING:</div>
            <div>selectedPlayerId: <span className="text-yellow-400">
              {verificationHudData.selectedPlayerId || 'null'}
            </span></div>
            <div>trackingBoxId: <span className="text-orange-400">
              {verificationHudData.trackingBoxId || 'null'}
            </span></div>
            <div>ID Match: <span className={verificationHudData.idMatch ? 'text-green-400' : 'text-red-400'}>
              {verificationHudData.idMatch ? 'YES' : 'NO'}
            </span></div>
            <div>boxTimestamp: <span className="text-gray-400">
              {verificationHudData.boxTimestamp?.toFixed(3) || 'null'}s
            </span></div>
            <div>|boxTimestamp - sampleTime|: <span className="text-gray-400">
              {verificationHudData.timeDelta?.toFixed(3) || 'null'}s
            </span></div>
          </div>
          
          <div className="border-t border-gray-600 pt-1 mt-1">
            <div className="text-yellow-400 font-semibold">SOURCE TRACKING:</div>
            <div>currentSource: <span className="text-cyan-400">{currentSource || 'null'}</span></div>
            <div>sourceLockRemaining: <span className="text-purple-400">
              {sourceLockedUntil > Date.now() ? `${Math.max(0, sourceLockedUntil - Date.now())}ms` : '0ms'}
            </span></div>
            <div>serverLockUsed: <span className={serverLockUsed ? 'text-red-400' : 'text-green-400'}>
              {serverLockUsed ? 'YES' : 'NO'}
            </span></div>
            <div>lastTransition: <span className="text-orange-400">
              {lastSourceTransition ? `${lastSourceTransition.source} @${lastSourceTransition.timestamp}` : 'none'}
            </span></div>
          </div>
          
          <div className="border-t border-gray-600 pt-1 mt-1">
            <div className="text-yellow-400 font-semibold">JUMP DETECTION:</div>
            <div>positionJumps: <span className="text-red-400">{positionJumpCount}</span></div>
            <div>toleranceViolations: <span className="text-orange-400">{toleranceViolationCount}</span></div>
            <div>lastPos: <span className="text-cyan-400">
              {lastPosition ? `(${lastPosition.x.toFixed(3)}, ${lastPosition.y.toFixed(3)})` : 'null'}
            </span></div>
          </div>
          
          <div className="border-t border-gray-600 pt-1 mt-1">
            <div className="text-yellow-400 font-semibold">MOTION SMOOTHING:</div>
            <div>smoothingActive: <span className={smoothedBox ? 'text-green-400' : 'text-red-400'}>
              {smoothedBox ? 'YES' : 'NO'}
            </span></div>
            {rawVsSmoothedDelta && (
              <>
                <div>rawPos: <span className="text-orange-400">
                  ({rawVsSmoothedDelta.raw.x.toFixed(3)}, {rawVsSmoothedDelta.raw.y.toFixed(3)})
                </span></div>
                <div>smoothedPos: <span className="text-green-400">
                  ({rawVsSmoothedDelta.smoothed.x.toFixed(3)}, {rawVsSmoothedDelta.smoothed.y.toFixed(3)})
                </span></div>
                <div>smoothingDelta: <span className="text-purple-400">
                  {rawVsSmoothedDelta.delta.toFixed(4)}
                </span></div>
              </>
            )}
          </div>
          
          <div className="border-t border-gray-600 pt-1 mt-1">
            <div className="text-yellow-400 font-semibold">RENDER:</div>
            <div>hasValidBoxForSelected: <span className={verificationHudData.hasValidBoxForSelected ? 'text-green-400' : 'text-red-400'}>
              {verificationHudData.hasValidBoxForSelected ? 'YES' : 'NO'}
            </span></div>
            <div>freezeActive: <span className={verificationHudData.freezeActive ? 'text-red-400' : 'text-green-400'}>
              {verificationHudData.freezeActive ? 'YES' : 'NO'}
            </span></div>
            <div>framesSinceLastValid: <span className="text-orange-400">{verificationHudData.framesSinceLastValid}</span></div>
            <div>final isSpotlightActive: <span className={verificationHudData.finalIsSpotlightActive ? 'text-green-400' : 'text-red-400'}>
              {verificationHudData.finalIsSpotlightActive ? 'YES' : 'NO'}
            </span></div>
          </div>
          
          {verificationHudData.lastErrorMessage && (
            <div className="text-red-400 mt-1 break-words">
              ERROR: {verificationHudData.lastErrorMessage}
            </div>
          )}
          
          {verificationHudData.lastSuccessfulDrawTime && (
            <div className="text-green-400">
              Last Draw: {new Date(verificationHudData.lastSuccessfulDrawTime).toLocaleTimeString()}
            </div>
          )}
          
          <div className="mt-2 pt-1 border-t border-gray-600">
            Prerequisites: <span className={verificationHudData.prerequisitesValid ? 'text-green-400' : 'text-red-400'}>
              {verificationHudData.prerequisitesValid ? 'VALID' : 'INVALID'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}