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
  RefreshCw
} from "lucide-react";
import { Link } from "wouter";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';

// Import existing workflow components
import VideoUpload from "@/components/VideoUpload";
import CombinedClipPlayer from "@/components/CombinedClipPlayer";
import HighlightEffects from "@/components/HighlightEffects";
import VideoEffectsCompositor from "@/components/VideoEffectsCompositor";
import VideoPreview from "@/components/VideoPreview";

// Workflow state types (extended for admin features)
interface AdminWorkflowState {
  step: 'upload' | 'timeline' | 'effects' | 'processing' | 'preview';
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
}

export default function AdminDashboard() {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("workflow");
  const [workflow, setWorkflow] = useState<AdminWorkflowState>({
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
            Please log in to access the admin dashboard.
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
    setWorkflow(prev => ({
      ...prev,
      step: 'effects'
    }));
    addLog('Timeline confirmed, moving to effects selection');
  };

  const handleFrameCapture = async (frameBlob: Blob, timestamp: number) => {
    try {
      addLog(`Capturing frame at ${timestamp.toFixed(2)}s for player detection`);
      
      // **ZERO-LAG FIX**: Send FormData with Blob to trigger direct Replicate SDK path
      const formData = new FormData();
      formData.append('frame', frameBlob, 'frame.jpg');
      formData.append('timestampMs', Math.round(timestamp * 1000).toString());
      formData.append('videoId', workflow.videoFile?.name || 'admin-test');
      formData.append('detectionMethod', 'replicate'); // Use direct Replicate YOLOv11 GPU
      
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        credentials: 'include',
        body: formData // FormData sets Content-Type with boundary automatically
      });

      const result = await response.json();
      
      // **DEBUG**: Log the entire API response to see structure
      console.log('🔍 API RESPONSE RECEIVED:', {
        hasResult: !!result,
        resultKeys: result ? Object.keys(result) : [],
        hasPlayers: !!result.players,
        playersType: Array.isArray(result.players) ? 'array' : typeof result.players,
        playersLength: result.players?.length,
        fullResult: result
      });
      
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
          confidence: clamp01(player.confidence),
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
    
    const safePlayer = createSafePlayer(player);
    if (!safePlayer) {
      console.warn('Invalid player object received in handlePlayerSelect');
      return;
    }
    
    const position = getSafeCoordinates(safePlayer);
    setWorkflow(prev => ({
      ...prev,
      selectedPlayer: safePlayer,
      playerPosition: position
    }));
    addLog(`Player selected: ${safePlayer.description} at (${safePlayer.x.toFixed(3)}, ${safePlayer.y.toFixed(3)})`);
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
      step: 'processing'
    }));
    addLog('Effect confirmed, starting video processing');
  };

  const handleProcessingComplete = (processedVideoBlob: Blob) => {
    setWorkflow(prev => ({
      ...prev,
      processedVideoBlob,
      step: 'preview',
      processingProgress: 100
    }));
    addLog(`Video processing complete: ${(processedVideoBlob.size / 1024 / 1024).toFixed(1)}MB`);
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
      a.download = `highlight-${Date.now()}.mp4`;
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

  const goBack = () => {
    const stepOrder = ['upload', 'timeline', 'effects', 'processing', 'preview'];
    const currentIndex = stepOrder.indexOf(workflow.step);
    
    if (currentIndex > 0) {
      const previousStep = stepOrder[currentIndex - 1] as AdminWorkflowState['step'];
      setWorkflow(prev => ({ ...prev, step: previousStep }));
      addLog(`Navigated back to ${previousStep}`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to App
              </Link>
            </Button>
            <div className="text-lg font-display font-bold">
              Admin Creator Dashboard
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="secondary">
              {user.username} ({user.role})
            </Badge>
            <Badge variant={workflow.step === 'preview' ? 'default' : 'outline'}>
              {workflow.step}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="workflow" data-testid="tab-workflow">
              <Upload className="w-4 h-4 mr-2" />
              Video Workflow
            </TabsTrigger>
            <TabsTrigger value="debug" data-testid="tab-debug">
              <Settings className="w-4 h-4 mr-2" />
              Debug Data
            </TabsTrigger>
            <TabsTrigger value="logs" data-testid="tab-logs">
              <FileText className="w-4 h-4 mr-2" />
              Processing Logs
            </TabsTrigger>
            <TabsTrigger value="metrics" data-testid="tab-metrics">
              <BarChart3 className="w-4 h-4 mr-2" />
              Performance
            </TabsTrigger>
          </TabsList>

          {/* Video Workflow Tab */}
          <TabsContent value="workflow" className="space-y-6">
            {/* Progress Indicator */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Workflow Progress</h3>
                <Button 
                  onClick={handleRestart} 
                  variant="outline" 
                  size="sm"
                  data-testid="button-restart-workflow"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Restart
                </Button>
              </div>
              <div className="flex items-center gap-2 mb-2">
                {['upload', 'timeline', 'effects', 'processing', 'preview'].map((step, index) => {
                  const stepOrder = ['upload', 'timeline', 'effects', 'processing', 'preview'];
                  const currentIndex = stepOrder.indexOf(workflow.step);
                  const isActive = step === workflow.step;
                  const isCompleted = index < currentIndex;
                  
                  return (
                    <div key={step} className="flex items-center">
                      <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2
                        ${isActive ? 'border-primary bg-primary text-primary-foreground' : 
                          isCompleted ? 'border-green-500 bg-green-500 text-white' : 
                          'border-muted bg-muted text-muted-foreground'}
                      `}>
                        {isCompleted ? <CheckCircle className="w-4 h-4" /> : index + 1}
                      </div>
                      {index < 4 && (
                        <div className={`w-8 h-0.5 ${isCompleted ? 'bg-green-500' : 'bg-muted'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">
                Step {['upload', 'timeline', 'effects', 'processing', 'preview'].indexOf(workflow.step) + 1} of 5: {workflow.step.charAt(0).toUpperCase() + workflow.step.slice(1)}
              </p>
            </Card>

            {/* Step Content */}
            {workflow.step === 'upload' && (
              <VideoUpload onVideoSelect={handleVideoSelect} />
            )}

            {workflow.step === 'timeline' && (
              <CombinedClipPlayer
                videoUrl={workflow.videoUrl || undefined}
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
            )}

            {workflow.step === 'effects' && (
              <HighlightEffects 
                onEffectSelect={handleEffectSelect}
                onConfirm={handleEffectConfirm}
                onBack={goBack}
                previewFrameDataUrl={workflow.previewFrameDataUrl || undefined}
                selectedPlayer={workflow.selectedPlayer || null}
              />
            )}

            {workflow.step === 'processing' && (
              <Card className="p-6">
                <div className="mb-6">
                  <h3 className="text-xl font-semibold mb-2">Processing Video</h3>
                  <p className="text-muted-foreground">
                    Applying {workflow.selectedEffect?.effect?.name} effect to your highlight...
                  </p>
                </div>

                {workflow.videoFile && workflow.selectedEffect && workflow.playerPosition && workflow.timeSelection && (
                  <VideoEffectsCompositor
                    videoFile={workflow.videoFile}
                    effect={workflow.selectedEffect.effect}
                    settings={workflow.selectedEffect.settings}
                    playerPosition={workflow.playerPosition}
                    selectedPlayer={workflow.selectedPlayer}
                    timeSelection={workflow.timeSelection}
                    detectionTime={workflow.detectionTime || 0}
                    onProcessingComplete={handleProcessingComplete}
                    onProgress={handleProcessingProgress}
                    onError={handleProcessingError}
                  />
                )}

                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Processing Progress</span>
                    <span className="text-sm text-muted-foreground">{workflow.processingProgress}%</span>
                  </div>
                  <Progress value={workflow.processingProgress} className="h-2" />
                </div>

                <div className="flex gap-2 mt-4">
                  <Button onClick={goBack} variant="outline">
                    Back
                  </Button>
                </div>
              </Card>
            )}

            {workflow.step === 'preview' && workflow.processedVideoBlob && (
              <Card className="p-6">
                <div className="mb-6">
                  <h3 className="text-xl font-semibold mb-2">Final Preview</h3>
                  <p className="text-muted-foreground">
                    Your highlight is ready! Preview the final result and download.
                  </p>
                </div>

                <VideoPreview
                  videoUrl={URL.createObjectURL(workflow.processedVideoBlob)}
                  highlightEffect={workflow.selectedEffect?.effect}
                  effectSettings={workflow.selectedEffect?.settings}
                  playerPosition={workflow.playerPosition || undefined}
                  selectedPlayer={workflow.selectedPlayer}
                  onDownload={handleDownload}
                  onRestart={handleRestart}
                />

                <div className="flex gap-2 mt-6">
                  <Button onClick={handleDownload} data-testid="button-download-video">
                    <Download className="w-4 h-4 mr-2" />
                    Download Video
                  </Button>
                  <Button onClick={goBack} variant="outline">
                    Back to Effects
                  </Button>
                  <Button onClick={handleRestart} variant="outline">
                    Start New Video
                  </Button>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* Debug Data Tab */}
          <TabsContent value="debug" className="space-y-4">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Debug Information</h3>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-3">Workflow State</h4>
                  <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-auto max-h-96">
                    <pre>{JSON.stringify({
                      step: workflow.step,
                      hasVideo: !!workflow.videoFile,
                      timeSelection: workflow.timeSelection,
                      playerPosition: workflow.playerPosition,
                      selectedEffect: workflow.selectedEffect?.effect?.name,
                      detectedPlayers: workflow.detectedPlayers?.length,
                      fallbackMode: workflow.fallbackMode
                    }, null, 2)}</pre>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-3">Detection Data</h4>
                  <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-auto max-h-96">
                    <pre>{JSON.stringify(workflow.debugData || {}, null, 2)}</pre>
                  </div>
                </div>
              </div>

              {workflow.detectedPlayers && workflow.detectedPlayers.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-medium mb-3">Detected Players</h4>
                  <div className="space-y-2">
                    {workflow.detectedPlayers.map((player, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div>
                          <p className="font-medium text-sm">{player.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Position: ({player.x.toFixed(3)}, {player.y.toFixed(3)}) | 
                            Size: {player.width.toFixed(3)}×{player.height.toFixed(3)} | 
                            Confidence: {(player.confidence * 100).toFixed(1)}%
                          </p>
                        </div>
                        <Badge variant={player === workflow.selectedPlayer ? 'default' : 'outline'}>
                          {player === workflow.selectedPlayer ? 'Selected' : 'Available'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Processing Logs Tab */}
          <TabsContent value="logs" className="space-y-4">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Processing Logs</h3>
                <Badge variant="outline">
                  {workflow.processingLogs?.length || 0} entries
                </Badge>
              </div>
              
              <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm max-h-96 overflow-auto">
                {workflow.processingLogs && workflow.processingLogs.length > 0 ? (
                  workflow.processingLogs.map((log, index) => (
                    <div key={index} className="mb-1">
                      {log}
                    </div>
                  ))
                ) : (
                  <div className="text-muted-foreground">No logs available</div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Performance Metrics Tab */}
          <TabsContent value="metrics" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Upload className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Video Size</p>
                    <p className="text-lg font-bold">
                      {workflow.videoFile ? (workflow.videoFile.size / 1024 / 1024).toFixed(1) + 'MB' : 'N/A'}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <Eye className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Players Detected</p>
                    <p className="text-lg font-bold">
                      {workflow.detectedPlayers?.length || 0}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <Play className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Processing Progress</p>
                    <p className="text-lg font-bold">
                      {workflow.processingProgress}%
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">System Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium mb-2">Browser</p>
                  <p className="text-sm text-muted-foreground">{navigator.userAgent}</p>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Screen Resolution</p>
                  <p className="text-sm text-muted-foreground">
                    {screen.width}×{screen.height}
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}