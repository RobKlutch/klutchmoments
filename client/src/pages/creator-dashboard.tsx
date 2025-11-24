import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, 
  Upload, 
  Play, 
  Settings, 
  BarChart3, 
  FileText, 
  Eye,
  CheckCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  Bug,
  Monitor,
  Activity
} from "lucide-react";
import { Link } from "wouter";

// Import workflow components
import VideoUpload from "@/components/VideoUpload";
import CombinedClipPlayer from "@/components/CombinedClipPlayer";
import HighlightEffects from "@/components/HighlightEffects";
import { SimpleVideoPreview } from "@/components/SimpleVideoPreview";
import VideoPreviewPlayer from "@/components/VideoPreviewPlayer";
import VideoEffectsCompositor from "@/components/VideoEffectsCompositor";
import VideoPreview from "@/components/VideoPreview";
import ProcessingWorkflow from "@/components/ProcessingWorkflow";
import { createSafePlayer } from "@/utils/safePlayerAccess";
import { clearSessionStorage } from "@/lib/sessionStorage";
import { VideoPreviewErrorBoundary } from "@/components/VideoPreviewErrorBoundary";
import { getLogger } from "@/lib/stageLogger";
import { StageErrorBoundary } from "@/components/StageErrorBoundary";
import { throttledLog } from "@/lib/logThrottler";

// Workflow state types for creator dashboard
interface CreatorWorkflowState {
  step: 'upload' | 'timeline' | 'effects' | 'video-preview' | 'processing' | 'preview';
  videoFile: File | null;
  videoUrl: string | null;
  sessionId: string | null; // **NEW**: Unique ID per video upload to isolate tracking
  timeSelection: { start: number; end: number } | null;
  detectionTime?: number;
  playerPosition: { x: number; y: number } | null;
  selectedEffect: any | null;
  highlightId?: string;
  detectedPlayers?: any[];
  selectedPlayer?: any | null;
  fallbackMode?: boolean;
  detectionMessage?: string | null;
  previewFrameDataUrl?: string | null;
  processedVideoBlob?: Blob | null;
  processingProgress?: number;
  processingLogs?: string[];
  debugData?: any;
  jobConfig?: any;
  jobId?: string;
}

export default function CreatorDashboard() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("workflow");
  
  // **RESILIENT LOGGING**: Initialize logger outside React lifecycle
  const dashboardLogger = getLogger('CreatorDashboard');
  
  const [workflow, setWorkflow] = useState<CreatorWorkflowState>({
    step: 'upload',
    videoFile: null,
    videoUrl: null,
    sessionId: null, // **NEW**: Will be generated on video upload
    timeSelection: null,
    detectionTime: 0,
    playerPosition: null,
    selectedEffect: null,
    detectedPlayers: [],
    selectedPlayer: null,
    fallbackMode: false,
    detectionMessage: null,
    previewFrameDataUrl: null,
    processedVideoBlob: null,
    processingProgress: 0,
    processingLogs: [],
    debugData: null
  });

  // Authentication check
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-xl font-semibold mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">
            Please log in to access the creator dashboard.
          </p>
          <Button asChild>
            <Link href="/auth">Log In</Link>
          </Button>
        </Card>
      </div>
    );
  }

  // Workflow handlers
  const handleVideoSelect = async (file: File) => {
    const url = URL.createObjectURL(file);
    
    // **SESSION HANDLING**: Use sessionId from workflow state (set by handleRestart) or generate new
    // If coming from handleRestart, workflow.sessionId will be the fresh UUID it created
    // If brand new upload (no restart), generate fresh UUID
    const sessionId = workflow.sessionId || crypto.randomUUID();
    const isNewSession = workflow.step === 'upload' && !workflow.videoFile;
    
    if (workflow.sessionId) {
      console.log('📋 Using session ID from workflow state:', sessionId, isNewSession ? '(fresh from restart)' : '(existing)');
    } else {
      console.log('🆔 Generated brand new session ID for first upload:', sessionId);
    }
    
    // **RESET BACKEND TRACKING** for session (fresh or resumed)
    try {
      const resetResponse = await fetch('/api/reset-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ videoId: sessionId })
      });
      const resetData = await resetResponse.json();
      console.log('🧹 Backend tracking reset for session:', resetData);
    } catch (error) {
      console.error('❌ Failed to reset tracking for session:', error);
    }
    
    // **INVARIANT**: Clear ALL Timeline-derived state when uploading new video
    // This ensures no player preselection regardless of upload path (restart or direct re-upload)
    
    // Clear detection cache refs to prevent stale data
    detectionCacheRef.current = null;
    lastDetectedTimestampRef.current = -1;
    lastResetPlayerIdRef.current = null; // Clear reset guard for new session
    
    setWorkflow(prev => ({
      ...prev,
      videoFile: file,
      videoUrl: url,
      sessionId, // Reuse existing or store new session ID
      step: 'timeline',
      // **CRITICAL**: Clear all Timeline state - enforce "no selection" invariant
      selectedPlayer: null,
      detectedPlayers: [],
      playerPosition: null,
      fallbackMode: false,
      detectionMessage: null,
      previewFrameDataUrl: null,
      detectionTime: undefined,
      processingLogs: [...(prev.processingLogs || []), `Video uploaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`]
    }));
    addLog(`Video uploaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  };

  const handleTimeSelection = (start: number, end: number, detectionTime: number) => {
    console.log('🎯 handleTimeSelection CALLED:', { start, end, detectionTime });
    setWorkflow(prev => {
      console.log('🎯 handleTimeSelection - Previous timeSelection:', prev.timeSelection);
      const nextState = {
        ...prev,
        timeSelection: { start, end },
        detectionTime
      };
      console.log('🎯 handleTimeSelection - New timeSelection:', nextState.timeSelection);
      return nextState;
    });
    addLog(`Time selection: ${start}s - ${end}s, detection at ${detectionTime}s`);
  };

  const handleTimelineConfirm = () => {
    // **VALIDATION**: Ensure all prerequisites are met before allowing transition
    if (!workflow.selectedPlayer) {
      toast({
        title: "Cannot Proceed",
        description: "Please select a player from the detected players list before continuing.",
        variant: "destructive"
      });
      addLog('❌ Cannot proceed to effects: No player selected');
      return;
    }
    
    if (!workflow.timeSelection) {
      toast({
        title: "Cannot Proceed",
        description: "Please select a time range for your highlight clip.",
        variant: "destructive"
      });
      addLog('❌ Cannot proceed to effects: No time selection');
      return;
    }
    
    toast({
      title: "Timeline Complete",
      description: "Advancing to effect selection...",
      duration: 2000
    });
    
    setWorkflow(prev => ({
      ...prev,
      step: 'effects'
    }));
    addLog('Timeline confirmed, moving to effects selection');
  };

  // **MEMOIZATION**: Track last detected timestamp to prevent duplicate API calls
  const lastDetectedTimestampRef = useRef<number | null>(null);
  const detectionCacheRef = useRef<{timestamp: number, players: any[]} | null>(null);

  const handleFrameCapture = async (frameBlob: Blob, timestamp: number) => {
    try {
      // **SINGLE DETECTION ENFORCEMENT**: Skip if same frame already detected
      const roundedTimestamp = Math.round(timestamp * 100) / 100; // Round to 10ms precision
      if (lastDetectedTimestampRef.current !== null && 
          Math.abs(lastDetectedTimestampRef.current - roundedTimestamp) < 0.05) {
        console.log(`🚫 SKIPPING duplicate detection for timestamp ${roundedTimestamp}s (already detected)`);
        
        // Return cached result if available
        if (detectionCacheRef.current && detectionCacheRef.current.timestamp === lastDetectedTimestampRef.current) {
          addLog(`Using cached detection for ${roundedTimestamp}s`);
          return detectionCacheRef.current.players;
        }
        return;
      }
      
      lastDetectedTimestampRef.current = roundedTimestamp;
      addLog(`Capturing frame at ${timestamp.toFixed(2)}s for player detection`);
      
      // ZERO-LAG OPTIMIZATION: Send Blob via FormData (60% smaller, no base64 overhead)
      const formData = new FormData();
      formData.append('frame', frameBlob, 'frame.jpg');
      formData.append('timestampMs', Math.round(timestamp * 1000).toString());
      formData.append('videoId', workflow.sessionId || 'fallback-session'); // **CRITICAL**: Use sessionId for isolated tracking
      formData.append('detectionMethod', 'replicate');
      
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        credentials: 'include', // **CRITICAL FIX**: Include session cookies
        body: formData // FormData sets Content-Type with boundary automatically
      });

      // **FIX**: Handle 401 authentication errors to prevent retry loops
      if (response.status === 401) {
        addLog('❌ Authentication expired - please log in again');
        return [];
      }

      const result = await response.json();
      
      // **DEBUG**: Verify server response structure
      console.log('🔍 DETECTION RESPONSE:', {
        status: response.status,
        hasPlayers: !!result.players,
        playerCount: result.players?.length || 0,
        firstPlayer: result.players?.[0] || null,
        fullResponse: result
      });
      
      // Process detected players - preserve server's coordinate structure
      const normalizedPlayers = (result.players || []).map((player: any, idx: number) => {
        // **ARCHITECT FIX**: Validate width/height exist and are > 0 before processing
        if (typeof player.width !== 'number' || typeof player.height !== 'number' ||
            player.width <= 0 || player.height <= 0) {
          console.warn('⚠️ SKIPPING invalid player - missing or zero width/height:', player);
          return null;
        }
        
        const clamp01 = (val: number) => Math.max(0, Math.min(1, val || 0));
        
        // Server sends x/y as topLeft, with explicit centerX/Y and topLeftX/Y
        // Preserve this structure without overwriting
        const topLeftX = player.topLeftX !== undefined ? clamp01(player.topLeftX) : clamp01(player.x);
        const topLeftY = player.topLeftY !== undefined ? clamp01(player.topLeftY) : clamp01(player.y);
        const width = clamp01(player.width);
        const height = clamp01(player.height);
        const centerX = player.centerX !== undefined ? clamp01(player.centerX) : clamp01(topLeftX + width / 2);
        const centerY = player.centerY !== undefined ? clamp01(player.centerY) : clamp01(topLeftY + height / 2);
        
        const normalized = {
          ...player,
          x: topLeftX, // Preserve topLeft as canonical x/y
          y: topLeftY,
          width,
          height,
          centerX,
          centerY,
          topLeftX,
          topLeftY,
          confidence: clamp01(player.confidence)
          // No description field - customers don't need to see player labels
        };
        
        // **DEBUG**: Log first normalized player
        if (idx === 0) {
          console.log('🔍 NORMALIZED PLAYER:', {
            raw: player,
            normalized,
            hasRequiredFields: !!(normalized.x >= 0 && normalized.y >= 0 && normalized.width > 0 && normalized.height > 0)
          });
        }
        
        return normalized;
      }).filter((p: any) => p !== null); // Remove any invalid players

      console.log('🔍 STATE UPDATE:', {
        playerCount: normalizedPlayers.length,
        willSetState: true
      });

      setWorkflow(prev => {
        const newState = {
          ...prev,
          detectedPlayers: normalizedPlayers,
          fallbackMode: result.fallbackMode || false,
          detectionMessage: result.message || null,
          debugData: {
            ...prev.debugData,
            lastDetection: {
              timestamp,
              playersFound: normalizedPlayers.length,
              fallbackMode: result.fallbackMode,
              apiResponse: result
            }
          }
        };
        
        console.log('🔍 NEW STATE:', {
          detectedPlayersLength: newState.detectedPlayers?.length || 0,
          firstPlayer: newState.detectedPlayers?.[0] || null
        });
        
        return newState;
      });
      
      // **CACHE RESULT**: Store for potential reuse
      detectionCacheRef.current = {
        timestamp: roundedTimestamp,
        players: normalizedPlayers
      };
      
      addLog(`Player detection: Found ${normalizedPlayers.length} players ${result.fallbackMode ? '(fallback mode)' : ''}`);
      
    } catch (error) {
      console.error('Player detection failed:', error);
      addLog(`Player detection error: ${error}`);
      setWorkflow(prev => ({
        ...prev,
        detectedPlayers: [],
        fallbackMode: true,
        detectionMessage: 'Network error. Click on the video to manually select a position.'
      }));
    }
  };

  // **RACE CONDITION GUARD**: Token to ensure only most recent selection updates state
  const selectionTokenRef = useRef(0);
  const lastResetPlayerIdRef = useRef<string | null>(null);

  const handlePlayerSelect = (player: any) => {
    // Generate unique token for this selection
    const currentToken = ++selectionTokenRef.current;
    
    console.log('🎯 handlePlayerSelect CALLED:', { 
      hasPlayer: !!player,
      playerType: typeof player,
      playerId: player?.id,
      playerKeys: player ? Object.keys(player) : [],
      selectionToken: currentToken,
      fullPlayerObject: player
    });
    
    // **CRITICAL FEEDBACK**: Show toast immediately when player selection happens
    toast({
      title: "🎯 Player Selected",
      description: player ? `Player ${player.id || 'unknown'} selected` : "Player deselected",
      duration: 2000,
    });
    
    if (!player) {
      console.log('⚠️ handlePlayerSelect: NULL player, clearing selection');
      lastResetPlayerIdRef.current = null; // Clear reset guard when deselecting
      setWorkflow(prev => ({
        ...prev,
        selectedPlayer: null,
        playerPosition: null,
        previewFrameDataUrl: null,
        // **ARCHITECT FIX**: Explicitly preserve timeSelection and detectionTime
        timeSelection: prev.timeSelection,
        detectionTime: prev.detectionTime
      }));
      return;
    }
    
    // **CRITICAL FIX**: Ensure player has id before creating safe player
    const playerWithId = {
      ...player,
      id: player.id || player.playerId || `player_${Date.now()}`,
    };
    
    // **CRITICAL FIX**: Reset backend tracking state when new player is selected
    // BUT ONLY on Timeline/Effects stages - NOT during Video Preview playback
    // Resetting during playback destroys the HighlightLock and breaks continuous tracking
    const isVideoPreviewStage = workflow.step === 'video-preview';
    const playerId = playerWithId.id;
    
    console.log('🔧 handlePlayerSelect: playerWithId created:', playerWithId);
    
    // **ARCHITECT PRESCRIBED FIX**: Store the sanitized safe player so useSpotlightTracker receives valid anchor
    const safePlayer = createSafePlayer(playerWithId);
    
    console.log('🔍 handlePlayerSelect: createSafePlayer result:', {
      success: !!safePlayer,
      safePlayer: safePlayer || 'NULL'
    });
    
    if (!safePlayer) {
      console.error('❌ CRITICAL: createSafePlayer rejected player object:', playerWithId);
      addLog('Error: Invalid player object, cannot select');
      return;
    }
    
    // **ARCHITECT FIX**: Sanitize player object with explicit numeric coercion
    // This prevents state corruption between stages by ensuring a clean, serializable object
    const sanitizedPlayer = {
      id: String(safePlayer.id),
      x: Number(safePlayer.x),
      y: Number(safePlayer.y),
      width: Number(safePlayer.width),
      height: Number(safePlayer.height),
      centerX: Number(safePlayer.centerX),
      centerY: Number(safePlayer.centerY),
      topLeftX: Number(safePlayer.topLeftX),
      topLeftY: Number(safePlayer.topLeftY),
      confidence: Number(safePlayer.confidence),
      description: String(safePlayer.description || safePlayer.id)
    };
    
    // **CRITICAL FIX**: Reset backend tracking with anchor coordinates
    // MUST happen AFTER sanitizedPlayer is created so we can send the coordinates
    const shouldReset = !isVideoPreviewStage && lastResetPlayerIdRef.current !== playerId;
    
    if (shouldReset) {
      lastResetPlayerIdRef.current = playerId;
      // Send FULL canonical player coordinates to backend (no re-normalization needed)
      fetch('/api/reset-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          videoId: workflow.sessionId,
          selectedPlayerId: sanitizedPlayer.id,
          anchorCoordinates: {
            x: sanitizedPlayer.x,
            y: sanitizedPlayer.y,
            width: sanitizedPlayer.width,
            height: sanitizedPlayer.height,
            centerX: sanitizedPlayer.centerX,
            centerY: sanitizedPlayer.centerY,
            topLeftX: sanitizedPlayer.topLeftX,
            topLeftY: sanitizedPlayer.topLeftY
          }
        })
      }).then(() => {
        console.log('✅ Backend tracking reset with FULL canonical coordinates:', { 
          playerId: sanitizedPlayer.id, 
          topLeft: `(${sanitizedPlayer.topLeftX.toFixed(3)}, ${sanitizedPlayer.topLeftY.toFixed(3)})`,
          center: `(${sanitizedPlayer.centerX.toFixed(3)}, ${sanitizedPlayer.centerY.toFixed(3)})`
        });
      }).catch((error) => {
        console.error('⚠️ Failed to reset tracking:', error);
      });
    } else if (isVideoPreviewStage) {
      console.log('⏭️ Skipping tracking reset - in Video Preview stage');
    } else {
      console.log('⏭️ Skipping tracking reset - same player selected');
    }
    
    const position = { x: sanitizedPlayer.x, y: sanitizedPlayer.y };
    
    console.log('✅ SANITIZED PLAYER for workflow state:', sanitizedPlayer);
    console.log('🔍 PLAYER ID TRACE:', {
      originalPlayerId: player.id,
      playerWithId: playerWithId.id,
      safePlayerId: safePlayer.id,
      sanitizedPlayerId: sanitizedPlayer.id,
      willSendToBackend: sanitizedPlayer.id
    });
    console.log('🚀 handlePlayerSelect: Setting workflow.selectedPlayer NOW');
    
    // **CRITICAL FIX**: Set detectionTime from cache when player is selected
    // This ensures Video Preview knows exactly when to activate the spotlight
    const detectionTimestamp = detectionCacheRef.current?.timestamp;
    
    setWorkflow(prev => ({
      ...prev,
      selectedPlayer: sanitizedPlayer, // Store clean sanitized player
      playerPosition: position,
      detectionTime: detectionTimestamp !== undefined ? detectionTimestamp : prev.detectionTime, // Use cache timestamp if available
      // **ARCHITECT FIX**: Explicitly preserve timeSelection to prevent state loss during tracker refreshes
      timeSelection: prev.timeSelection
    }));
    
    console.log('✅ handlePlayerSelect: workflow.selectedPlayer SET successfully', {
      detectionTime: detectionTimestamp,
      selectedPlayerType: typeof sanitizedPlayer,
      selectedPlayerKeys: Object.keys(sanitizedPlayer),
      selectedPlayerStringified: JSON.stringify(sanitizedPlayer)
    });
    addLog(`Player selected: ${sanitizedPlayer.description} (ID: ${sanitizedPlayer.id}) at (${sanitizedPlayer.x.toFixed(3)}, ${sanitizedPlayer.y.toFixed(3)}) - timestamp: ${detectionTimestamp?.toFixed(3) || 'N/A'}`);
  };

  const capturePreviewFrame = (frameDataUrl: string) => {
    setWorkflow(prev => ({
      ...prev,
      previewFrameDataUrl: frameDataUrl
    }));
    addLog('Preview frame captured for effects');
  };

  const handleEffectSelect = (effect: any, settings: any) => {
    setWorkflow(prev => ({
      ...prev,
      selectedEffect: { effect, settings }
    }));
    addLog(`Effect selected: ${effect.name} with settings: ${JSON.stringify(settings)}`);
  };

  const handleEffectConfirm = async () => {
    console.log('🚀🚀🚀 handleEffectConfirm CALLED AT START 🚀🚀🚀');
    console.log('🎬 handleEffectConfirm CALLED - Attempting navigation to video-preview stage');
    console.log('📋 Current workflow state:', {
      hasSelectedPlayer: !!workflow.selectedPlayer,
      selectedPlayerId: workflow.selectedPlayer?.id,
      hasDetectionCache: !!detectionCacheRef.current,
      currentStep: workflow.step,
      selectedEffect: workflow.selectedEffect,
      effectName: workflow.selectedEffect?.effect?.name,
      effectSettings: workflow.selectedEffect?.settings
    });
    
    // **VALIDATION**: Ensure effect is selected before proceeding
    if (!workflow.selectedEffect || !workflow.selectedEffect.effect) {
      toast({
        title: "Cannot Proceed",
        description: "Please select an effect before continuing to preview.",
        variant: "destructive"
      });
      addLog('❌ Cannot proceed to preview: No effect selected');
      return;
    }
    
    // **ARCHITECT FIX**: Gate navigation - validate player with fallback support
    if (!workflow.selectedPlayer) {
      toast({
        title: "Cannot Proceed",
        description: "Player selection is missing. Please go back to Timeline and select a player.",
        variant: "destructive"
      });
      addLog('ERROR: Cannot proceed to preview - no player selected');
      console.error('❌ Navigation blocked: selectedPlayer is missing');
      return;
    }
    
    const safePlayer = createSafePlayer(workflow.selectedPlayer);
    if (!safePlayer) {
      toast({
        title: "Cannot Proceed",
        description: "Player data is invalid. Please go back to Timeline and select a player again.",
        variant: "destructive"
      });
      addLog('ERROR: Cannot proceed to preview - invalid player data');
      console.error('❌ Navigation blocked: selectedPlayer failed validation:', workflow.selectedPlayer);
      return;
    }
    
    // **FIX**: Allow manual selections or validate against cache
    const isManualSelection = String(safePlayer.id) === 'manual_selection';
    
    if (!isManualSelection && detectionCacheRef.current) {
      // **AUTOMATED DETECTION PATH**: Validate player exists in detection cache
      const cacheHasMatchingPlayer = detectionCacheRef.current.players.some(
        (p: any) => String(p.id) === String(safePlayer.id)
      );
      
      if (!cacheHasMatchingPlayer) {
        toast({
          title: "Cannot Proceed",
          description: "Selected player not found in detection cache. Please go back to Timeline and select a player again.",
          variant: "destructive"
        });
        addLog('ERROR: Cannot proceed to preview - selected player not in detection cache');
        console.error('❌ Navigation blocked: selectedPlayer ID not found in cache:', {
          selectedId: String(safePlayer.id),
          cacheIds: detectionCacheRef.current.players.map((p: any) => String(p.id))
        });
        return;
      }
    } else if (isManualSelection) {
      // **MANUAL SELECTION PATH**: User clicked on video to select position
      console.log('⚠️  Navigation allowed for manual player selection (ID: manual_selection)');
      addLog('Proceeding with manual player selection');
    } else {
      // **NO CACHE PATH**: Detection may have failed or not run yet
      console.log('⚠️  Navigation allowed without cache validation (no detection cache)');
      addLog('Proceeding without detection validation');
    }
    
    console.log('✅ Navigation to preview allowed - player validated:', {
      id: safePlayer.id,
      hasCoordinates: !!(safePlayer.topLeftX !== undefined && safePlayer.centerX !== undefined),
      hasCache: !!detectionCacheRef.current,
      cacheTimestamp: detectionCacheRef.current?.timestamp,
      cachePlayerCount: detectionCacheRef.current?.players.length
    });
    
    // **DIAGNOSTIC**: Log complete effect_config at EFFECTS STAGE EXIT
    console.log('🎯 EFFECTS STAGE EXIT - Complete effect_config:', {
      selectedEffect: workflow.selectedEffect,
      effectType: workflow.selectedEffect?.effect?.id,
      effectName: workflow.selectedEffect?.effect?.name,
      settings: workflow.selectedEffect?.settings,
      settingsDetail: {
        intensity: workflow.selectedEffect?.settings?.intensity,
        size: workflow.selectedEffect?.settings?.size,
        color: workflow.selectedEffect?.settings?.color
      },
      timestamp: new Date().toISOString()
    });
    
    // **SUCCESS FEEDBACK**: Show toast only after ALL validation passes
    toast({
      title: "🎬 Navigating to Video Preview",
      description: "Loading preview with effects...",
      duration: 2000,
    });
    
    dashboardLogger.info('NAVIGATION: Effects → Video Preview', {
      currentStep: workflow.step,
      hasTimeSelection: !!workflow.timeSelection,
      hasSelectedPlayer: !!workflow.selectedPlayer,
      hasSelectedEffect: !!workflow.selectedEffect
    });
    
    // **CRITICAL FIX**: Initialize backend tracking with anchor coordinates BEFORE entering Video Preview
    // This ensures the backend knows exactly where the selected player is located
    // **RACE CONDITION FIX**: AWAIT the reset call so backend is ready before Video Preview renders
    console.log('🎯 INITIALIZING BACKEND TRACKING before Video Preview:', {
      playerId: workflow.selectedPlayer.id,
      x: workflow.selectedPlayer.x,
      y: workflow.selectedPlayer.y,
      centerX: workflow.selectedPlayer.centerX,
      centerY: workflow.selectedPlayer.centerY
    });
    
    try {
      await fetch('/api/reset-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          videoId: workflow.sessionId,
          selectedPlayerId: workflow.selectedPlayer.id,
          anchorCoordinates: {
            x: workflow.selectedPlayer.x,
            y: workflow.selectedPlayer.y,
            width: workflow.selectedPlayer.width,
            height: workflow.selectedPlayer.height,
            centerX: workflow.selectedPlayer.centerX,
            centerY: workflow.selectedPlayer.centerY
          }
        })
      });
      console.log('✅ Backend tracking initialized with anchor coordinates for Video Preview');
    } catch (error) {
      console.error('❌ Failed to initialize backend tracking:', error);
      toast({
        title: "Warning",
        description: "Failed to initialize tracking. Preview may show incorrect player.",
        variant: "destructive"
      });
    }
    
    console.log('🚀 CRITICAL: Changing workflow.step to "video-preview" NOW');
    setWorkflow(prev => {
      // **CRITICAL DEBUG**: Log timeSelection BEFORE transition
      const preState = {
        step: prev.step,
        timeSelection: prev.timeSelection,
        detectionTime: prev.detectionTime,
        hasTimeSelection: !!prev.timeSelection,
        timeSelectionStart: prev.timeSelection?.start,
        timeSelectionEnd: prev.timeSelection?.end
      };
      console.log('🔍 PRE-TRANSITION STATE:', preState);
      dashboardLogger.debug('Pre-transition state', preState);
      
      const nextState = {
        ...prev,
        step: 'video-preview' as const
      };
      
      // **DEBUG**: Log state snapshot after mutation to verify ALL critical data survives transition
      const postState = {
        step: nextState.step,
        timeSelection: nextState.timeSelection,
        detectionTime: nextState.detectionTime,
        hasTimeSelection: !!nextState.timeSelection,
        timeSelectionStart: nextState.timeSelection?.start,
        timeSelectionEnd: nextState.timeSelection?.end,
        hasSelectedEffect: !!nextState.selectedEffect,
        effectName: nextState.selectedEffect?.effect?.name,
        effectSettings: nextState.selectedEffect?.settings
      };
      console.log('📸 POST-TRANSITION STATE:', postState);
      dashboardLogger.info('State transition complete', postState);
      
      return nextState;
    });
    console.log('✅ CRITICAL: workflow.step changed to "video-preview" successfully');
    dashboardLogger.info('Navigation complete - Video Preview should now render');
    addLog('Effect confirmed, moving to video preview');
  };

  const handleVideoPreviewConfirm = () => {
    try {
      // **VALIDATION**: Check all prerequisites before allowing transition to processing
      if (!workflow.videoFile) {
        toast({
          title: "Cannot Start Processing",
          description: "Video file is missing. Please go back and re-upload your video.",
          variant: "destructive"
        });
        addLog('❌ Missing required data: videoFile');
        return;
      }
      
      if (!workflow.timeSelection) {
        toast({
          title: "Cannot Start Processing",
          description: "Time selection is missing. Please go back to Timeline stage.",
          variant: "destructive"
        });
        addLog('❌ Missing required data: timeSelection');
        return;
      }
      
      if (!workflow.selectedPlayer) {
        toast({
          title: "Cannot Start Processing",
          description: "Player selection is missing. Please go back to Timeline stage.",
          variant: "destructive"
        });
        addLog('❌ Missing required data: selectedPlayer');
        return;
      }
      
      if (!workflow.selectedEffect) {
        toast({
          title: "Cannot Start Processing",
          description: "Effect selection is missing. Please go back to Effects stage.",
          variant: "destructive"
        });
        addLog('❌ Missing required data: selectedEffect');
        return;
      }

      // **SAFE PLAYER BINDING**: Prevent ReferenceError by explicitly defining playerData variable
      const playerData = workflow.selectedPlayer ? createSafePlayer(workflow.selectedPlayer) : null;
      
      if (!playerData) {
        toast({
          title: "Cannot Start Processing",
          description: "Player data is invalid. Please go back to Timeline and select a player again.",
          variant: "destructive"
        });
        const errorMsg = 'Error: Cannot create safe player data - player selection invalid';
        addLog(errorMsg);
        console.error('❌ PLAYER VALIDATION FAILED:', workflow.selectedPlayer);
        return;
      }
      
      // **DEFENSIVE VALIDATION**: Ensure player data has required fields
      if (!playerData.id || typeof playerData.x !== 'number' || typeof playerData.y !== 'number') {
        toast({
          title: "Cannot Start Processing",
          description: "Player data is incomplete. Please go back to Timeline and select a player again.",
          variant: "destructive"
        });
        const errorMsg = 'Invalid player data - missing required fields (id, x, y)';
        addLog(errorMsg);
        console.error('❌ PLAYER DATA VALIDATION FAILED:', playerData);
        return;
      }

      // **SAFE JOB CONFIG**: Build config using explicit playerSelection (never selectedPlayer)
      const jobConfig = {
        sessionId: workflow.sessionId, // **CRITICAL**: Include sessionId for isolated tracking
        startTime: workflow.timeSelection.start,
        endTime: workflow.timeSelection.end,
        playerSelection: playerData, // **FIXED**: Use playerSelection instead of selectedPlayer
        effectConfig: {
          type: workflow.selectedEffect.effect.id || workflow.selectedEffect.effect,
        settings: workflow.selectedEffect.settings || {}
      },
      templateId: null,
      priority: 5
      };

      // **LOG SAFE DATA**: Never log bare selectedPlayer, use playerData instead
      console.log('✅ JOB CONFIG CREATED SAFELY:', {
        startTime: jobConfig.startTime,
        endTime: jobConfig.endTime,
        playerSelectionId: playerData.id,
        effectType: jobConfig.effectConfig.type
      });

      setWorkflow(prev => ({
        ...prev,
        step: 'processing',
        jobConfig
      }));
      
      addLog(`Starting video processing: ${workflow.timeSelection.start}s to ${workflow.timeSelection.end}s with player ${playerData.id}`);
      
    } catch (error) {
      // **ARCHITECT RECOMMENDED**: Catch ReferenceErrors and surface them
      const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 11)}`;
      const errorMsg = `Processing setup failed [${errorId}]: ${error instanceof Error ? error.message : String(error)}`;
      
      console.error('❌ PROCESSING SETUP ERROR:', {
        errorId,
        error,
        stack: error instanceof Error ? error.stack : undefined,
        workflowState: {
          hasVideoFile: !!workflow.videoFile,
          hasTimeSelection: !!workflow.timeSelection,
          hasSelectedPlayer: !!workflow.selectedPlayer,
          hasSelectedEffect: !!workflow.selectedEffect
        }
      });
      
      addLog(errorMsg);
      
      // **CLIENT ERROR REPORTING**: Report to server for visibility
      fetch('/api/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          route: window.location.pathname,
          action: 'video_processing_setup',
          timestamp: Date.now()
        })
      }).catch(reportError => {
        console.warn('Failed to report client error:', reportError);
      });
    }
  };

  const handleProcessingComplete = (jobId: string, downloadUrl?: string) => {
    setWorkflow(prev => ({
      ...prev,
      jobId,
      step: 'preview',
      processingProgress: 100
    }));
    addLog(`Video processing complete for job: ${jobId}`);
  };

  const handleProcessingProgress = (progress: number) => {
    setWorkflow(prev => ({
      ...prev,
      processingProgress: progress
    }));
  };

  const handleProcessingError = (error: string) => {
    addLog(`Processing error: ${error}`);
  };

  const handleRestart = () => {
    if (workflow.videoUrl) {
      URL.revokeObjectURL(workflow.videoUrl);
    }
    if (workflow.processedVideoBlob) {
      URL.revokeObjectURL(URL.createObjectURL(workflow.processedVideoBlob));
    }
    
    // **CRITICAL**: Clear session-scoped storage for OLD sessionId
    const oldSessionId = workflow.sessionId;
    if (oldSessionId) {
      clearSessionStorage(oldSessionId);
      console.log('🧹 Cleared session storage for old session:', oldSessionId);
    }
    
    // Clear global workflow storage
    sessionStorage.removeItem('creatorWorkflowState');
    
    // Clear refs
    detectionCacheRef.current = null;
    lastDetectedTimestampRef.current = -1;
    lastResetPlayerIdRef.current = null; // Clear reset guard for new session
    
    // **CRITICAL**: Generate NEW sessionId for fresh isolation
    const newSessionId = crypto.randomUUID();
    console.log('🆔 Created new session ID for fresh start:', newSessionId);
    
    // Dispatch sessionChanged event for any listening components
    window.dispatchEvent(new CustomEvent('sessionChanged', { 
      detail: { sessionId: newSessionId, previousSessionId: oldSessionId } 
    }));
    
    setWorkflow({
      step: 'upload',
      videoFile: null,
      videoUrl: null,
      sessionId: newSessionId, // **NEW**: Fresh sessionId for complete isolation
      timeSelection: null,
      playerPosition: null,
      selectedEffect: null,
      detectedPlayers: [],
      selectedPlayer: null, // **CRITICAL**: Must be null, never auto-hydrate
      fallbackMode: false,
      detectionMessage: null,
      previewFrameDataUrl: null,
      processedVideoBlob: null,
      processingProgress: 0,
      processingLogs: [],
      debugData: null
    });
    
    addLog('Workflow restarted with new session: ' + newSessionId);
  };

  const handleDownload = () => {
    if (workflow.processedVideoBlob) {
      const url = URL.createObjectURL(workflow.processedVideoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `highlight-creator-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog('Video downloaded');
    }
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setWorkflow(prev => ({
      ...prev,
      processingLogs: [...(prev.processingLogs || []), `[${timestamp}] ${message}`]
    }));
  };

  // Check for admin workflow data on component mount
  useEffect(() => {
    const adminWorkflowData = sessionStorage.getItem('adminWorkflowData');
    const adminVideoFile = (window as any).adminWorkflowVideoFile;
    
    if (adminWorkflowData && adminVideoFile) {
      try {
        const data = JSON.parse(adminWorkflowData);
        console.log('Loading admin workflow data:', data);
        
        setWorkflow(prev => ({
          ...prev,
          step: 'effects', // Skip directly to effects step since admin already configured everything
          videoFile: adminVideoFile,
          videoUrl: data.videoUrl,
          timeSelection: data.timeSelection,
          playerPosition: data.playerPosition,
          selectedEffect: data.selectedEffect || null,
          selectedPlayer: data.selectedPlayer || null,
          previewFrameDataUrl: data.previewFrameDataUrl,
          detectionTime: data.detectionTime || 0
        }));
        
        console.log('🔄 ADMIN WORKFLOW LOADED:', {
          step: 'effects',
          hasSelectedEffect: !!data.selectedEffect,
          selectedEffectValue: data.selectedEffect,
          hasSelectedPlayer: !!data.selectedPlayer
        });
        
        // Clear the stored data after loading
        sessionStorage.removeItem('adminWorkflowData');
        delete (window as any).adminWorkflowVideoFile;
        
        addLog('Admin workflow data loaded - proceeding to effects step');
      } catch (error) {
        console.error('Failed to load admin workflow data:', error);
        addLog('Failed to load admin workflow data');
      }
    }
  }, []);

  // **PERSISTENCE**: Hydrate workflow state from sessionStorage on mount
  useEffect(() => {
    const storedWorkflow = sessionStorage.getItem('creatorWorkflowState');
    if (storedWorkflow) {
      try {
        const parsed = JSON.parse(storedWorkflow);
        console.log('🔄 Hydrating workflow state from sessionStorage:', parsed);
        console.log('🔍 HYDRATED selectedPlayer:', {
          selectedPlayer: parsed.selectedPlayer,
          selectedPlayerType: typeof parsed.selectedPlayer,
          selectedPlayerKeys: parsed.selectedPlayer ? Object.keys(parsed.selectedPlayer) : [],
          selectedPlayerStringified: parsed.selectedPlayer ? JSON.stringify(parsed.selectedPlayer) : 'null'
        });
        
        // Only hydrate if we're not already loading admin workflow data
        const adminWorkflowData = sessionStorage.getItem('adminWorkflowData');
        if (!adminWorkflowData) {
          // **CRITICAL FIX**: If we're past upload step but have no video, reset to upload with selections preserved
          const needsVideoReupload = parsed.step !== 'upload';
          
          if (needsVideoReupload) {
            setWorkflow(prev => ({
              ...prev,
              ...parsed,
              step: 'upload', // Reset to upload step
              videoFile: null,
              videoUrl: null,
              processedVideoBlob: null,
              selectedPlayer: null, // **INVARIANT**: Never auto-hydrate player selection for new sessions
              detectedPlayers: [] // Clear detected players, must re-detect after upload
            }));
            addLog('⚠️ Session restored - please re-upload your video to continue');
            toast({
              title: "Session Restored",
              description: "Please re-upload your video and re-detect players.",
              variant: "default"
            });
          } else {
            setWorkflow(prev => ({
              ...prev,
              ...parsed,
              videoFile: null,
              videoUrl: null,
              processedVideoBlob: null,
              selectedPlayer: null, // **INVARIANT**: Never auto-hydrate player selection
              detectedPlayers: [] // Must re-detect after upload
            }));
            addLog('Workflow state restored from session - please re-detect players');
          }
        }
      } catch (error) {
        console.error('Failed to hydrate workflow state:', error);
      }
    }
  }, [toast]);

  // **PERSISTENCE**: Save workflow state to sessionStorage whenever it changes
  useEffect(() => {
    // Don't persist if we're still on initial upload step with no data
    if (workflow.step === 'upload' && !workflow.sessionId) {
      return;
    }

    // Create persistable version (exclude non-serializable fields like File, Blob, debugData)
    // Serialize selectedEffect minimally to avoid circular references from React components
    const serializableEffect = workflow.selectedEffect ? {
      effect: {
        id: workflow.selectedEffect.effect?.id,
        name: workflow.selectedEffect.effect?.name
      },
      settings: workflow.selectedEffect.settings
    } : null;

    const persistable = {
      step: workflow.step,
      sessionId: workflow.sessionId,
      timeSelection: workflow.timeSelection,
      detectionTime: workflow.detectionTime,
      playerPosition: workflow.playerPosition,
      selectedEffect: serializableEffect, // Minimal effect data only
      highlightId: workflow.highlightId,
      detectedPlayers: workflow.detectedPlayers,
      selectedPlayer: workflow.selectedPlayer,
      fallbackMode: workflow.fallbackMode,
      detectionMessage: workflow.detectionMessage,
      previewFrameDataUrl: workflow.previewFrameDataUrl,
      processingProgress: workflow.processingProgress,
      processingLogs: workflow.processingLogs,
      // debugData excluded - contains circular references (React FiberNode)
      jobConfig: workflow.jobConfig,
      jobId: workflow.jobId
    };

    try {
      sessionStorage.setItem('creatorWorkflowState', JSON.stringify(persistable));
      // **THROTTLED**: Session persistence logging (muted channel - won't display)
      throttledLog('session-persistence', '💾 Workflow state persisted', {
        selectedPlayer: persistable.selectedPlayer,
        selectedPlayerType: typeof persistable.selectedPlayer,
        selectedPlayerStringified: persistable.selectedPlayer ? JSON.stringify(persistable.selectedPlayer) : 'null'
      });
    } catch (error) {
      console.error('Failed to persist workflow state:', error);
    }
  }, [workflow]);

  const goBack = () => {
    const stepOrder = ['upload', 'timeline', 'effects', 'video-preview', 'processing', 'preview'];
    const currentIndex = stepOrder.indexOf(workflow.step);
    
    if (currentIndex > 0) {
      const previousStep = stepOrder[currentIndex - 1] as CreatorWorkflowState['step'];
      setWorkflow(prev => ({
        ...prev,
        step: previousStep
      }));
      addLog(`Navigated back to ${previousStep}`);
    }
  };

  const navigateToStep = (targetStep: CreatorWorkflowState['step']) => {
    const stepOrder = ['upload', 'timeline', 'effects', 'video-preview', 'processing', 'preview'];
    const currentIndex = stepOrder.indexOf(workflow.step);
    const targetIndex = stepOrder.indexOf(targetStep);
    
    // Only allow forward navigation or going back one step
    if (targetIndex <= currentIndex + 1) {
      setWorkflow(prev => ({
        ...prev,
        step: targetStep
      }));
      addLog(`Navigated to step: ${targetStep}`);
    } else {
      addLog(`Cannot navigate to ${targetStep}: steps must be completed in order`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" size="sm" data-testid="button-back-to-admin">
              <Link href="/admin">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Admin Dashboard
              </Link>
            </Button>
            <div className="text-sm text-muted-foreground">
              Creator Video Processing - {user.username} ({user.role})
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" data-testid="badge-workflow-step">
              Step: {workflow.step}
            </Badge>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRestart}
              data-testid="button-restart"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Restart
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="workflow" data-testid="tab-workflow">
              <Monitor className="w-4 h-4 mr-2" />
              Video Workflow
            </TabsTrigger>
            <TabsTrigger value="debug" data-testid="tab-debug">
              <Bug className="w-4 h-4 mr-2" />
              Debug Tools
            </TabsTrigger>
            <TabsTrigger value="logs" data-testid="tab-logs">
              <Activity className="w-4 h-4 mr-2" />
              Processing Logs
            </TabsTrigger>
          </TabsList>

          {/* Workflow Tab */}
          <TabsContent value="workflow" className="space-y-6">
            {/* Workflow Step Cards */}
            <div className="grid grid-cols-6 gap-3 mb-6">
              {['upload', 'timeline', 'effects', 'video-preview', 'processing', 'preview'].map((step, index) => {
                const stepOrder = ['upload', 'timeline', 'effects', 'video-preview', 'processing', 'preview'];
                const currentStepIndex = stepOrder.indexOf(workflow.step);
                const isCompleted = currentStepIndex > index;
                const isCurrent = workflow.step === step;
                
                const canNavigate = isCompleted || isCurrent;
                
                return (
                  <Card 
                    key={step} 
                    className={`p-3 text-center transition-colors ${
                      canNavigate ? 'cursor-pointer hover-elevate' : 'cursor-not-allowed opacity-50'
                    } ${
                      isCurrent ? 'border-primary bg-primary/5' : 
                      isCompleted ? 'bg-muted/50' : ''
                    }`}
                    onClick={() => canNavigate && navigateToStep(step as CreatorWorkflowState['step'])}
                    data-testid={`step-indicator-${step}`}
                  >
                    <div className="flex items-center justify-center gap-2 mb-2">
                      {isCurrent ? (
                        <Activity className="w-4 h-4 text-primary" />
                      ) : isCompleted ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground" />
                      )}
                    </div>
                    <div className="text-xs font-medium">
                      {step === 'video-preview' ? 'Video Preview' : step.charAt(0).toUpperCase() + step.slice(1)}
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Step Content */}
            {workflow.step === 'upload' && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Upload Video for Testing</h3>
                <VideoUpload onVideoSelect={handleVideoSelect} />
              </Card>
            )}

            {workflow.step === 'timeline' && workflow.videoUrl && (
              <StageErrorBoundary stageName="Timeline" onRetry={() => setWorkflow(prev => ({ ...prev, step: 'upload' }))}>
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Select Clip & Player</h3>
                  {(!workflow.selectedPlayer || !workflow.timeSelection) && (
                    <Alert className="mb-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {!workflow.timeSelection && "Select a time range for your clip. "}
                        {!workflow.selectedPlayer && "Detect and select a player before continuing."}
                      </AlertDescription>
                    </Alert>
                  )}
                  <CombinedClipPlayer
                    videoUrl={workflow.videoUrl}
                    sessionId={workflow.sessionId}
                    onTimeSelection={handleTimeSelection}
                    onDetectPlayers={handleFrameCapture}
                    onPlayerSelect={handlePlayerSelect}
                    onCaptureFrame={capturePreviewFrame}
                    onConfirm={handleTimelineConfirm}
                    onBack={goBack}
                    detectedPlayers={workflow.detectedPlayers || []}
                    selectedPlayer={workflow.selectedPlayer}
                    fallbackMode={workflow.fallbackMode}
                    detectionMessage={workflow.detectionMessage || undefined}
                    initialDetectionTime={workflow.detectionTime} // **FIX**: Pass clicked timeline moment for initialization
                  />
                </Card>
              </StageErrorBoundary>
            )}

            {workflow.step === 'effects' && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Choose Effect & Settings</h3>
                {!workflow.selectedEffect && (
                  <Alert className="mb-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Select an effect and configure its settings before continuing to preview.
                    </AlertDescription>
                  </Alert>
                )}
                <HighlightEffects 
                  onEffectSelect={handleEffectSelect}
                  onConfirm={handleEffectConfirm}
                  onBack={goBack}
                  timeSelection={workflow.timeSelection || undefined}
                  previewFrameDataUrl={workflow.previewFrameDataUrl || undefined}
                  selectedPlayer={workflow.selectedPlayer || null}
                />
              </Card>
            )}

            {(() => {
              const isVideoPreview = workflow.step === 'video-preview';
              console.log('🔍 VIDEO PREVIEW STAGE CHECK:', {
                currentStep: workflow.step,
                isVideoPreview,
                hasTimeSelection: !!workflow.timeSelection,
                timeSelection: workflow.timeSelection,
                hasSelectedPlayer: !!workflow.selectedPlayer,
                selectedPlayerId: workflow.selectedPlayer?.id,
                hasVideoUrl: !!workflow.videoUrl
              });
              if (isVideoPreview) {
                dashboardLogger.info('RENDER CHECK: Video Preview stage is rendering', {
                  hasTimeSelection: !!workflow.timeSelection,
                  hasSelectedPlayer: !!workflow.selectedPlayer,
                  hasVideoUrl: !!workflow.videoUrl
                });
              }
              return isVideoPreview;
            })() && (
              <StageErrorBoundary stageName="Video Preview" onRetry={() => setWorkflow(prev => ({ ...prev, step: 'effects' }))}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold">Live Video Preview</h2>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={goBack} data-testid="button-back">
                        Back
                      </Button>
                      <Button onClick={handleVideoPreviewConfirm} data-testid="button-confirm">
                        Confirm & Process
                      </Button>
                    </div>
                  </div>
                  
                  {/* **CRITICAL VALIDATION**: Ensure timeSelection exists before rendering VideoPreviewPlayer */}
                  {!workflow.timeSelection || workflow.timeSelection.start === undefined || workflow.timeSelection.end === undefined ? (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Time selection is missing. Please go back to Timeline and select a time range.
                      </AlertDescription>
                      <Button variant="outline" onClick={() => setWorkflow(prev => ({ ...prev, step: 'timeline' }))} className="mt-2">
                        Return to Timeline
                      </Button>
                    </Alert>
                  ) : (
                    <>
                      {(() => {
                        console.log('🎬 RENDERING VideoPreviewPlayer with props:', {
                          timeSelection: workflow.timeSelection,
                          detectionTime: workflow.detectionTime,
                          absoluteTimeCalculation: workflow.detectionTime ?? workflow.timeSelection.start,
                          hasSelectedPlayer: !!workflow.selectedPlayer,
                          selectedPlayerId: workflow.selectedPlayer?.id,
                          '🔍 CRITICAL - workflow.selectedPlayer ALL COORDS': workflow.selectedPlayer ? {
                            id: workflow.selectedPlayer.id,
                            x: workflow.selectedPlayer.x,
                            y: workflow.selectedPlayer.y,
                            centerX: workflow.selectedPlayer.centerX,
                            centerY: workflow.selectedPlayer.centerY,
                            topLeftX: workflow.selectedPlayer.topLeftX,
                            topLeftY: workflow.selectedPlayer.topLeftY,
                            width: workflow.selectedPlayer.width,
                            height: workflow.selectedPlayer.height
                          } : 'NULL'
                        });
                        return null;
                      })()}
                      <VideoPreviewErrorBoundary onReset={() => setWorkflow(prev => ({ ...prev, step: 'effects' }))}>
                        <VideoPreviewPlayer
                          key={workflow.sessionId || 'video-preview'}
                          videoUrl={workflow.videoUrl || ''}
                          videoId={workflow.sessionId || undefined}
                          selectedPlayer={workflow.selectedPlayer!}
                          timeSelection={workflow.timeSelection}
                          selectedEffect={{
                            effect: workflow.selectedEffect?.effect || { name: 'spotlight', description: 'Spotlight Effect' },
                            settings: workflow.selectedEffect?.settings || { intensity: 30, size: 80, color: '#3b82f6' }
                          }}
                          detectionTime={workflow.detectionTime ?? workflow.timeSelection.start}
                          timelineDetectionCache={detectionCacheRef.current}
                          onBack={goBack}
                          onConfirm={handleVideoPreviewConfirm}
                        />
                      </VideoPreviewErrorBoundary>
                    </>
                  )}
                </div>
              </StageErrorBoundary>
            )}

            {workflow.step === 'processing' && workflow.videoFile && workflow.jobConfig && (
              <ProcessingWorkflow
                videoFile={workflow.videoFile}
                jobConfig={workflow.jobConfig}
                autoStart={true}
                onComplete={handleProcessingComplete}
                onCancel={() => {
                  setWorkflow(prev => ({ ...prev, step: 'video-preview' }));
                  addLog('Processing cancelled, returning to video preview');
                }}
                className="space-y-6"
              />
            )}

            {workflow.step === 'preview' && workflow.jobId && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4 text-center">🎉 Highlight Complete!</h3>
                <div className="text-center space-y-6">
                  <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20 p-6 rounded-lg">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-600" />
                    <h4 className="font-semibold text-lg mb-2">Your highlight video is ready!</h4>
                    <p className="text-muted-foreground mb-4">
                      Job ID: <Badge variant="secondary">{workflow.jobId}</Badge>
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                      <Button 
                        onClick={async () => {
                          try {
                            const response = await fetch(`/api/jobs/${workflow.jobId}/download`, {
                              credentials: 'include'
                            });
                            const data = await response.json();
                            
                            if (data.downloadUrl) {
                              const a = document.createElement('a');
                              a.href = data.downloadUrl;
                              a.download = data.filename || `klutch-highlight-${workflow.jobId}.mp4`;
                              a.click();
                              addLog('Video downloaded successfully');
                            }
                          } catch (error) {
                            addLog(`Download error: ${error}`);
                          }
                        }}
                        data-testid="button-download-completed"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download Video
                      </Button>
                      
                      <Button 
                        variant="outline"
                        onClick={() => {
                          if (navigator.share) {
                            navigator.share({
                              title: 'My Klutch Sports Highlight',
                              text: 'Check out my amazing sports highlight created with Klutch AI!',
                              url: window.location.href
                            });
                          }
                          addLog('Share attempted');
                        }}
                        data-testid="button-share-completed"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Share
                      </Button>
                    </div>
                  </div>
                  
                  <div className="border-t pt-6">
                    <p className="text-sm text-muted-foreground mb-4">
                      Want to create another highlight?
                    </p>
                    <Button 
                      variant="outline"
                      onClick={handleRestart}
                      data-testid="button-restart-workflow"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Start New Highlight
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* Debug Tab */}
          <TabsContent value="debug" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Current State */}
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Current State</h3>
                <div className="space-y-2 text-sm">
                  <div><strong>Step:</strong> {workflow.step}</div>
                  <div><strong>Video:</strong> {workflow.videoFile?.name || 'None'}</div>
                  <div><strong>Time Selection:</strong> {workflow.timeSelection ? 
                    `${workflow.timeSelection.start}s - ${workflow.timeSelection.end}s` : 'None'}</div>
                  <div><strong>Player Position:</strong> {workflow.playerPosition ? 
                    `(${workflow.playerPosition.x.toFixed(3)}, ${workflow.playerPosition.y.toFixed(3)})` : 'None'}</div>
                  <div><strong>Selected Effect:</strong> {workflow.selectedEffect?.effect?.name || 'None'}</div>
                  <div><strong>Detected Players:</strong> {workflow.detectedPlayers?.length || 0}</div>
                  <div><strong>Fallback Mode:</strong> {workflow.fallbackMode ? 'Yes' : 'No'}</div>
                  <div><strong>Processing Progress:</strong> {workflow.processingProgress || 0}%</div>
                </div>
              </Card>

              {/* Player Detection Data */}
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Player Detection</h3>
                {workflow.detectedPlayers && workflow.detectedPlayers.length > 0 ? (
                  <div className="space-y-2 text-sm max-h-64 overflow-y-auto">
                    {workflow.detectedPlayers.map((player, index) => (
                      <div key={index} className="p-2 bg-muted rounded">
                        <div><strong>{player.description}</strong></div>
                        <div>Center: ({player.centerX?.toFixed(3)}, {player.centerY?.toFixed(3)})</div>
                        <div>Size: {player.width?.toFixed(3)} × {player.height?.toFixed(3)}</div>
                        <div>Confidence: {(player.confidence * 100)?.toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">No players detected yet</div>
                )}
              </Card>

              {/* Debug Data */}
              {workflow.debugData && (
                <Card className="p-6 md:col-span-2">
                  <h3 className="text-lg font-semibold mb-4">Raw Debug Data</h3>
                  <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-64">
                    {JSON.stringify(workflow.debugData, null, 2)}
                  </pre>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="space-y-6">
            <Card className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Processing Logs</h3>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setWorkflow(prev => ({ ...prev, processingLogs: [] }))}
                  data-testid="button-clear-logs"
                >
                  Clear Logs
                </Button>
              </div>
              <div className="bg-muted p-4 rounded max-h-96 overflow-y-auto">
                {workflow.processingLogs && workflow.processingLogs.length > 0 ? (
                  <div className="font-mono text-sm space-y-1">
                    {workflow.processingLogs.map((log, index) => (
                      <div key={index} className="text-muted-foreground">
                        {log}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">No logs yet</div>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}