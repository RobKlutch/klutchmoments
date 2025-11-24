import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { getLogger } from '@/lib/stageLogger';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  logBuffer: any[];
}

/**
 * VIDEO PREVIEW ERROR BOUNDARY
 * 
 * Captures crashes in Video Preview stage, dumps log buffer, and provides recovery.
 * Ensures crashes don't silently fail - all errors are visible with full context.
 */
export class VideoPreviewErrorBoundary extends Component<Props, State> {
  private logger = getLogger('VideoPreviewErrorBoundary');

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      logBuffer: []
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const videoPreviewLogger = getLogger('VideoPreviewPlayer');
    const spotlightLogger = getLogger('SpotlightOverlay');
    
    // Capture log buffers from all Video Preview components
    const logBuffer = [
      ...videoPreviewLogger.getBuffer(),
      ...spotlightLogger.getBuffer()
    ];

    this.setState({
      error,
      errorInfo,
      logBuffer
    });

    // Log the error with full context
    this.logger.error('Video Preview crashed', error, {
      componentStack: errorInfo.componentStack,
      logBufferSize: logBuffer.length,
      lastLogs: logBuffer.slice(-10)
    });

    // Flush all loggers to ensure remote delivery
    videoPreviewLogger.flush();
    spotlightLogger.flush();
    this.logger.flush();

    // Also log to console for immediate visibility
    console.group('🚨 VIDEO PREVIEW CRASH DUMP');
    console.error('Error:', error);
    console.error('Component Stack:', errorInfo.componentStack);
    console.log('Log Buffer (last 200 entries):', logBuffer);
    console.groupEnd();
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      logBuffer: []
    });
    
    this.logger.info('Error boundary reset by user');
    
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      const { error, logBuffer } = this.state;

      return (
        <div className="p-8 space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Video Preview Crashed</h3>
                <p className="text-sm mb-2">{error?.message || 'Unknown error'}</p>
                <details className="text-xs">
                  <summary className="cursor-pointer mb-2">View Error Details</summary>
                  <pre className="mt-2 p-2 bg-black/20 rounded overflow-auto max-h-40">
                    {error?.stack}
                  </pre>
                </details>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Diagnostic Logs ({logBuffer.length} entries)</h4>
                <details className="text-xs">
                  <summary className="cursor-pointer">View Log Buffer</summary>
                  <div className="mt-2 p-2 bg-black/20 rounded overflow-auto max-h-60">
                    {logBuffer.slice(-50).map((entry, idx) => (
                      <div key={idx} className="font-mono text-xs mb-1">
                        <span className="text-gray-400">[{new Date(entry.timestamp).toISOString()}]</span>
                        {' '}
                        <span className={
                          entry.level === 'error' ? 'text-red-400' :
                          entry.level === 'warn' ? 'text-yellow-400' :
                          'text-gray-300'
                        }>[{entry.level.toUpperCase()}]</span>
                        {' '}
                        {entry.message}
                        {entry.data && (
                          <div className="ml-4 text-gray-400">
                            {JSON.stringify(entry.data, null, 2)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              </div>

              <div className="flex gap-2">
                <Button onClick={this.handleReset} variant="outline" data-testid="button-reset-error-boundary">
                  Try Again
                </Button>
                <Button onClick={() => window.location.reload()} variant="secondary">
                  Reload Page
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}
