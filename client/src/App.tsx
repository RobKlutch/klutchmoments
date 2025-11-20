import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import ErrorBoundary from "@/components/ErrorBoundary";

// Components
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import WorkflowSteps from "@/components/WorkflowSteps";
import VideoUpload from "@/components/VideoUpload";
import CombinedClipPlayer from "@/components/CombinedClipPlayer";
import HighlightEffects from "@/components/HighlightEffects";
import VideoPreviewPlayer from "@/components/VideoPreviewPlayer";
import SocialShowcase from "@/components/SocialShowcase";
import Pricing from "@/components/Pricing";
import AuthPage from "@/pages/auth-page";
import ResetPasswordPage from "@/pages/reset-password-page";
import NotFound from "@/pages/not-found";
import AdminDashboard from "@/pages/admin-page";
import CreatorDashboard from "@/pages/creator-dashboard";
import Footer from "@/components/Footer";
import EffectTestPage from "@/components/EffectTestPage";
import { safeGet, createSafePlayer, hasValidPlayer, getSafeCoordinates, getSafeId } from '@/utils/safePlayerAccess';

// Workflow state types
interface WorkflowState {
  step: 'hero' | 'upload' | 'timeline' | 'effects' | 'video-preview' | 'processing' | 'preview';
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
}

function AppContent() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [workflow, setWorkflow] = useState<WorkflowState>({
    step: 'hero',
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
    processingLogs: []
  });

  // Check if current user is admin
  const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

  const handleThemeToggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleVideoSelect = (file: File) => {
    const url = URL.createObjectURL(file);
    setWorkflow(prev => ({
      ...prev,
      videoFile: file,
      videoUrl: url,
      step: 'timeline'
    }));
    console.log('Video uploaded, moving to timeline step');
  };

  const handleTimeSelection = (start: number, end: number, detectionTime: number) => {
    setWorkflow(prev => ({
      ...prev,
      timeSelection: { start, end },
      detectionTime
    }));
  };

  const handleTimelineConfirm = () => {
    setWorkflow(prev => ({
      ...prev,
      step: 'effects'
    }));
    console.log('Combined clip and player selection confirmed, moving to effects');
  };

  const handleFrameCapture = async (frameDataUrl: string, timestamp: number) => {
    try {
      const response = await fetch('/api/detect-players', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          imageDataUrl: frameDataUrl,
          timestampMs: Math.round(timestamp * 1000), // Convert seconds to milliseconds  
          videoId: workflow.videoFile?.name || 'tracking-video'
        })
      });

      const result = await response.json();
      
      // **CANONICAL COORDINATES FIX**: Use server-provided coordinates directly when available
      const normalizedPlayers = (result.players || []).map((player: any) => {
        // Server now provides canonical coordinates - use them directly when available
        const clamp01 = (val: number) => Math.max(0, Math.min(1, val || 0));
        
        // Use canonical coordinates from server, fallback to legacy x/y for compatibility  
        const centerX = player.centerX !== undefined ? clamp01(player.centerX) : clamp01(player.x);
        const centerY = player.centerY !== undefined ? clamp01(player.centerY) : clamp01(player.y);
        const topLeftX = player.topLeftX !== undefined ? clamp01(player.topLeftX) : clamp01(centerX - player.width / 2);
        const topLeftY = player.topLeftY !== undefined ? clamp01(player.topLeftY) : clamp01(centerY - player.height / 2);
        
        return {
          ...player,
          // Ensure all coordinate fields are present and clamped
          x: centerX, // Keep backward compatibility
          y: centerY, // Keep backward compatibility  
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

      console.log('🔧 COORDINATE FIX: Normalized', normalizedPlayers.length, 'detections');
      normalizedPlayers.forEach((player: any, i: number) => {
        console.log(`  Player ${i}: center(${player.centerX.toFixed(3)}, ${player.centerY.toFixed(3)}) topLeft(${player.topLeftX.toFixed(3)}, ${player.topLeftY.toFixed(3)})`);
      });

      setWorkflow(prev => ({
        ...prev,
        detectedPlayers: normalizedPlayers,
        fallbackMode: result.fallbackMode || false,
        detectionMessage: result.message || null
      }));
      
      if (result.fallbackMode) {
        console.log('AI detection unavailable, fallback mode active:', result.message);
      } else {
        console.log('Detected players:', normalizedPlayers.length);
      }
    } catch (error) {
      console.error('Player detection failed:', error);
      // Set fallback mode on network errors too
      setWorkflow(prev => ({
        ...prev,
        detectedPlayers: [],
        fallbackMode: true,
        detectionMessage: 'Network error. Click on the video to manually select a position.'
      }));
    }
  };

  const handlePlayerSelect = (player: any) => {
    console.log('App.handlePlayerSelect called with player:', player);
    
    if (!player) {
      console.log('Player is null, clearing selection');
      setWorkflow(prev => ({
        ...prev,
        selectedPlayer: null,
        playerPosition: null,
        previewFrameDataUrl: null
      }));
      return;
    }
    
    const position = { x: player.x, y: player.y };
    console.log('Setting player position:', position);
    
    setWorkflow(prev => ({
      ...prev,
      selectedPlayer: player,
      playerPosition: position
    }));
  };

  const capturePreviewFrame = (frameDataUrl: string) => {
    console.log('Capturing preview frame for effects step');
    setWorkflow(prev => ({
      ...prev,
      previewFrameDataUrl: frameDataUrl
    }));
  };


  const handleEffectSelect = (effect: any, settings: any) => {
    setWorkflow(prev => ({
      ...prev,
      selectedEffect: { effect, settings }
    }));
  };

  const handleEffectConfirm = () => {
    // Move to video preview step instead of directly to checkout
    setWorkflow(prev => ({
      ...prev,
      step: 'video-preview'
    }));
    console.log('Effect confirmed, moving to video preview');
  };

  const handleVideoPreviewConfirm = async () => {
    console.log('Video preview confirmed - checking user role');
    console.log('- videoFile:', !!workflow.videoFile);
    console.log('- timeSelection:', workflow.timeSelection);
    console.log('- playerPosition:', workflow.playerPosition);
    console.log('- selectedEffect:', workflow.selectedEffect);
    console.log('- previewFrame:', !!workflow.previewFrameDataUrl);
    console.log('- isAdmin:', isAdmin);
    
    if (!workflow.videoFile || !workflow.timeSelection || !workflow.playerPosition || !workflow.selectedEffect) {
      console.error('Missing required workflow data for processing');
      console.error('- Missing videoFile:', !workflow.videoFile);
      console.error('- Missing timeSelection:', !workflow.timeSelection);
      console.error('- Missing playerPosition:', !workflow.playerPosition);
      console.error('- Missing selectedEffect:', !workflow.selectedEffect);
      return;
    }

    if (isAdmin) {
      console.log('Admin user detected - redirecting to creator dashboard for video processing');
      // Store workflow data in sessionStorage for the creator dashboard to pick up
      // Note: File objects can't be serialized, so we'll pass the URL and other data
      // Create completely clean objects with only primitive values to avoid circular references
      
      try {
        const adminData = {
          videoUrl: workflow.videoUrl || null,
          timeSelection: workflow.timeSelection ? {
            start: Number(workflow.timeSelection.start),
            end: Number(workflow.timeSelection.end)
          } : null,
          playerPosition: workflow.playerPosition ? {
            x: Number(workflow.playerPosition.x),
            y: Number(workflow.playerPosition.y)
          } : null,
          selectedEffect: workflow.selectedEffect ? {
            effect: String(workflow.selectedEffect.effect),
            settings: workflow.selectedEffect.settings ? {
              intensity: Number(workflow.selectedEffect.settings.intensity || 20),
              size: Number(workflow.selectedEffect.settings.size || 50),
              color: String(workflow.selectedEffect.settings.color || '#3b82f6')
            } : null
          } : null,
          selectedPlayer: createSafePlayer(workflow.selectedPlayer),
          previewFrameDataUrl: workflow.previewFrameDataUrl || null,
          detectionTime: Number(workflow.detectionTime || 0),
          hasVideoFile: Boolean(workflow.videoFile)
        };
        
        sessionStorage.setItem('adminWorkflowData', JSON.stringify(adminData));
        console.log('Admin data safely stored:', adminData);
      } catch (error) {
        console.error('Error storing admin workflow data:', error);
        alert('Error processing admin data. Please try again.');
        return;
      }
      
      // Store the file separately in a global variable that the creator dashboard can access
      if (workflow.videoFile) {
        (window as any).adminWorkflowVideoFile = workflow.videoFile;
      }
      
      // Redirect to admin creator dashboard
      window.location.href = '/admin/creator';
    } else {
      // Regular user - show checkout flow
      console.log('Regular user - ready for checkout');
      alert('Ready for checkout! Payment integration would be implemented here.');
    }
  };

  const handleRestart = () => {
    // Clean up URLs to prevent memory leaks
    if (workflow.videoUrl) {
      URL.revokeObjectURL(workflow.videoUrl);
    }
    if (workflow.processedVideoBlob) {
      URL.revokeObjectURL(URL.createObjectURL(workflow.processedVideoBlob));
    }
    
    setWorkflow({
      step: 'hero',
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
      processingLogs: []
    });
    console.log('Workflow restarted');
  };

  // Navigation functions for bidirectional workflow
  const navigateToStep = (targetStep: WorkflowState['step']) => {
    setWorkflow(prev => ({
      ...prev,
      step: targetStep
    }));
    console.log('Navigated to step:', targetStep);
  };

  const canNavigateToStep = (targetStep: string): boolean => {
    // Users can navigate to any previous step or current step
    const stepOrder = ['hero', 'upload', 'timeline', 'effects', 'video-preview', 'processing', 'preview'];
    const currentIndex = stepOrder.indexOf(workflow.step);
    const targetIndex = stepOrder.indexOf(targetStep);
    
    // Can navigate to any completed step (targetIndex <= currentIndex)
    // But prevent going to future steps that haven't been reached
    return targetIndex <= currentIndex && targetIndex >= 0;
  };

  const goBack = () => {
    const stepOrder = ['hero', 'upload', 'timeline', 'effects', 'video-preview', 'processing', 'preview'];
    const currentIndex = stepOrder.indexOf(workflow.step);
    
    if (currentIndex > 0) {
      const previousStep = stepOrder[currentIndex - 1] as WorkflowState['step'];
      navigateToStep(previousStep);
    }
  };

  // **ARCHITECT RECOMMENDED**: Global error handlers for client-side ReferenceErrors
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 11)}`;
      
      console.error('🔴 GLOBAL ERROR CAUGHT:', {
        errorId,
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });

      // Report ReferenceErrors specifically (like "selectedPlayer is not defined")
      if (event.message?.includes('is not defined') || event.error?.name === 'ReferenceError') {
        fetch('/api/error-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            errorId,
            message: event.message,
            stack: event.error?.stack,
            filename: event.filename,
            line: event.lineno,
            column: event.colno,
            route: window.location.pathname,
            action: 'global_error_handler',
            timestamp: Date.now()
          })
        }).catch(err => console.warn('Failed to report global error:', err));
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const errorId = `REJ_${Date.now()}_${Math.random().toString(36).substr(2, 11)}`;
      
      console.error('🔴 UNHANDLED PROMISE REJECTION:', {
        errorId,
        reason: event.reason,
        stack: event.reason?.stack
      });

      fetch('/api/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorId,
          message: `Unhandled Promise Rejection: ${event.reason}`,
          stack: event.reason?.stack,
          route: window.location.pathname,
          action: 'unhandled_rejection',
          timestamp: Date.now()
        })
      }).catch(err => console.warn('Failed to report unhandled rejection:', err));
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header 
        onThemeToggle={handleThemeToggle} 
        isDark={theme === 'dark'} 
      />
      
      <main>
        {workflow.step === 'hero' && (
          <div>
            <Hero />
            <section id="upload-section" className="py-16 px-4">
              <div className="container max-w-4xl mx-auto">
                <WorkflowSteps 
                  currentStep="upload" 
                  onStepClick={navigateToStep}
                  canNavigateToStep={canNavigateToStep}
                />
                <VideoUpload onVideoSelect={handleVideoSelect} />
              </div>
            </section>
            <SocialShowcase />
          </div>
        )}

        {workflow.step === 'timeline' && (
          <section className="py-16 px-4">
            <div className="container max-w-4xl mx-auto">
              <WorkflowSteps 
                currentStep="timeline" 
                onStepClick={navigateToStep}
                canNavigateToStep={canNavigateToStep}
              />
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
            </div>
          </section>
        )}


        {workflow.step === 'effects' && (
          <section className="py-16 px-4">
            <div className="container max-w-6xl mx-auto">
              <WorkflowSteps 
                currentStep="effects" 
                onStepClick={navigateToStep}
                canNavigateToStep={canNavigateToStep}
              />
              <HighlightEffects 
                onEffectSelect={handleEffectSelect}
                onConfirm={handleEffectConfirm}
                onBack={goBack}
                previewFrameDataUrl={workflow.previewFrameDataUrl || undefined}
                selectedPlayer={workflow.selectedPlayer || null}
                timeSelection={workflow.timeSelection || undefined}
              />
            </div>
          </section>
        )}

        {workflow.step === 'video-preview' && workflow.videoUrl && workflow.selectedEffect && workflow.selectedPlayer && workflow.timeSelection && (
          <section className="py-16 px-4">
            <div className="container max-w-6xl mx-auto">
              <WorkflowSteps 
                currentStep="video-preview" 
                onStepClick={navigateToStep}
                canNavigateToStep={canNavigateToStep}
              />
              <VideoPreviewPlayer
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
                }}
              />
            </div>
          </section>
        )}

      </main>
      <Footer />
    </div>
  );
}

// Global error capture component
function GlobalErrorCapture() {
  useEffect(() => {
    // Generate correlation ID for this session
    const sessionId = `SESSION_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    (window as any).sessionId = sessionId;
    
    // Global error handler for unhandled JavaScript errors
    const handleError = (event: ErrorEvent) => {
      const errorDetails = {
        errorId: `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId,
        type: 'javascript_error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent
      };
      
      console.error('🚨 GLOBAL_ERROR_HANDLER:', errorDetails);
      
      // Report to server
      fetch('/api/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...errorDetails, source: 'global_error_handler', severity: 'high' })
      }).catch(err => console.error('Failed to report global error:', err));
    };
    
    // Global handler for unhandled promise rejections
    const handleRejection = (event: PromiseRejectionEvent) => {
      const errorDetails = {
        errorId: `REJ_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId,
        type: 'unhandled_rejection',
        reason: event.reason?.message || String(event.reason),
        stack: event.reason?.stack,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent
      };
      
      console.error('🚨 UNHANDLED_REJECTION:', errorDetails);
      
      // Report to server
      fetch('/api/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...errorDetails, source: 'unhandled_rejection', severity: 'high' })
      }).catch(err => console.error('Failed to report rejection:', err));
    };
    
    // Register global handlers
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    
    // CI Error Detection - Log critical errors that should fail CI
    const handleCriticalError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const message = 'message' in event ? event.message : String((event as PromiseRejectionEvent).reason);
      
      if (
        message.includes('TypeError') ||
        message.includes('Cannot read properties of undefined') ||
        message.includes('Hydration failed') ||
        message.includes('WebGL context lost')
      ) {
        console.error('🔥 CI_CRITICAL_ERROR:', {
          message,
          timestamp: new Date().toISOString(),
          shouldFailCI: true
        });
      }
    };
    
    window.addEventListener('error', handleCriticalError);
    window.addEventListener('unhandledrejection', handleCriticalError);
    
    // Cleanup handlers on unmount
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('error', handleCriticalError);
      window.removeEventListener('unhandledrejection', handleCriticalError);
    };
  }, []);
  
  return null;
}

function Router() {
  return (
    <>
      <GlobalErrorCapture />
      <Switch>
        <ProtectedRoute path="/" component={AppContent} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/test-effects" component={EffectTestPage} />
        <ProtectedRoute 
          path="/admin/creator" 
          component={() => (
            <ErrorBoundary 
              routeName="admin/creator"
              fallbackMessage="Critical error in Creator Dashboard. Video processing has been safely aborted."
              onReload={() => {
                // Clear any processing state and cancel operations
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('cancelVideoProcessing'));
                  sessionStorage.removeItem('adminWorkflowData');
                  (window as any).adminWorkflowVideoFile = null;
                }
              }}
            >
              <CreatorDashboard />
            </ErrorBoundary>
          )}
        />
        <ProtectedRoute path="/admin" component={AdminDashboard} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <AuthProvider>
            <Router />
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}