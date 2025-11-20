import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import VideoPreviewPlayer from "@/components/VideoPreviewPlayer";
import VideoEffectsCompositor from "@/components/VideoEffectsCompositor";
import VideoPreview from "@/components/VideoPreview";
import ProcessingWorkflow from "@/components/ProcessingWorkflow";

// Workflow state types for creator dashboard
interface CreatorWorkflowState {
  step: 'upload' | 'timeline' | 'effects' | 'video-preview' | 'processing' | 'preview';
  videoFile: File | null;
  videoUrl: string | null;
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
  const [activeTab, setActiveTab] = useState("workflow");
  const [workflow, setWorkflow] = useState<CreatorWorkflowState>({
    step: 'upload',
    videoFile: null,
    videoUrl: null,
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
  const handleVideoSelect = (file: File) => {
    const url = URL.createObjectURL(file);
    setWorkflow(prev => ({
      ...prev,
      videoFile: file,
      videoUrl: url,
      step: 'timeline',
      processingLogs: [...(prev.processingLogs || []), `Video uploaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`]
    }));
    addLog(`Video uploaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  };

  const handleTimeSelection = (start: number, end: number, detectionTime: number) => {
    setWorkflow(prev => ({
      ...prev,
      timeSelection: { start, end },
      detectionTime
    }));
    addLog(`Time selection: ${start}s - ${end}s, detection at ${detectionTime}s`);
  };

  const handleTimelineConfirm = () => {
    // First ensure we have the necessary data for effects preview
    if (!workflow.selectedPlayer) {
      addLog('Cannot proceed to effects: No player selected');
      return;
    }
    
    setWorkflow(prev => ({
      ...prev,
      step: 'effects'
    }));
    addLog('Timeline confirmed, moving to effects selection');
  };

  const handleFrameCapture = async (frameDataUrl: string, timestamp: number) => {
    try {
      addLog(`Capturing frame at ${timestamp.toFixed(2)}s for player detection`);
      
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // **CRITICAL FIX**: Include session cookies
        body: JSON.stringify({
          imageDataUrl: frameDataUrl,
          timestampMs: Math.round(timestamp * 1000),
          videoId: workflow.videoFile?.name || 'creator-test'
        })
      });

      // **FIX**: Handle 401 authentication errors to prevent retry loops
      if (response.status === 401) {
        addLog('❌ Authentication expired - please log in again');
        return [];
      }

      const result = await response.json();
      
      // Process detected players
      const normalizedPlayers = (result.players || []).map((player: any) => {
        const clamp01 = (val: number) => Math.max(0, Math.min(1, val || 0));
        
        const centerX = player.centerX !== undefined ? clamp01(player.centerX) : clamp01(player.x);
        const centerY = player.centerY !== undefined ? clamp01(player.centerY) : clamp01(player.y);
        const topLeftX = player.topLeftX !== undefined ? clamp01(player.topLeftX) : clamp01(centerX - player.width / 2);
        const topLeftY = player.topLeftY !== undefined ? clamp01(player.topLeftY) : clamp01(centerY - player.height / 2);
        
        return {
          ...player,
          x: centerX,
          y: centerY,
          width: clamp01(player.width),
          height: clamp01(player.height),
          centerX,
          centerY,
          topLeftX,
          topLeftY,
          confidence: clamp01(player.confidence)
          // No description field - customers don't need to see player labels
        };
      });

      setWorkflow(prev => ({
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
      }));
      
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

  const handlePlayerSelect = (player: any) => {
    if (!player) {
      setWorkflow(prev => ({
        ...prev,
        selectedPlayer: null,
        playerPosition: null,
        previewFrameDataUrl: null
      }));
      return;
    }
    
    const position = { x: player.x, y: player.y };
    
    // **FIX**: Ensure selectedPlayer always has an id field for video processing
    const selectedPlayerWithId = {
      ...player,
      id: player.id || player.playerId || `player_${Date.now()}`, // Fallback ID if none exists
    };
    
    setWorkflow(prev => ({
      ...prev,
      selectedPlayer: selectedPlayerWithId,
      playerPosition: position
    }));
    addLog(`Player selected: ${selectedPlayerWithId.description} (ID: ${selectedPlayerWithId.id}) at (${player.x.toFixed(3)}, ${player.y.toFixed(3)})`);
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

  const handleEffectConfirm = () => {
    setWorkflow(prev => ({
      ...prev,
      step: 'video-preview'
    }));
    addLog('Effect confirmed, moving to video preview');
  };

  const handleVideoPreviewConfirm = () => {
    try {
      // **ARCHITECT RECOMMENDED FIX**: Explicit safe player validation and job config creation
      if (!workflow.videoFile || !workflow.timeSelection || !workflow.selectedPlayer || !workflow.selectedEffect) {
        addLog('Missing required data for processing');
        return;
      }

      // **SAFE PLAYER BINDING**: Prevent ReferenceError by explicitly defining playerData variable
      const playerData = workflow.selectedPlayer ? createSafePlayer(workflow.selectedPlayer) : null;
      
      if (!playerData) {
        const errorMsg = 'Error: Cannot create safe player data - player selection invalid';
        addLog(errorMsg);
        console.error('❌ PLAYER VALIDATION FAILED:', workflow.selectedPlayer);
        return;
      }
      
      // **DEFENSIVE VALIDATION**: Ensure player data has required fields
      if (!playerData.id || typeof playerData.x !== 'number' || typeof playerData.y !== 'number') {
        const errorMsg = 'Invalid player data - missing required fields (id, x, y)';
        addLog(errorMsg);
        console.error('❌ PLAYER DATA VALIDATION FAILED:', playerData);
        return;
      }

      // **SAFE JOB CONFIG**: Build config using explicit playerSelection (never selectedPlayer)
      const jobConfig = {
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
    
    setWorkflow({
      step: 'upload',
      videoFile: null,
      videoUrl: null,
      timeSelection: null,
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
    addLog('Workflow restarted');
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
          selectedEffect: data.selectedEffect,
          selectedPlayer: data.selectedPlayer,
          previewFrameDataUrl: data.previewFrameDataUrl,
          detectionTime: data.detectionTime || 0
        }));
        
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
                
                return (
                  <Card key={step} className={`p-3 text-center cursor-pointer transition-colors ${
                    isCurrent ? 'border-primary bg-primary/5' : 
                    isCompleted ? 'bg-muted/50' : ''
                  }`}>
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
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Select Clip & Player</h3>
                <CombinedClipPlayer
                  videoUrl={workflow.videoUrl}
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
                />
              </Card>
            )}

            {workflow.step === 'effects' && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Choose Effect & Settings</h3>
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

            {workflow.step === 'video-preview' && workflow.videoUrl && workflow.selectedEffect && workflow.selectedPlayer && workflow.timeSelection && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Live Video Preview</h3>
                <VideoPreviewPlayer
                  key={`${workflow.videoUrl}-${workflow.timeSelection?.start}-${workflow.selectedPlayer?.id || 'none'}`}
                  videoUrl={workflow.videoUrl}
                  timeSelection={workflow.timeSelection}
                  selectedPlayer={workflow.selectedPlayer}
                  selectedEffect={workflow.selectedEffect}
                  detectionTime={workflow.detectionTime || 0}
                  onBack={goBack}
                  onConfirm={handleVideoPreviewConfirm}
                  onSettingsChange={(newSettings) => {
                    setWorkflow(prev => ({
                      ...prev,
                      selectedEffect: {
                        ...prev.selectedEffect!,
                        settings: newSettings
                      }
                    }));
                    addLog(`Effect settings updated: ${JSON.stringify(newSettings)}`);
                  }}
                />
              </Card>
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