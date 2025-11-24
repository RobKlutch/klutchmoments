import { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  stageName: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: any;
}

export class StageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error(`❌ ${this.props.stageName} Stage Error:`, error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center" data-testid="error-boundary-crash-panel">
          <div className="rounded-full bg-destructive/10 p-4 mb-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold mb-2">
            {this.props.stageName} Stage Error
          </h2>
          <p className="text-muted-foreground mb-4 max-w-md">
            Something went wrong in the {this.props.stageName.toLowerCase()} stage.
            {this.state.error?.message && (
              <span className="block mt-2 text-sm font-mono text-destructive">
                {this.state.error.message}
              </span>
            )}
          </p>
          <Button 
            onClick={this.handleRetry}
            variant="default"
            className="gap-2"
            data-testid="button-retry-stage"
          >
            <RotateCcw className="h-4 w-4" />
            Retry {this.props.stageName}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
