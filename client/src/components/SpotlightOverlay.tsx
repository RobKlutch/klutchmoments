import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo, type RefObject } from 'react';
import { renderSpotlightEffectSvg, type EffectSettings } from "@/lib/effectRendererSvg";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';
import { getVideoRenderRectFromElements } from "@/utils/coordinateTransform";
import { validateNoFlip, assertCenterCoordinatesPresent } from "@/utils/coordinateGuards";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🚨 CRITICAL: NO COORDINATE FLIPPING ALLOWED 🚨
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * COORDINATE SYSTEM:
 * - Origin (0,0) is TOP-LEFT corner
 * - X increases LEFT → RIGHT
 * - Y increases TOP → BOTTOM
 * - All coordinates normalized to [0, 1]
 * 
 * NEVER FLIP COORDINATES:
 * ❌ x = 1 - x
 * ❌ centerX = 1 - centerX
 * ❌ transform: scaleX(-1)
 * 
 * ALWAYS USE COORDINATES AS-IS:
 * ✅ pixelX = renderBox.x + (normalizedX * renderBox.width)
 * ✅ Use centerX/centerY directly from backend
 * 
 * See coordinateGuards.ts for full documentation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// **UNIVERSAL OVERLAY SYSTEM**: Spotlight effect rendering over videos
interface SpotlightOverlayProps {
  videoRef: RefObject<HTMLVideoElement>;
  trackingBox: { x: number; y: number; width: number; height: number; centerX?: number; centerY?: number; id?: string; confidence?: number } | null;
  effect: string;
  settings: EffectSettings;
  className?: string;
  isVisible?: boolean;
  detectionTime?: number; // **NEW**: When spotlight should activate (default always visible)
  selectedPlayerId?: string; // **DEBUG**: For ID-lock status display
  selectedPlayer?: { id: string; centerX: number; centerY: number; x: number; y: number; width: number; height: number; topLeftX?: number; topLeftY?: number; }; // **NEW**: Full player object with optional canonical coordinates
  isManuallySelected?: boolean; // **DEBUG**: For tracking mode display
  showDebugOverlay?: boolean; // **DEBUG**: Enable visual debugging
  sampleTime: number; // **CRITICAL**: Current video time for coordinate lookups
  realVideoTime: number; // **CRITICAL**: Current video time for time-based logic
  // **PER-FRAME ID LOOKUP**: Required function for ID-specific box retrieval
  getBoxByIdAtTime: (selectedPlayerId: string, lookupTime: number) => {
    box: { x: number; y: number; width: number; height: number; centerX?: number; centerY?: number; id?: string } | null;
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
  // **INSTANCE ID**: Unique ID for this overlay instance to debug multiple instances
  const overlayInstanceId = useRef(crypto.randomUUID()).current;
  
  // **TELEMETRY**: Log Timeline → Backend → Video Preview coordinate handshake
  useEffect(() => {
    if (selectedPlayer) {
      console.log('📊 COORDINATE HANDSHAKE TELEMETRY (Timeline → Backend → Video Preview):', {
        playerId: selectedPlayer.id,
        timeline_selection: {
          topLeft: `(${selectedPlayer.topLeftX?.toFixed(3) || 'N/A'}, ${selectedPlayer.topLeftY?.toFixed(3) || 'N/A'})`,
          center: `(${selectedPlayer.centerX?.toFixed(3) || 'N/A'}, ${selectedPlayer.centerY?.toFixed(3) || 'N/A'})`,
          dimensions: `${selectedPlayer.width?.toFixed(3)}×${selectedPlayer.height?.toFixed(3)}`
        },
        video_preview_received: {
          x: selectedPlayer.x?.toFixed(3),
          y: selectedPlayer.y?.toFixed(3),
          centerX: selectedPlayer.centerX?.toFixed(3),
          centerY: selectedPlayer.centerY?.toFixed(3),
          topLeftX: selectedPlayer.topLeftX?.toFixed(3) || 'MISSING',
          topLeftY: selectedPlayer.topLeftY?.toFixed(3) || 'MISSING',
          width: selectedPlayer.width?.toFixed(3),
          height: selectedPlayer.height?.toFixed(3)
        },
        coordinate_integrity: {
          hasTopLeft: selectedPlayer.topLeftX !== undefined && selectedPlayer.topLeftY !== undefined,
          hasCenter: selectedPlayer.centerX !== undefined && selectedPlayer.centerY !== undefined,
          canonical: selectedPlayer.topLeftX !== undefined && selectedPlayer.centerX !== undefined ? 'YES' : 'NO'
        }
      });
    }
  }, [selectedPlayer]);
  
  // **ARCHITECT FIX**: Health check state - MUST be at top before any returns
  const [timebaseHealthy, setTimebaseHealthy] = useState(false);
  const [healthCheckAttempts, setHealthCheckAttempts] = useState(0);
  const lastHealthCheckTime = useRef<number>(0);
  
  // **UX FIX**: Debug panel collapse state - start collapsed to not obstruct view
  const [debugPanelsCollapsed, setDebugPanelsCollapsed] = useState(true);
  const timebaseStartTime = useRef<number>(0);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // **🚨 TIMEBASE REFS**: Critical for live timebase advancement tracking
  const lastVideoTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  
  // **TIME SYNC FIX**: Exponential smoothing for micro-jitter reduction
  const [smoothPos, setSmoothPos] = useState<{x: number, y: number}>({x: 0, y: 0});
  const SMOOTH_ALPHA = 0.25; // Smoothing factor (0 = no smoothing, 1 = no lag)
  
  // **LOG INSTANCE LIFECYCLE**
  useEffect(() => {
    console.info(`[Overlay ${overlayInstanceId}] MOUNT`);
    return () => {
      console.info(`[Overlay ${overlayInstanceId}] UNMOUNT`);
    };
  }, [overlayInstanceId]);

  // **ARCHITECT FIX**: Run timebase health check - watch for video element changes
  useEffect(() => {
    const video = videoRef?.current;
    
    if (!video) {
      setTimebaseHealthy(false);
      return;
    }

    const handleLoadedMetadata = () => {
      // Video is ready, mark as healthy
      setTimebaseHealthy(true);
      setHealthCheckAttempts(0);
    };

    // If metadata already loaded, mark healthy immediately
    if (video.readyState >= 2) {
      setTimebaseHealthy(true);
      setHealthCheckAttempts(0);
      return;
    }

    // Otherwise wait for metadata to load
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoRef?.current]);  // Rerun when video element changes

  // **CRITICAL GATING**: Only render overlay when video is healthy and timebase advancing
  const video = videoRef?.current;
  const videoReady = video && video.readyState >= 2;
  
  // **ARCHITECT FIX**: Enable immediate manual activation - relax hasValidTracking condition
  // Use real isManuallySelected prop, don't shadow it with local variable
  const hasValidTracking = !!selectedPlayerId && (!!trackingBox || isManuallySelected || !!selectedPlayer);
  
  // **ARCHITECT PRESCRIBED**: Health-gated visibility check
  // If selectedPlayer exists, allow rendering even if timebaseHealthy not yet set
  const healthGatedVisibility = videoReady && hasValidTracking && (timebaseHealthy || !!selectedPlayer) && isVisible;
  
  // DUPLICATE HEALTH CHECK AND EXCESSIVE LOGGING REMOVED TO PREVENT CONSOLE FLOODING

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
    // **INSTANCE TRACKING**
    overlayId?: string;
    loopBackend?: string;
    videoSrc?: string;
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
  const prerequisitesValidRef = useRef(false); // Track prerequisitesValid without triggering re-renders
  
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
      if (!video || video.readyState < 1) {
        prerequisitesValidRef.current = false; // Update ref immediately
        setVerificationHudData(prev => ({ 
          ...prev, 
          videoReady: false,
          lastErrorMessage: 'Video not ready (readyState < 1)',
          prerequisitesValid: false
        }));
        return false;
      }
      
      const container = svgContainerRef.current;
      if (!container) {
        prerequisitesValidRef.current = false; // Update ref immediately
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
        prerequisitesValidRef.current = false; // Update ref immediately
        setVerificationHudData(prev => ({ 
          ...prev, 
          contentRect: null,
          canvas: null,
          lastErrorMessage: 'Container rect invalid or zero size',
          prerequisitesValid: false
        }));
        return false;
      }
      
      // **CRITICAL**: Check video dimensions are loaded before calculating aspect ratio
      if (!video.videoWidth || !video.videoHeight) {
        prerequisitesValidRef.current = false; // Update ref immediately
        setVerificationHudData(prev => ({ 
          ...prev, 
          contentRect: null,
          canvas: null,
          lastErrorMessage: 'Video dimensions not yet loaded (waiting for metadata)',
          prerequisitesValid: false
        }));
        return false;
      }
      
      const dpr = window.devicePixelRatio || 1;
      if (!isFinite(dpr) || dpr <= 0) {
        prerequisitesValidRef.current = false; // Update ref immediately
        setVerificationHudData(prev => ({ 
          ...prev, 
          lastErrorMessage: 'Invalid device pixel ratio',
          prerequisitesValid: false
        }));
        return false;
      }
      
      // **SUCCESS**: All prerequisites met
      
      // **CALCULATE PAINTED VIDEO RECT**: Account for letterboxing/pillarboxing
      const videoAspect = video.videoWidth / video.videoHeight;
      const containerAspect = contentRect.width / contentRect.height;
      
      let paintedWidth: number, paintedHeight: number;
      if (containerAspect > videoAspect) {
        // Pillarboxed (black bars on sides)
        paintedHeight = contentRect.height;
        paintedWidth = paintedHeight * videoAspect;
      } else {
        // Letterboxed (black bars on top/bottom)
        paintedWidth = contentRect.width;
        paintedHeight = paintedWidth / videoAspect;
      }
      
      prerequisitesValidRef.current = true; // Update ref immediately
      setVerificationHudData(prev => ({ 
        ...prev, 
        videoReady: true,
        contentRect: { w: contentRect.width, h: contentRect.height },
        canvas: { w: Math.round(paintedWidth), h: Math.round(paintedHeight) },
        dpr,
        lastErrorMessage: null,
        prerequisitesValid: true
      }));
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      prerequisitesValidRef.current = false; // Update ref immediately
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerId]); // **FIX**: Removed validatePrerequisites from deps (it's stable with [] deps)

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
  const liveTrackingBoxRef = useRef<any>(null);
  const [liveTrackingBox, setLiveTrackingBox] = useState<any>(null);
  
  // **SURGICAL FIX**: Update ref with effective tracking box (includes fallback to prop)
  useEffect(() => {
    const effectiveBox = liveTrackingBox || trackingBox;
    liveTrackingBoxRef.current = effectiveBox;
    console.log('📦 SPOTLIGHT: liveTrackingBoxRef updated:', {
      hasLiveBox: !!liveTrackingBox,
      hasTrackingBoxProp: !!trackingBox,
      effectiveBox: effectiveBox ? {
        x: effectiveBox.x?.toFixed(3),
        y: effectiveBox.y?.toFixed(3),
        confidence: effectiveBox.confidence
      } : null
    });
  }, [liveTrackingBox, trackingBox]);
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
    
    // **BALANCED EMA FOR 500MS DETECTION INTERVAL**: Moderate smoothing balances responsiveness and stability
    const baseAlpha = 0.4; // Balanced - prevents stale coordinate lockup
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
    
    // **CONSERVATIVE VELOCITY CAP**: Prevents unrealistic jumps from stale detections
    const maxVelocityPerSecond = 2.5; // Conservative - rejects out-of-bounds deltas
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
      // **TIME SYNC FIX**: Replace stale frame rejection with tolerance window
      // If sampleTime and realVideoTime differ significantly, snap to realVideoTime
      const TOLERANCE_SECONDS = 0.150; // 150ms tolerance window
      const timeDelta = Math.abs(realVideoTime - sampleTime);
      const synchronizedSampleTime = (timeDelta > TOLERANCE_SECONDS && realVideoTime > 0) 
        ? realVideoTime 
        : sampleTime;
      
      // **MANUAL SELECTION TIME LOGIC**: Use detection time only initially, switch to synchronized sampleTime after first server lock
      const lookupTime = (isManuallySelected && detectionTime && !serverLockUsed) ? detectionTime : synchronizedSampleTime;
      
      const lookupResult = getBoxByIdAtTime(selectedPlayerId, lookupTime);
      
      // **CRITICAL HANDSHAKE LOGGING**: Verify coordinate transfer from HighlightLock (throttled)
      if (lookupResult.box && Math.random() < 0.05) { // Only log 5% of frames
        console.log('🔍 HANDSHAKE CHECK (SpotlightOverlay received):', {
          playerId: selectedPlayerId,
          received: {
            centerX: lookupResult.box.centerX?.toFixed(3),
            centerY: lookupResult.box.centerY?.toFixed(3),
            x: lookupResult.box.x?.toFixed(3),
            y: lookupResult.box.y?.toFixed(3),
            width: lookupResult.box.width?.toFixed(3),
            height: lookupResult.box.height?.toFixed(3)
          },
          lookupTime: lookupTime.toFixed(3),
          timeDelta: lookupResult.timeDelta.toFixed(3)
        });
      }
      
      // **DIAGNOSTIC LOGGING**: Track player ID mapping and re-acquisition timing
      if (lookupResult.box) {
        const trackId = lookupResult.box.id || 'unknown';
        const isIdMatch = trackId === selectedPlayerId;
        console.log('🎯 ID-LOCK DIAGNOSTIC:', {
          selectedPlayerId,
          mappedTrackId: trackId,
          idMatch: isIdMatch ? '✅' : '❌',
          detectionTimestamp: lookupResult.boxTimestamp?.toFixed(3) || 'null',
          lookupTime: lookupTime.toFixed(3),
          timeDelta: lookupResult.timeDelta.toFixed(3),
          reacquired: !serverLockUsed && lookupResult.found
        });
      }
      
      // **PRECEDENCE 1: Server ID-locked data** (RELAXED: timeDelta ≤ 1.5s to accommodate ~800ms detection interval)
      const timeDeltaAbs = lookupResult.boxTimestamp !== null ? Math.abs(lookupResult.boxTimestamp - lookupTime) : Infinity;
      const serverAvailable = lookupResult.box && (lookupResult.boxTimestamp !== null) && (timeDeltaAbs <= 1.5);
      
      // **DEBUG TELEMETRY**: Track tolerance violations (now 1.5s threshold)
      if (lookupResult.box && timeDeltaAbs > 1.5) {
        setToleranceViolationCount(prev => prev + 1);
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
        const shouldReset = selectedSource !== currentSource || timeDeltaAbs > 1.5; // Reset only on source change or very large gap (detections arrive every ~800ms)
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
  
  // **TIME SYNC FIX**: Additional exponential smoothing for micro-jitter reduction
  useEffect(() => {
    if (!liveTrackingBox) return;
    
    const boxCenterX = liveTrackingBox.centerX ?? (liveTrackingBox.x + liveTrackingBox.width / 2);
    const boxCenterY = liveTrackingBox.centerY ?? (liveTrackingBox.y + liveTrackingBox.height / 2);
    
    setSmoothPos(prev => ({
      x: prev.x + SMOOTH_ALPHA * (boxCenterX - prev.x),
      y: prev.y + SMOOTH_ALPHA * (boxCenterY - prev.y)
    }));
  }, [liveTrackingBox?.centerX, liveTrackingBox?.centerY, liveTrackingBox?.x, liveTrackingBox?.y, liveTrackingBox?.width, liveTrackingBox?.height, SMOOTH_ALPHA]);
  
  // **SINGLE SOURCE OF TRUTH**: Use liveTrackingBox for both HUD and renderer gating
  // **CRITICAL FIX**: Fallback to trackingBox prop when liveTrackingBox is null
  const effectiveTrackingBox = liveTrackingBox || trackingBox;
  // **DIMENSION VALIDATION**: Only render spotlight if bbox has positive width AND height
  const hasValidBoxForSelected = Boolean(
    effectiveTrackingBox && 
    effectiveTrackingBox.width > 0 && 
    effectiveTrackingBox.height > 0
  );
  
  // **ACTIVATION TIMING**: Show spotlight only after video reaches detection time
  // This ensures spotlight doesn't appear at 0:00 when player was selected at 5.9s
  const currentVideoTime = realVideoTime;
  const activationTime = detectionTime || 0;
  const shouldActivateByTime = currentVideoTime >= activationTime;
  
  // **SPATIAL ACCURACY GATE**: Trust the tracker's predictions - they handle temporal alignment internally
  // The tracker uses EMA smoothing and prediction to ensure boxes are always current
  // For manual selections, we want to show the spotlight immediately regardless of timestamp
  const hasSpatiallyAccurateBbox = hasValidBoxForSelected; // If we have a valid box, it's accurate
  
  // **FINAL GATING WITH PREREQUISITES**: Must have valid prerequisites, proper timing, valid bbox
  const isSpotlightActive = requireReady &&
    hasSelectedPlayer && 
    shouldActivateByTime && 
    hasValidBoxForSelected &&
    hasSpatiallyAccurateBbox; // Simplified: if we have a box, show it
    
  const effectiveVisibility = isVisible && isSpotlightActive;
  
  // **LEGACY REFERENCES**: For compatibility with existing debug logs
  const canActivateByTime = shouldActivateByTime;
  const canActivateByManual = false; // No longer bypass temporal accuracy checks
  
  // **CENTRALIZED COORDINATE TRANSFORMATION**: Use shared utility for consistency
  const getVideoRenderBox = useCallback(() => {
    const video = videoRef.current;
    const container = svgContainerRef.current;
    if (!video || !container) return null;
    
    const containerRect = container.getBoundingClientRect();
    
    // Use centralized transformation utility to calculate video render rectangle
    return getVideoRenderRectFromElements(video, containerRect);
  }, [videoRef]);
  
  const overlayPosPx = useMemo(() => {
    if (!effectiveTrackingBox) return { x: 0, y: 0 };
    
    const renderBox = getVideoRenderBox();
    if (!renderBox) return { x: 0, y: 0 };
    
    // **CRITICAL FIX**: Use centerX/centerY if available, otherwise calculate from topLeft
    const centerX = 'centerX' in effectiveTrackingBox && effectiveTrackingBox.centerX !== undefined
      ? effectiveTrackingBox.centerX 
      : effectiveTrackingBox.x + effectiveTrackingBox.width / 2;
    const centerY = 'centerY' in effectiveTrackingBox && effectiveTrackingBox.centerY !== undefined
      ? effectiveTrackingBox.centerY
      : effectiveTrackingBox.y + effectiveTrackingBox.height / 2;
    
    return {
      x: Math.round(renderBox.x + centerX * renderBox.width),
      y: Math.round(renderBox.y + centerY * renderBox.height)
    };
  }, [effectiveTrackingBox, getVideoRenderBox]);
  
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
  
  // **NORMALIZED BOX CENTER**: Extract center coordinates from effectiveTrackingBox
  const boxCenterNorm = useMemo(() => {
    if (!effectiveTrackingBox) return { x: 0, y: 0 };
    
    // **CRITICAL FIX**: Use centerX/centerY if available, otherwise calculate from topLeft
    const centerX = 'centerX' in effectiveTrackingBox && effectiveTrackingBox.centerX !== undefined
      ? effectiveTrackingBox.centerX 
      : effectiveTrackingBox.x + effectiveTrackingBox.width / 2;
    const centerY = 'centerY' in effectiveTrackingBox && effectiveTrackingBox.centerY !== undefined
      ? effectiveTrackingBox.centerY
      : effectiveTrackingBox.y + effectiveTrackingBox.height / 2;
    
    return {
      x: parseFloat(centerX.toFixed(6)),
      y: parseFloat(centerY.toFixed(6))
    };
  }, [effectiveTrackingBox]);
  
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
      selectedActivationTime: detectionTime ?? null,
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


  // **LIFECYCLE EVENT HANDLING**: Set videoReady on proper events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateVideoReady = () => {
      const isReady = video.readyState >= 1; // HAVE_METADATA or higher (match validatePrerequisites)
      setVerificationHudData(prev => ({ 
        ...prev, 
        videoReady: isReady,
        currentVideoTime: video.currentTime,
        lastErrorMessage: isReady ? null : prev.lastErrorMessage
      }));
      currentVideoTimeRef.current = video.currentTime;
      isVideoPlayingRef.current = !video.paused;
    };
    
    const validateOnMetadata = () => {
      updateVideoReady();
      validatePrerequisites(); // Only validate on metadata/canplay, not every timeupdate
    };

    // Initial state - just update, don't validate yet
    updateVideoReady();

    // **LIFECYCLE EVENTS**: Validate only on metadata/canplay (not timeupdate)
    video.addEventListener('loadedmetadata', validateOnMetadata);
    video.addEventListener('canplay', validateOnMetadata);
    video.addEventListener('timeupdate', updateVideoReady); // Only update time, no validation

    return () => {
      video.removeEventListener('loadedmetadata', validateOnMetadata);
      video.removeEventListener('canplay', validateOnMetadata);
      video.removeEventListener('timeupdate', updateVideoReady);
    };
  }, [videoRef]); // Removed prerequisitesValid dependency to prevent infinite loop

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
      selectedActivationTime: detectionTime ?? null,
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
    
    // **CRITICAL FIX**: Read from REF not state to avoid stale closures in RAF loop
    const liveBox = liveTrackingBoxRef.current;
    
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
    if (!liveBox) {
      console.log('🧹 SpotlightOverlay clearing container:', {
        reason: 'no liveBox from ref',
        effectiveVisibility,
        isVisible,
        hasLiveBox: !!liveBox
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
    
    // **INTERIM SAFEGUARDS**: Normalize and clamp liveBox coordinates
    const needsNormalization = liveBox.x > 1 || liveBox.y > 1 || liveBox.width > 1 || liveBox.height > 1;
    
    // **CRITICAL DEBUG**: Log liveBox to see if centerX/centerY are present
    console.log('🔍 LIVEBOXCHECK:', {
      hasCenterX: 'centerX' in liveBox,
      hasCenterY: 'centerY' in liveBox,
      centerXValue: liveBox.centerX,
      centerYValue: liveBox.centerY,
      centerXType: typeof liveBox.centerX,
      centerYType: typeof liveBox.centerY
    });
    
    // **COORDINATE CLAMPING**: Ensure coordinates stay within [0,1] bounds to prevent off-screen rendering
    // **CRITICAL FIX (Oct 21, 2025)**: Backend sends coordinates in normalized [0,1] format
    // DO NOT divide by 100 - coordinates are already normalized!
    let normalizedBox = needsNormalization ? {
      x: liveBox.x / 100,
      y: liveBox.y / 100, 
      width: liveBox.width / 100,
      height: liveBox.height / 100,
      // Backend coordinates are ALWAYS in [0,1] format - never divide centerX/centerY by 100
      centerX: ('centerX' in liveBox && liveBox.centerX != null && typeof liveBox.centerX === 'number') ? liveBox.centerX : undefined,
      centerY: ('centerY' in liveBox && liveBox.centerY != null && typeof liveBox.centerY === 'number') ? liveBox.centerY : undefined
    } : { ...liveBox };
    
    // **CRITICAL SAFEGUARD**: Clamp all coordinates to valid [0,1] range
    normalizedBox = {
      x: Math.max(0, Math.min(1, normalizedBox.x)), // Clamp x to [0, 1]
      y: Math.max(0, Math.min(1, normalizedBox.y)), // Clamp y to [0, 1]
      width: Math.max(0.01, Math.min(1, normalizedBox.width)), // Minimum 1% width, max 100%
      height: Math.max(0.01, Math.min(1, normalizedBox.height)), // Minimum 1% height, max 100%
      centerX: normalizedBox.centerX !== undefined ? Math.max(0, Math.min(1, normalizedBox.centerX)) : undefined,
      centerY: normalizedBox.centerY !== undefined ? Math.max(0, Math.min(1, normalizedBox.centerY)) : undefined
    };
    
    // **🚨 ANTI-FLIP GUARD 🚨**: Validate coordinates have not been flipped
    assertCenterCoordinatesPresent(normalizedBox, 'SpotlightOverlay.render()');
    validateNoFlip(normalizedBox, 'SpotlightOverlay.render()');
    
    // **CRITICAL FIX (Oct 20, 2025)**: DO NOT flip coordinates - Timeline anchor coordinates are already correct
    // Removed horizontal flip that was causing spotlight to appear on opposite side
    // Timeline passes coordinates in correct space, no transformation needed
    // **🚨 NO FLIPPING ALLOWED 🚨**: See coordinateGuards.ts
    
    // **CRITICAL FIX**: Use centerX/centerY directly if available (most accurate)
    // Otherwise calculate from topLeft + half width/height
    let pixelCenterX: number;
    let pixelCenterY: number;
    
    if (normalizedBox.centerX !== undefined && normalizedBox.centerY !== undefined) {
      // **PREFERRED PATH**: Use provided center coordinates directly (already normalized and clamped)
      const rawPixelCenterX = renderBox.x + (normalizedBox.centerX * renderBox.width);
      const rawPixelCenterY = renderBox.y + (normalizedBox.centerY * renderBox.height);
      
      // **CLAMP TO VIDEO CONTENT RECT**: Ensure spotlight stays within actual video area
      pixelCenterX = Math.max(renderBox.x, Math.min(renderBox.x + renderBox.width, rawPixelCenterX));
      pixelCenterY = Math.max(renderBox.y, Math.min(renderBox.y + renderBox.height, rawPixelCenterY));
      
      // **HANDSHAKE LOGGING**: Verify normalized to pixel conversion (throttled to reduce console spam)
      if (Math.random() < 0.1) { // Only log 10% of frames
        console.log('🔍 HANDSHAKE CHECK (Normalized → Pixels):', {
          normalized: {
            centerX: normalizedBox.centerX.toFixed(3),
            centerY: normalizedBox.centerY.toFixed(3)
          },
          renderBox: {
            x: renderBox.x.toFixed(1),
            y: renderBox.y.toFixed(1),
            width: renderBox.width.toFixed(1),
            height: renderBox.height.toFixed(1)
          },
          pixels: {
            centerX: pixelCenterX.toFixed(1),
            centerY: pixelCenterY.toFixed(1)
          }
        });
      }
      
      console.log('✅ Using centerX/centerY from normalizedBox:', {
        centerX: normalizedBox.centerX.toFixed(3),
        centerY: normalizedBox.centerY.toFixed(3),
        pixelCenterX: pixelCenterX.toFixed(1),
        pixelCenterY: pixelCenterY.toFixed(1)
      });
    } else {
      // **FALLBACK PATH**: Calculate center from topLeft
      const pixelTopLeftX = renderBox.x + (normalizedBox.x * renderBox.width);
      const pixelTopLeftY = renderBox.y + (normalizedBox.y * renderBox.height);
      
      // **CLAMP TO VIDEO CONTENT RECT**: Ensure spotlight stays within actual video area
      const clampedPixelX = Math.max(renderBox.x, Math.min(renderBox.x + renderBox.width - (normalizedBox.width * renderBox.width), pixelTopLeftX));
      const clampedPixelY = Math.max(renderBox.y, Math.min(renderBox.y + renderBox.height - (normalizedBox.height * renderBox.height), pixelTopLeftY));
      
      // Calculate pixel center from clamped top-left for effect rendering
      pixelCenterX = clampedPixelX + ((normalizedBox.width * renderBox.width) / 2);
      pixelCenterY = clampedPixelY + ((normalizedBox.height * renderBox.height) / 2);
      console.log('⚠️ Calculating center from topLeft (centerX/centerY not available):', {
        topLeftX: normalizedBox.x.toFixed(3),
        topLeftY: normalizedBox.y.toFixed(3),
        pixelCenterX: pixelCenterX.toFixed(1),
        pixelCenterY: pixelCenterY.toFixed(1)
      });
    }
    
    // Calculate actual trackingBox pixel dimensions using normalized coordinates
    const trackingBoxPixels = {
      width: normalizedBox.width * renderBox.width,
      height: normalizedBox.height * renderBox.height
    };
    
    // Get container dimensions for SVG rendering
    const containerRect = svgContainer.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    // **CRITICAL DEBUG**: Log final rendering coordinates
    console.log('🎯 SPOTLIGHT RENDERING:');
    console.log('  📍 Normalized Box:', `x=${normalizedBox.x.toFixed(3)}, y=${normalizedBox.y.toFixed(3)}, w=${normalizedBox.width.toFixed(3)}, h=${normalizedBox.height.toFixed(3)}`);
    if (normalizedBox.centerX !== undefined && normalizedBox.centerY !== undefined) {
      console.log('  ✅ Using centerX/centerY:', `center=(${normalizedBox.centerX.toFixed(3)}, ${normalizedBox.centerY.toFixed(3)})`);
    }
    console.log('  📐 RenderBox:', `x=${renderBox.x.toFixed(1)}, y=${renderBox.y.toFixed(1)}, w=${renderBox.width.toFixed(1)}, h=${renderBox.height.toFixed(1)}`);
    console.log('  🎯 Final Pixel Center:', `x=${pixelCenterX.toFixed(1)}, y=${pixelCenterY.toFixed(1)}`);
    console.log('  📦 Container:', `w=${containerWidth}, h=${containerHeight}`);
    if (selectedPlayer) {
      console.log('  👤 SelectedPlayer:', `id=${selectedPlayer.id}, x=${selectedPlayer.x?.toFixed(3)}, centerX=${selectedPlayer.centerX?.toFixed(3)}, width=${selectedPlayer.width?.toFixed(3)}`);
    }
    
    // Generate SVG effect using the SVG renderer
    // Settings are already in correct 0-100 range from sliders, no scaling needed
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
      liveBox, // Raw detector box (normalized) from ref
      { x: pixelCenterX - trackingBoxPixels.width/2, y: pixelCenterY - trackingBoxPixels.height/2, 
        width: trackingBoxPixels.width, height: trackingBoxPixels.height }, // Transformed overlay box (pixels)
      renderBox, // Video render area
      svgContainer // Canvas container
    );

    // Clear previous SVG and insert new one
    svgContainer.innerHTML = '';
    svgContainer.appendChild(svgElement);
    
    // **DEBUG OVERLAY VISUALIZATION**: Add comprehensive debugging elements
    if (showDebugOverlay && liveBox) {
      const debugOverlay = createDebugOverlay(
        containerWidth,
        containerHeight,
        pixelCenterX,
        pixelCenterY,
        trackingBoxPixels,
        normalizedBox,
        liveBox,
        renderBox,
        selectedPlayerId,
        isManuallySelected,
        video
      );
      svgContainer.appendChild(debugOverlay);
    }
    
    return true; // Successfully rendered
  }, [videoRef, effect, settings, isVisible, effectiveVisibility, hasSelectedPlayer, canActivateByTime, canActivateByManual, hasValidBoxForSelected, getVideoRenderBox]);

  /**
   * **RENDERING RESILIENCE**: Enhanced render trigger with micro-movement detection
   * Ensures smooth rendering even with tiny coordinate changes
   */
  const renderIfNeeded = useCallback((sampleTime?: number, currentVideoTime?: number) => {
    const video = videoRef.current;
    const svgContainer = svgContainerRef.current;
    
    // **CRITICAL FIX**: Read from REF not state to avoid stale closures in RAF loop
    const liveBox = liveTrackingBoxRef.current;
    
    // **RESILIENCE FIX**: High precision fingerprint WITHOUT timestamps (to avoid over-rendering)
    const renderData = JSON.stringify({
      hasLiveTrackingBox: !!liveBox,
      videoReady: Boolean(video?.videoWidth && video?.videoHeight),
      containerReady: !!svgContainer,
      liveTrackingBox: liveBox ? {
        x: liveBox.x.toFixed(6), // **INCREASED PRECISION** for micro-movements
        y: liveBox.y.toFixed(6),
        width: liveBox.width.toFixed(6),
        height: liveBox.height.toFixed(6)
      } : null,
      effect,
      settings,
      isVisible: effectiveVisibility // Use computed visibility
      // **PERFORMANCE FIX**: Removed timestamp to prevent forced per-frame renders
    });
    
    // **RESILIENCE FIX**: Epsilon-based change detection for tiny movements using liveBox
    const hasTrackingBoxChanged = liveBox && lastRenderDataRef.current ? (() => {
      try {
        const lastData = JSON.parse(lastRenderDataRef.current);
        const lastBox = lastData.liveTrackingBox;
        if (!lastBox) return true;
        
        // Detect changes smaller than normal precision would catch
        const EPSILON = 0.0001; // Sub-pixel precision for ultra-smooth tracking
        return Math.abs(liveBox.x - parseFloat(lastBox.x)) > EPSILON ||
               Math.abs(liveBox.y - parseFloat(lastBox.y)) > EPSILON ||
               Math.abs(liveBox.width - parseFloat(lastBox.width)) > EPSILON ||
               Math.abs(liveBox.height - parseFloat(lastBox.height)) > EPSILON;
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
  }, [render, effect, settings, isVisible, effectiveVisibility]);

  /**
   * **REFS FOR RAF LOOP**: Store current values so RAF loop can check them
   * without capturing stale closures
   * NOTE: prerequisitesValidRef is defined earlier at line 174 and updated in validatePrerequisites
   */
  const selectedPlayerRef = useRef(selectedPlayer);
  const renderIfNeededRef = useRef(renderIfNeeded); // **FIX**: Store latest renderIfNeeded to break dependency cycle
  
  useEffect(() => {
    // Note: prerequisitesValidRef is updated directly in validatePrerequisites to avoid dependency cycles
    selectedPlayerRef.current = selectedPlayer;
    renderIfNeededRef.current = renderIfNeeded; // **FIX**: Update ref when renderIfNeeded changes
  }, [selectedPlayer, renderIfNeeded]);

  /**
   * **ARCHITECT-PRESCRIBED SELF-REARMING RENDER LOOP**
   * Uses rVFC when available, falls back to RAF
   * Exception-safe with try-finally block to ensure re-arming
   */
  const renderLoopRunningRef = useRef(false);
  const rvfcIdRef = useRef<number | null>(null);

  const startRenderLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video || renderLoopRunningRef.current) {
      console.log(`[Overlay ${overlayInstanceId}] Loop already running or no video`);
      return;
    }
    
    renderLoopRunningRef.current = true;
    
    // **DETECT rVFC SUPPORT**: Check instance method, not prototype
    const useRVFC = typeof (video as any).requestVideoFrameCallback === 'function';
    const videoSrc = video.currentSrc || video.src || '(none)';
    
    const shortSrc = videoSrc.substring(videoSrc.lastIndexOf('/') + 1);
    console.info(`[Overlay ${overlayInstanceId.substring(0, 8)}] startRenderLoop`, {
      backend: useRVFC ? 'rVFC' : 'RAF',
      videoSrc: shortSrc,
      videoReady: video.readyState,
      videoSize: `${video.videoWidth}x${video.videoHeight}`
    });
    
    if (useRVFC) {
      // **rVFC PATH**: Frame-synchronized with video
      const rvfcStep = (_now: number, meta: any) => {
        console.info(`[Overlay ${overlayInstanceId.substring(0, 8)}] rVFC fired`);
        try {
          const tAbsMs = Math.round(meta.mediaTime * 1000);
          const currentVideoTime = video.currentTime;
          
          // **RENDER AT ABSOLUTE TIME**
          renderAtAbsTime(tAbsMs, currentVideoTime);
          
          // **INCREMENT COUNTER**: Prove callback executed (ref only, no re-render)
          frameCountRef.current = (frameCountRef.current || 0) + 1;
          // **REMOVED setVerificationHudData**: Was causing 60fps re-renders and console floods
        } catch (e: any) {
          console.error('❌ rVFC render error:', e);
          // **REMOVED setVerificationHudData**: Was causing per-frame re-renders
        } finally {
          // **CRITICAL**: Re-arm loop if still running
          if (renderLoopRunningRef.current && video) {
            rvfcIdRef.current = (video as any).requestVideoFrameCallback(rvfcStep);
          }
        }
      };
      
      // **START rVFC**
      rvfcIdRef.current = (video as any).requestVideoFrameCallback(rvfcStep);
      console.info(`[Overlay ${overlayInstanceId.substring(0, 8)}] rVFC scheduled, id:`, rvfcIdRef.current);
    } else {
      // **RAF FALLBACK PATH**
      const rafTick = () => {
        try {
          const clipStartOffsetMs = 0; // TODO: Get from clip metadata
          const tAbsMs = clipStartOffsetMs + Math.round(video.currentTime * 1000);
          const currentVideoTime = video.currentTime;
          
          // **RENDER AT ABSOLUTE TIME**
          renderAtAbsTime(tAbsMs, currentVideoTime);
          
          // **INCREMENT COUNTER**: Prove callback executed (ref only, no re-render)
          frameCountRef.current = (frameCountRef.current || 0) + 1;
          // **REMOVED setVerificationHudData**: Was causing 60fps re-renders and console floods
        } catch (e: any) {
          console.error('❌ RAF render error:', e);
          // **REMOVED setVerificationHudData**: Was causing per-frame re-renders
        } finally {
          // **CRITICAL**: Re-arm loop if still running
          if (renderLoopRunningRef.current) {
            animationFrameRef.current = requestAnimationFrame(rafTick);
          }
        }
      };
      
      // **START RAF**
      animationFrameRef.current = requestAnimationFrame(rafTick);
      console.info(`[Overlay ${overlayInstanceId.substring(0, 8)}] RAF scheduled, id:`, animationFrameRef.current);
    }
  }, []);

  const stopRenderLoop = useCallback(() => {
    console.log('⏹️ SpotlightOverlay: Stopping render loop');
    renderLoopRunningRef.current = false;
    
    // **CANCEL rVFC**
    if (rvfcIdRef.current !== null) {
      const video = videoRef.current;
      if (video && typeof (video as any).cancelVideoFrameCallback === 'function') {
        (video as any).cancelVideoFrameCallback(rvfcIdRef.current);
      }
      rvfcIdRef.current = null;
    }
    
    // **CANCEL RAF**
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    setVerificationHudData(prev => ({ ...prev, rAFStarted: false }));
  }, []);

  /**
   * **RENDER AT ABSOLUTE TIME**: Core rendering with activation window gating
   * Increments frame counter even on no-draw to prove loop is running
   */
  const renderAtAbsTime = useCallback((tAbsMs: number, currentVideoTime: number) => {
    const svgContainer = svgContainerRef.current;
    const video = videoRef.current;
    
    // **QUICK BAILOUT**: No elements
    if (!svgContainer || !video) {
      return;
    }
    
    // **CRITICAL FIX**: Check prerequisites BEFORE attempting any rendering
    // This prevents rendering with zero dimensions that causes spotlight to appear below player
    if (!prerequisitesValidRef.current) {
      console.log('❌ SpotlightOverlay early exit: prerequisites not valid (video dimensions not ready)');
      return;
    }
    
    // **DOUBLE-CHECK VIDEO DIMENSIONS**: Extra safety guard
    if (!video.videoWidth || !video.videoHeight || video.videoWidth === 0 || video.videoHeight === 0) {
      console.log('❌ SpotlightOverlay early exit: video dimensions not ready', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight
      });
      return;
    }
    
    // **ACTIVATION WINDOW GATING**: Only render after detectionTime (when player was selected)
    const activationTime = detectionTime || 0;
    if (currentVideoTime < activationTime) {
      // **BEFORE ACTIVATION**: Hide overlay
      if (svgContainer.innerHTML !== '') {
        svgContainer.innerHTML = '';
      }
      return;
    }
    
    // **GET TRACKING BOX**: Must have valid box for selected player
    const bbox = liveTrackingBoxRef.current;
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
      // **NO VALID BOX**: Hide overlay
      if (svgContainer.innerHTML !== '') {
        svgContainer.innerHTML = '';
      }
      return;
    }
    
    // **VISIBILITY CHECK**: Must be visible and page active
    if (!effectiveVisibility || !isPageVisible) {
      return;
    }
    
    // **RENDER**: Call actual render function
    renderIfNeededRef.current(currentVideoTime, currentVideoTime);
  }, [detectionTime, effectiveVisibility, isPageVisible]);

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

  // **NOTE**: Listener attachment is now handled in useLayoutEffect when video becomes available

  /**
   * **SAFETY WATCHDOG**: Recover from missed events by checking if video is playing but loop isn't running
   * Runs every 300ms to detect and fix the "playing but no frames" state
   */
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      
      const playing = !video.paused && !video.ended && video.readyState >= 2;
      const frames = verificationHudData.rAFFrameCount;
      
      if (playing && frames === 0 && !renderLoopRunningRef.current) {
        console.warn(`🔄 [Overlay ${overlayInstanceId.substring(0, 8)}] WATCHDOG: Video playing but no frames rendered - restarting loop`);
        startRenderLoop();
      }
    }, 300);
    
    return () => clearInterval(watchdogInterval);
  }, [verificationHudData.rAFFrameCount, overlayInstanceId, startRenderLoop]);

  /**
   * **CLEANUP ON UNMOUNT**: Stop render loop when component unmounts
   */
  useEffect(() => {
    return () => {
      console.log('🎮 SpotlightOverlay: Unmounting - stopping render loop');
      stopRenderLoop();
    };
  }, [stopRenderLoop]);

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

      // **CRITICAL FIX**: Do NOT call validatePrerequisites() here - video metadata not loaded yet!
      // Let the video event listeners (loadedmetadata/canplay) trigger validation when ready
      
      // **ATTACH RENDER LOOP LIFECYCLE LISTENERS**: Do this immediately when video is available
      const handlePlay = () => {
        console.log(`🎬 [Overlay ${overlayInstanceId.substring(0, 8)}] Video PLAY - starting render loop`);
        isVideoPlayingRef.current = true;
        startRenderLoop();
      };
      
      const handleSeeked = () => {
        console.log(`⏩ [Overlay ${overlayInstanceId.substring(0, 8)}] Video SEEKED - restarting render loop`);
        startRenderLoop();
      };
      
      const handlePause = () => {
        console.log(`⏸️ [Overlay ${overlayInstanceId.substring(0, 8)}] Video PAUSE - stopping render loop`);
        isVideoPlayingRef.current = false;
        stopRenderLoop();
      };
      
      const handleEnded = () => {
        console.log(`🏁 [Overlay ${overlayInstanceId.substring(0, 8)}] Video ENDED - stopping render loop`);
        isVideoPlayingRef.current = false;
        stopRenderLoop();
      };
      
      const handleCanPlay = () => {
        // Start loop if video is already playing when canplay fires
        if (!video.paused && !video.ended) {
          console.log(`▶️ [Overlay ${overlayInstanceId.substring(0, 8)}] canplay + playing state - starting loop`);
          startRenderLoop();
        }
      };
      
      // Add video metadata listener for initial rendering
      const handleLoadedMetadata = () => {
        // Render once when metadata loads
        renderIfNeeded();
      };
      
      // **START LOOP IMMEDIATELY IF ALREADY PLAYING**
      const initialPlaying = !video.paused && !video.ended;
      console.log(`🎭 [Overlay ${overlayInstanceId.substring(0, 8)}] Video initial state:`, {
        paused: video.paused,
        ended: video.ended,
        initialPlaying,
        readyState: video.readyState,
        currentTime: video.currentTime
      });
      isVideoPlayingRef.current = initialPlaying;
      
      if (initialPlaying && video.readyState >= 2) {
        console.log(`▶️ [Overlay ${overlayInstanceId.substring(0, 8)}] Video already playing - starting loop now`);
        startRenderLoop();
      }
      
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
      
      // Attach all listeners
      video.addEventListener('play', handlePlay);
      video.addEventListener('seeked', handleSeeked);
      video.addEventListener('pause', handlePause);
      video.addEventListener('ended', handleEnded);
      video.addEventListener('canplay', handleCanPlay);
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      console.log(`✅ [Overlay ${overlayInstanceId.substring(0, 8)}] All listeners attached successfully`);
      
      // Store cleanup functions
      cleanupFns.push(
        () => {
          if (resizeObserverRef.current) {
            resizeObserverRef.current.disconnect();
            resizeObserverRef.current = null;
          }
        },
        () => {
          console.log(`🧹 [Overlay ${overlayInstanceId.substring(0, 8)}] Cleaning up video listeners`);
          video.removeEventListener('play', handlePlay);
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('pause', handlePause);
          video.removeEventListener('ended', handleEnded);
          video.removeEventListener('canplay', handleCanPlay);
          video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        },
        () => {
          // **CRITICAL FIX**: Clear SVG container on unmount to prevent duplicate frozen overlays
          if (svgContainer) {
            console.log(`🗑️ [Overlay ${overlayInstanceId.substring(0, 8)}] Clearing SVG container on unmount`);
            svgContainer.innerHTML = '';
          }
        },
        stopRenderLoop
      );
    };
    
    attach();
    
    return () => {
      if (raf) cancelAnimationFrame(raf);
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, [renderIfNeeded, startRenderLoop, stopRenderLoop, overlayInstanceId]);

  // **DEV-MODE GUARDRAIL**: Assert single overlay instance
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const overlays = document.querySelectorAll('[data-role="spotlight-overlay"]');
      if (overlays.length > 1) {
        console.error(`❌ DUPLICATE SPOTLIGHT OVERLAYS DETECTED: ${overlays.length} instances found!`, {
          overlayIds: Array.from(overlays).map(el => el.getAttribute('data-overlay-id')),
          overlays: Array.from(overlays)
        });
      } else {
        console.log(`✅ DOM Census: Single spotlight overlay (${overlayInstanceId.substring(0, 8)})`);
      }
    }
  }, [overlayInstanceId]);

  // **CRITICAL FIX**: Always render SVG container div for ref attachment
  // Hide effects when not ready, but container MUST exist for RAF loop
  
  return (
    <div 
      className={`pointer-events-none absolute inset-0 z-50 w-full h-full ${className}`}
      data-role="spotlight-overlay"
      data-overlay-id={overlayInstanceId}
    >
      {/* SVG CONTAINER: Holds dynamically generated SVG effects */}
      <div
        ref={svgContainerRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          zIndex: 40,
          display: 'block',
          visibility: healthGatedVisibility ? 'visible' : 'hidden',
          opacity: healthGatedVisibility ? 1 : 0,
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
      {/* **DEBUG TOGGLE BUTTON**: Always visible, clickable button to show/hide debug panels */}
      <button
        onClick={() => setDebugPanelsCollapsed(!debugPanelsCollapsed)}
        className="pointer-events-auto fixed bottom-4 right-4 bg-black/90 hover:bg-black text-white px-3 py-2 rounded-lg text-xs font-mono z-50 border border-gray-600 hover:border-gray-400 transition-colors"
        data-testid="button-toggle-debug-panels"
      >
        {debugPanelsCollapsed ? 'Show Debug' : 'Hide Debug'}
      </button>
      
      {/* **VERIFICATION HUD**: Collapsible debugging panel for development */}
      {!debugPanelsCollapsed && (
        <div 
          className="fixed top-4 right-4 bg-black/90 text-white p-3 rounded-lg text-xs font-mono z-50 max-w-xs pointer-events-none"
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
          
          {verificationHudData.overlayId && (
            <div>overlayId: <span className="text-blue-400">{verificationHudData.overlayId}</span></div>
          )}
          
          {verificationHudData.loopBackend && (
            <div>loopBackend: <span className="text-green-400">{verificationHudData.loopBackend}</span></div>
          )}
          
          {verificationHudData.videoSrc && (
            <div>videoSrc: <span className="text-purple-400">{verificationHudData.videoSrc.substring(0, 20)}</span></div>
          )}
          
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
      )}
    </div>
  );
}