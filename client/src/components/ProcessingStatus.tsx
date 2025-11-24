import { useState, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, AlertCircle, Film, Target, Sparkles } from "lucide-react";

interface ProcessingStep {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

interface ProcessingStatusProps {
  isProcessing?: boolean;
  highlightId?: string;
  onComplete?: (processedVideoUrl?: string) => void;
  onError?: (error: string) => void;
}

export default function ProcessingStatus({ 
  isProcessing = false, 
  highlightId,
  onComplete,
  onError 
}: ProcessingStatusProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  const steps: ProcessingStep[] = [
    {
      id: 'upload',
      name: 'Processing Video',
      description: 'Analyzing video format and extracting frames',
      icon: <Film className="w-4 h-4" />,
      status: 'pending'
    },
    {
      id: 'tracking',
      name: 'AI-Powered Player Tracking',
      description: 'AI is identifying and tracking selected player throughout clip',
      icon: <Target className="w-4 h-4" />,
      status: 'pending'
    },
    {
      id: 'effects',
      name: 'Applying Effects',
      description: 'Rendering highlight effects and optimizing video',
      icon: <Sparkles className="w-4 h-4" />,
      status: 'pending'
    }
  ];

  const [processedSteps, setProcessedSteps] = useState<ProcessingStep[]>(steps);

  // Real processing status polling
  useEffect(() => {
    if (!isProcessing || !highlightId) return;

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/highlights/${highlightId}/status`, {
          credentials: 'include'
        });
        if (response.ok) {
          const result = await response.json();
          
          if (result.status === 'completed') {
            setProgress(100);
            setProcessedSteps(steps.map(step => ({ ...step, status: 'completed' as const })));
            setTimeout(() => {
              // If backend returns mock /processed/ URL, don't use it - let frontend fallback to original
              const processedUrl = result.processedVideoUrl?.startsWith('/processed/') 
                ? undefined 
                : result.processedVideoUrl;
              onComplete?.(processedUrl);
              console.log('Processing completed successfully');
            }, 500);
            return;
          }
        }
      } catch (error) {
        console.error('Error polling status:', error);
      }
    };

    // Poll every 1 second for status updates
    const interval = setInterval(pollStatus, 1000);
    
    // Also start the visual progress simulation
    const timer = setInterval(() => {
      setProgress((prev) => {
        const newProgress = Math.min(prev + 1.5, 95); // Cap at 95% until real completion
        
        // Update step status based on progress
        const stepProgress = newProgress / 100 * steps.length;
        const newSteps = steps.map((step, index) => ({
          ...step,
          status: (index < stepProgress ? 'completed' : 
                 index === Math.floor(stepProgress) ? 'processing' : 'pending') as ProcessingStep['status']
        }));
        
        setProcessedSteps(newSteps);
        setCurrentStep(Math.floor(stepProgress));
        
        return newProgress;
      });
    }, 100);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [isProcessing, highlightId, onComplete]);

  const getStatusIcon = (status: ProcessingStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-destructive" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-muted" />;
    }
  };

  const getStatusColor = (status: ProcessingStep['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-600';
      case 'processing': return 'bg-primary';
      case 'error': return 'bg-destructive';
      default: return 'bg-muted';
    }
  };

  const estimatedTimeRemaining = Math.max(0, Math.round((100 - progress) / 2));

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-display font-semibold mb-2">Creating Your Highlight</h3>
        <p className="text-sm text-muted-foreground">
          Please wait while we process your video and apply the highlight effects
        </p>
      </div>

      {/* Overall Progress */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">Overall Progress</span>
          <span className="text-sm text-muted-foreground">{progress.toFixed(0)}%</span>
        </div>
        <Progress value={progress} className="h-2" data-testid="progress-overall" />
        
        {isProcessing && estimatedTimeRemaining > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Estimated time remaining: {estimatedTimeRemaining} seconds
          </p>
        )}
      </div>

      {/* Processing Steps */}
      <div className="space-y-4">
        {processedSteps.map((step, index) => (
          <div
            key={step.id}
            className={`
              flex items-start gap-3 p-3 rounded-lg transition-all duration-300
              ${step.status === 'processing' ? 'bg-primary/5 border border-primary/20' : 
                step.status === 'completed' ? 'bg-green-50 dark:bg-green-950/20' : 
                'bg-muted/30'}
            `}
            data-testid={`processing-step-${step.id}`}
          >
            <div className="mt-0.5">
              {getStatusIcon(step.status)}
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4 className={`
                  font-medium text-sm
                  ${step.status === 'completed' ? 'text-green-700 dark:text-green-400' : 
                    step.status === 'processing' ? 'text-primary' : 
                    'text-foreground'}
                `}>
                  {step.name}
                </h4>
                
                <Badge 
                  variant={step.status === 'completed' ? 'default' : 'outline'}
                  className={`
                    text-xs px-2 py-0.5
                    ${step.status === 'completed' ? 'bg-green-600 text-white' : 
                      step.status === 'processing' ? 'border-primary text-primary' : 
                      'text-muted-foreground'}
                  `}
                >
                  {step.status === 'completed' ? 'Complete' : 
                   step.status === 'processing' ? 'Processing' : 
                   'Pending'}
                </Badge>
              </div>
              
              <p className="text-xs text-muted-foreground">
                {step.description}
              </p>
              
              {step.status === 'processing' && (
                <div className="mt-2">
                  <div className="w-full bg-muted rounded-full h-1">
                    <div 
                      className="bg-primary h-1 rounded-full transition-all duration-300 animate-pulse"
                      style={{ width: `${((progress - (index * 33.33)) / 33.33) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Processing Tips */}
      <div className="mt-6 p-4 bg-muted/30 rounded-lg">
        <h4 className="text-sm font-medium mb-2">While you wait...</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• Our AI is analyzing every frame to track your player precisely</li>
          <li>• Highlight effects are being optimized for best visual impact</li>
          <li>• The final video will be ready for social media sharing</li>
        </ul>
      </div>
    </Card>
  );
}