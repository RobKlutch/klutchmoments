import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, Users, Sparkles, Download, Scissors } from "lucide-react";

interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: 'upcoming' | 'current' | 'completed';
}

interface WorkflowStepsProps {
  currentStep: string;
  onStepClick?: (step: 'hero' | 'upload' | 'timeline' | 'effects') => void;
  canNavigateToStep?: (step: string) => boolean;
}

export default function WorkflowSteps({ currentStep, onStepClick, canNavigateToStep }: WorkflowStepsProps) {
  const steps: WorkflowStep[] = [
    {
      id: 'upload',
      title: 'Upload Video',
      description: 'Choose your game clip',
      icon: <Upload className="w-4 h-4" />,
      status: 'upcoming'
    },
    {
      id: 'timeline',
      title: 'Timeline & Player',
      description: 'Set clip and select player',
      icon: <Scissors className="w-4 h-4" />,
      status: 'upcoming'
    },
    {
      id: 'effects',
      title: 'Choose Effects',
      description: 'Pick style & preview',
      icon: <Sparkles className="w-4 h-4" />,
      status: 'upcoming'
    }
  ];

  // Update step statuses based on current step
  const updatedSteps = steps.map((step, index) => {
    const currentIndex = steps.findIndex(s => s.id === currentStep);
    return {
      ...step,
      status: (index < currentIndex ? 'completed' : 
              index === currentIndex ? 'current' : 'upcoming') as WorkflowStep['status']
    };
  });

  const getStatusColor = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-600 text-white';
      case 'current': return 'bg-primary text-primary-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card className="p-6 mb-8">
      <h2 className="text-lg font-display font-semibold mb-4">Create Your Highlight in 3 Steps</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {updatedSteps.map((step, index) => {
          const isClickable = canNavigateToStep?.(step.id) && step.status === 'completed';
          
          return (
          <div key={step.id} className="relative">
            <div 
              className={`
                flex flex-col items-center text-center p-4 rounded-lg transition-all
                ${step.status === 'current' ? 'bg-primary/5 border-2 border-primary' : 
                  step.status === 'completed' ? 'bg-green-50 dark:bg-green-950/20' : 
                  'bg-muted/30'}
                ${isClickable ? 'hover:bg-green-100 dark:hover:bg-green-900/30 cursor-pointer hover-elevate' : ''}
              `}
              onClick={() => isClickable && onStepClick?.(step.id as any)}
              data-testid={`step-${step.id}`}
            >
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center mb-2
                ${getStatusColor(step.status)}
              `}>
                {step.icon}
              </div>
              
              <h3 className="font-medium text-sm mb-1">{step.title}</h3>
              <p className="text-xs text-muted-foreground">{step.description}</p>
              
              <Badge 
                variant={step.status === 'current' ? 'default' : 'outline'}
                className={`mt-2 text-xs ${
                  step.status === 'completed' ? 'bg-green-600 text-white border-green-600' : 
                  step.status === 'current' ? '' : 'text-muted-foreground'
                }`}
              >
                {step.status === 'completed' ? 'Done' : 
                 step.status === 'current' ? 'Active' : 
                 `Step ${index + 1}`}
              </Badge>
            </div>
            
            {/* Connection line */}
            {index < updatedSteps.length - 1 && (
              <div className="hidden md:block absolute top-8 -right-2 w-4 h-0.5 bg-border"></div>
            )}
          </div>
          );
        })}
      </div>
    </Card>
  );
}