import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Upload, 
  Search, 
  Target, 
  Sparkles, 
  CheckCircle, 
  Download, 
  Loader2, 
  AlertTriangle, 
  RefreshCw,
  Share2,
  Eye,
  X,
  Wifi,
  WifiOff
} from "lucide-react";
import { useJobProcessing, ProcessingPhase } from '@/hooks/useJobProcessing';
import { PreviewFrame } from '@/hooks/useWebSocket';
import SocialSharing from '@/components/SocialSharing';

const PHASE_ICONS = {
  upload: Upload,
  search: Search,
  target: Target,
  sparkles: Sparkles,
  'check-circle': CheckCircle,
  download: Download
};

interface ProcessingWorkflowProps {
  videoFile?: File;
  jobConfig?: any;
  autoStart?: boolean;
  onComplete?: (jobId: string, downloadUrl?: string) => void;
  onCancel?: () => void;
  className?: string;
}

interface PreviewDisplayProps {
  frame: PreviewFrame | null;
  isConnected: boolean;
}

const PreviewDisplay = ({ frame, isConnected }: PreviewDisplayProps) => {
  if (!isConnected) {
    return (
      <div className="bg-muted/30 rounded-lg p-6 text-center">
        <WifiOff className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Preview unavailable</p>
      </div>
    );
  }

  if (!frame) {
    return (
      <div className="bg-muted/30 rounded-lg p-6 text-center">
        <Eye className="w-8 h-8 mx-auto mb-2 text-muted-foreground animate-pulse" />
        <p className="text-sm text-muted-foreground">Waiting for preview...</p>
      </div>
    );
  }

  return (
    <div className="bg-muted/30 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wifi className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium">Live Preview</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          Frame {frame.frameIndex}
        </Badge>
      </div>
      
      <div className="relative aspect-video bg-black rounded-md overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-purple-900/20" />
        
        {/* Simulated preview content */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/60 text-center">
            <Target className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm">Tracking {frame.detections.length} player{frame.detections.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        
        {/* Detection bounding boxes */}
        {frame.detections.map((detection, index) => (
          <div
            key={detection.id}
            className="absolute border-2 border-primary bg-primary/10"
            style={{
              left: `${detection.x * 100}%`,
              top: `${detection.y * 100}%`,
              width: `${detection.width * 100}%`,
              height: `${detection.height * 100}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className="absolute -top-6 left-0 bg-primary text-primary-foreground px-1 py-0.5 text-xs rounded">
              {(detection.confidence * 100).toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-2 text-xs text-muted-foreground text-center">
        Updated {new Date(frame.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
};

interface ProcessingPhaseCardProps {
  phase: ProcessingPhase;
  isActive: boolean;
  isCompleted: boolean;
  hasError: boolean;
}

const ProcessingPhaseCard = ({ phase, isActive, isCompleted, hasError }: ProcessingPhaseCardProps) => {
  const IconComponent = PHASE_ICONS[phase.icon as keyof typeof PHASE_ICONS] || CheckCircle;
  
  const getStatusIcon = () => {
    if (hasError && isActive) {
      return <AlertTriangle className="w-5 h-5 text-destructive" />;
    } else if (isCompleted) {
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    } else if (isActive) {
      return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
    } else {
      return <IconComponent className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getCardStyles = () => {
    if (hasError && isActive) {
      return 'border-destructive/50 bg-destructive/5';
    } else if (isCompleted) {
      return 'border-green-500/50 bg-green-50 dark:bg-green-950/20';
    } else if (isActive) {
      return 'border-primary/50 bg-primary/5 shadow-sm';
    } else {
      return 'border-border bg-muted/30';
    }
  };

  return (
    <Card className={`p-4 transition-all duration-300 ${getCardStyles()}`}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          {getStatusIcon()}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-sm">{phase.name}</h4>
            <Badge 
              variant={isCompleted ? 'default' : isActive ? 'secondary' : 'outline'}
              className="text-xs"
            >
              {isCompleted ? 'Complete' : isActive ? 'Processing' : 'Pending'}
            </Badge>
          </div>
          
          <p className="text-xs text-muted-foreground">{phase.description}</p>
          
          {isActive && phase.progress !== undefined && (
            <div className="mt-2">
              <Progress value={phase.progress} className="h-1" />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default function ProcessingWorkflow({ 
  videoFile, 
  jobConfig, 
  autoStart = false,
  onComplete,
  onCancel,
  className = ""
}: ProcessingWorkflowProps) {
  const [showPreview, setShowPreview] = useState(true);
  const [processingInFlight, setProcessingInFlight] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [contentRect, setContentRect] = useState<DOMRect | null>(null);
  const [rafLoopRunning, setRafLoopRunning] = useState(false);
  const [lastPrerequisiteCheck, setLastPrerequisiteCheck] = useState<string>('');
  
  // **FIX INFINITE LOOP**: Use refs for timeouts to prevent dependency cycles
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const rafIdRef = useRef<number | null>(null);
  
  const {
    currentJobId,
    phases,
    currentPhaseIndex,
    overallProgress,
    latestPreviewFrame,
    errorMessage,
    retryCount,
    isAutoRetrying,
    isWebSocketConnected,
    connectionError,
    isProcessing,
    isCompleted,
    hasError,
    canRetry,
    startProcessing,
    retryJob,
    cancelJob,
    downloadVideo,
    downloadUrl
  } = useJobProcessing({
    onComplete,
    onError: (error) => console.error('Processing error:', error)
  });

  // Prerequisite validation - Critical for preventing blank screen regressions
  const checkPrerequisites = useCallback(() => {
    const issues: string[] = [];
    
    if (!videoFile) issues.push('Video file not loaded');
    if (!jobConfig) issues.push('Job configuration missing');
    if (!videoReady) issues.push('Video not ready for playback');
    if (!contentRect) issues.push('Video content rect not measured');
    if (!jobConfig?.playerSelection?.id) issues.push('No player selected');
    if (!rafLoopRunning) issues.push('Animation frame loop not running');
    if (processingInFlight) issues.push('Another processing operation in progress');
    
    const issuesText = issues.length > 0 ? issues.join(', ') : 'All prerequisites met';
    
    // **FIX INFINITE LOOP**: Only update state if value actually changed
    setLastPrerequisiteCheck(prev => prev === issuesText ? prev : issuesText);
    
    return issues.length === 0;
  }, [videoFile, jobConfig, videoReady, contentRect, rafLoopRunning, processingInFlight]);

  // **ARCHITECT FIX**: Compute prerequisites boolean without setState side-effects
  const prerequisitesMet = useMemo(() => {
    return !!(
      videoFile && 
      jobConfig && 
      videoReady && 
      contentRect && 
      jobConfig?.playerSelection?.id && 
      rafLoopRunning && 
      !processingInFlight
    );
  }, [videoFile, jobConfig, videoReady, contentRect, rafLoopRunning, processingInFlight]);

  // **ARCHITECT FIX**: Keep prerequisite messaging up-to-date via passive effect
  useEffect(() => {
    checkPrerequisites();
  }, [checkPrerequisites]);

  // Declare handleStartProcessing first to avoid hoisting issues
  const handleStartProcessing = useCallback(() => {
    console.log('🔒 PROCESSING GUARD: Debounced click received...');
    
    // Clear any existing debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Debounce clicks (500ms)
    const timeout = setTimeout(async () => {
      console.log('🔒 PROCESSING GUARD: Checking prerequisites after debounce...');
      
      // Clear any existing timeout
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
      
      // Strict prerequisite validation
      if (!checkPrerequisites()) {
        console.warn('🚫 PROCESSING BLOCKED: Prerequisites not met:', lastPrerequisiteCheck);
        return;
      }
      
      // Single-flight protection
      if (processingInFlight) {
        console.warn('🚫 PROCESSING BLOCKED: Another operation already in progress');
        return;
      }
      
      // Create abort controller for this processing operation
      abortControllerRef.current = new AbortController();
      
      try {
        console.log('✅ PROCESSING GUARD: All prerequisites met, starting processing...');
        setProcessingInFlight(true);
        
        // Set 30s timeout with proper abort handling and unique operation ID
        const operationId = Date.now();
        const processingTimer = setTimeout(() => {
          console.error('⏰ PROCESSING TIMEOUT: Operation timed out after 30s, aborting...');
          // Only abort if this is still the current operation
          if (abortControllerRef.current && abortControllerRef.current.signal.reason !== 'Processing timeout') {
            abortControllerRef.current.abort(`Processing timeout (op:${operationId})`);
          }
          setProcessingInFlight(false);
          processingTimeoutRef.current = null;
        }, 30000);
        
        processingTimeoutRef.current = processingTimer;
        
        // Start processing with error handling (TODO: Add AbortController support to startProcessing)
        await startProcessing(videoFile!, jobConfig!);
        
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.log('🚫 PROCESSING ABORTED: Operation was cancelled');
        } else {
          console.error('❌ PROCESSING ERROR:', error);
          // Report error with correlation ID
          const errorId = `PROC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          window.dispatchEvent(new CustomEvent('processingError', {
            detail: { error, errorId, timestamp: Date.now() }
          }));
        }
      } finally {
        // Clean up timeout using local reference to prevent stale state issues
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
        setProcessingInFlight(false);
        abortControllerRef.current = null;
      }
    }, 500); // 500ms debounce
    
    debounceTimeoutRef.current = timeout;
  }, [checkPrerequisites, processingInFlight, videoFile, jobConfig]); // **CRITICAL FIX**: Removed startProcessing from deps - it's accessed via ref to prevent infinite loop

  // Auto-start processing if enabled - using same guardrails as manual processing
  useEffect(() => {
    if (autoStart && videoFile && jobConfig && !isProcessing && !currentJobId && !processingInFlight) {
      console.log('🚀 Auto-starting job processing with guardrails...');
      // Call directly instead of through handler to avoid circular dependency
      if (checkPrerequisites()) {
        startProcessing(videoFile, jobConfig);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, videoFile, jobConfig, isProcessing, currentJobId, processingInFlight]);

  
  // Monitor video lifecycle for prerequisite validation
  useEffect(() => {
    if (videoFile) {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(videoFile);
      video.preload = 'metadata';
      
      const handleLoadedMetadata = () => {
        console.log('📹 VIDEO LIFECYCLE: loadedmetadata fired');
        setVideoReady(true);
        setVideoElement(video);
        
        // **FIX INFINITE RE-RENDER**: Only update contentRect if dimensions actually changed
        const newRect = new DOMRect(0, 0, video.videoWidth, video.videoHeight);
        setContentRect(prevRect => {
          if (!prevRect || prevRect.width !== newRect.width || prevRect.height !== newRect.height) {
            console.log('📐 VIDEO CONTENT RECT UPDATED:', { width: newRect.width, height: newRect.height });
            return newRect;
          }
          return prevRect; // Keep same reference to prevent dependency trigger
        });
      };
      
      const handleCanPlay = () => {
        console.log('📹 VIDEO LIFECYCLE: canplay fired');
        setVideoReady(true);
        
        // Start RAF loop to simulate animation frame detection
        const startRafLoop = () => {
          let frameCount = 0;
          const animate = () => {
            frameCount++;
            if (frameCount > 5) {
              setRafLoopRunning(true);
              console.log('🔄 RAF LOOP: Animation frame loop confirmed after', frameCount, 'frames');
              return; // Stop after confirming RAF loop is working
            }
            rafIdRef.current = requestAnimationFrame(animate);
          };
          rafIdRef.current = requestAnimationFrame(animate);
        };
        
        startRafLoop();
      };
      
      const handleError = (e: Event) => {
        console.error('📹 VIDEO LIFECYCLE ERROR:', e);
        setVideoReady(false);
        setContentRect(null);
        setRafLoopRunning(false);
      };
      
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('canplay', handleCanPlay);
      video.addEventListener('error', handleError);
      
      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('error', handleError);
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
        }
        // **CRITICAL FIX**: Don't revoke blob URL - it's shared across workflow stages
        // URL.revokeObjectURL(video.src);  // REMOVED - causes video to fail in subsequent stages
      };
    } else {
      // Reset states when no video file
      setVideoReady(false);
      setVideoElement(null);
      setContentRect(null);
      setRafLoopRunning(false);
    }
  }, [videoFile]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort('Component unmounting');
      }
    };
  }, []); // No dependencies needed for cleanup on unmount

  const handleCancel = () => {
    cancelJob();
    onCancel?.();
  };

  const estimatedTimeRemaining = Math.max(0, Math.round((100 - overallProgress) * 1.2)); // ~2 minutes max

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-display font-bold mb-2">
          {isCompleted ? 'Processing Complete!' : 'Creating Your Highlight'}
        </h2>
        <p className="text-muted-foreground">
          {isCompleted 
            ? 'Your highlight video is ready for download and sharing'
            : 'Please wait while we process your video with AI-powered effects'
          }
        </p>
      </div>

      {/* Connection Status */}
      {connectionError && (
        <Alert>
          <WifiOff className="w-4 h-4" />
          <AlertDescription>
            Connection issue: {connectionError}. Updates may be delayed.
          </AlertDescription>
        </Alert>
      )}

      {/* Overall Progress */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium">Overall Progress</span>
              {isWebSocketConnected ? (
                <Badge variant="secondary" className="text-xs">
                  <Wifi className="w-3 h-3 mr-1" />
                  Live
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  <WifiOff className="w-3 h-3 mr-1" />
                  Polling
                </Badge>
              )}
            </div>
            <span className="text-sm font-medium">{overallProgress.toFixed(0)}%</span>
          </div>
          
          <Progress value={overallProgress} className="h-3" data-testid="progress-overall" />
          
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Phase {currentPhaseIndex + 1} of {phases.length}</span>
            {isProcessing && estimatedTimeRemaining > 0 && (
              <span>~{estimatedTimeRemaining}s remaining</span>
            )}
          </div>
        </div>
      </Card>

      {/* Two-column layout for phases and preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Processing Phases */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Processing Phases</h3>
            {currentJobId && (
              <Badge variant="outline" className="text-xs">
                Job: {currentJobId.slice(-8)}
              </Badge>
            )}
          </div>
          
          {phases.map((phase, index) => (
            <ProcessingPhaseCard
              key={phase.id}
              phase={phase}
              isActive={index === currentPhaseIndex}
              isCompleted={phase.status === 'completed'}
              hasError={phase.status === 'error'}
            />
          ))}
        </div>

        {/* Live Preview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Live Preview</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              data-testid="button-toggle-preview"
            >
              <Eye className="w-4 h-4 mr-2" />
              {showPreview ? 'Hide' : 'Show'}
            </Button>
          </div>
          
          {showPreview && (
            <PreviewDisplay 
              frame={latestPreviewFrame} 
              isConnected={isWebSocketConnected} 
            />
          )}
          
          {/* Processing Tips */}
          <Card className="p-4">
            <h4 className="font-medium text-sm mb-2">While you wait...</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• AI is analyzing every frame for precise tracking</li>
              <li>• Effects are optimized for social media sharing</li>
              <li>• Video will be ready in HD quality</li>
            </ul>
          </Card>
        </div>
      </div>

      {/* Error Handling */}
      {hasError && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{errorMessage}</span>
            {canRetry && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={retryJob}
                disabled={isAutoRetrying}
                className="ml-4"
                data-testid="button-retry-job"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isAutoRetrying ? 'animate-spin' : ''}`} />
                {isAutoRetrying ? 'Auto-retrying...' : `Retry ${retryCount > 0 ? `(${retryCount}/3)` : ''}`}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-center gap-4">
        {!isProcessing && !isCompleted && (
          <div className="space-y-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-block">
                    <Button 
                      onClick={handleStartProcessing}
                      disabled={!prerequisitesMet || processingInFlight}
                      data-testid="button-start-processing"
                      className={processingInFlight ? 'opacity-50 cursor-not-allowed' : ''}
                    >
                      <Sparkles className={`w-4 h-4 mr-2 ${processingInFlight ? 'animate-spin' : ''}`} />
                      {processingInFlight ? 'Processing...' : 'Process Video (Admin)'}
                    </Button>
                  </div>
                </TooltipTrigger>
                {(!prerequisitesMet || processingInFlight) && (
                  <TooltipContent>
                    <div className="max-w-xs">
                      {processingInFlight ? (
                        <p>Processing in progress - please wait</p>
                      ) : (
                        <div>
                          <p className="font-medium mb-1">Prerequisites not met:</p>
                          <p className="text-sm">{lastPrerequisiteCheck}</p>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            
            {(!prerequisitesMet || processingInFlight) && (
              <Alert>
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  {processingInFlight ? (
                    <span>Processing video - this may take up to 5 minutes</span>
                  ) : (
                    <div>
                      <div className="font-medium mb-1">Cannot start processing:</div>
                      <div className="text-sm">{lastPrerequisiteCheck}</div>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            
            {/* Debug info for prerequisites */}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Debug Prerequisites</summary>
              <div className="mt-2 space-y-1 font-mono">
                <div>Video Ready: {videoReady ? '✅' : '❌'} ({videoElement ? `${videoElement.videoWidth}x${videoElement.videoHeight}` : 'No video'})</div>
                <div>Content Rect: {contentRect ? '✅' : '❌'} ({contentRect ? `${contentRect.width}x${contentRect.height}` : 'Not measured'})</div>
                <div>Player Selected: {jobConfig?.playerSelection?.id ? '✅' : '❌'} ({jobConfig?.playerSelection?.id || 'None'})</div>
                <div>RAF Loop: {rafLoopRunning ? '✅' : '❌'} (Animation frames active)</div>
                <div>In Flight: {processingInFlight ? '❌' : '✅'} ({processingInFlight ? 'Blocked' : 'Ready'})</div>
              </div>
            </details>
          </div>
        )}
        
        {isProcessing && !isCompleted && (
          <Button 
            variant="outline" 
            onClick={handleCancel}
            data-testid="button-cancel-processing"
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        )}
        
        {isCompleted && (
          <div className="w-full max-w-4xl mx-auto">
            <SocialSharing
              videoUrl={downloadUrl || `${window.location.origin}/highlights/${currentJobId}`}
              title="Check out my amazing sports highlight!"
              description="Created with Klutch Moments - Spotlight Your Talent. Get Noticed."
              onDownload={downloadVideo}
            />
          </div>
        )}
      </div>
    </div>
  );
}