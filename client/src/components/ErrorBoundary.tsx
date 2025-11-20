import React, { Component, ReactNode } from 'react';
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, Bug } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
  onReload?: () => void;
  routeName?: string; // For identifying which route had the error
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  errorId: string | null;
}

/**
 * **ENHANCED ERROR BOUNDARY**: Prevents blank screens and provides comprehensive error handling
 * Features: correlation ID, stack traces, error reporting, and graceful fallback UI
 * Critical for preventing blank screen regressions after Process Video actions
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Generate unique error correlation ID for tracking
    const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return { hasError: true, error, errorInfo: null, errorId };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const errorId = this.state.errorId || `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const routeName = this.props.routeName || 'unknown';
    
    // Enhanced error logging with correlation ID
    const errorDetails = {
      errorId,
      routeName,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      userId: (window as any).currentUserId || 'anonymous'
    };

    console.error('🚨 ENHANCED_ERROR_BOUNDARY:', errorDetails);

    this.setState({
      error,
      errorInfo,
      errorId
    });

    // Report to multiple error tracking systems
    if (typeof window !== 'undefined') {
      // Existing custom event
      window.dispatchEvent(new CustomEvent('criticalPageError', {
        detail: errorDetails
      }));
      
      // Send to server for logging
      this.reportErrorToServer(errorDetails);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, errorId: null });
    this.props.onReload?.();
  };

  reportErrorToServer = async (errorDetails: any) => {
    try {
      await fetch('/api/error-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          ...errorDetails,
          source: 'client_error_boundary',
          severity: 'critical'
        })
      });
    } catch (serverError) {
      console.error('Failed to report error to server:', serverError);
    }
  };

  handleReportError = () => {
    const { error, errorInfo, errorId } = this.state;
    const errorReport = {
      errorId,
      error: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      componentStack: errorInfo?.componentStack || 'No component stack',
      timestamp: new Date().toISOString(),
      route: this.props.routeName || 'unknown',
      url: window.location.href
    };
    
    // Copy error details to clipboard for easy reporting
    navigator.clipboard.writeText(JSON.stringify(errorReport, null, 2)).then(() => {
      alert(`Error details copied to clipboard!\n\nError ID: ${errorId}\n\nPlease paste this information when reporting the issue.`);
    }).catch(() => {
      // Fallback: show error details in alert
      alert(`Error ID: ${errorId}\n\nError: ${error?.message}\n\nPlease report this error ID to support.`);
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card className="p-6 max-w-4xl mx-auto mt-8" data-testid="error-boundary">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-2">Critical Application Error</h3>
                  <p className="text-sm text-muted-foreground">
                    {this.props.fallbackMessage || "A critical error occurred that prevented the page from loading. The error has been logged and the page remains functional."}
                  </p>
                  {this.state.errorId && (
                    <p className="text-xs text-blue-600 font-mono mt-2">
                      Error ID: {this.state.errorId}
                    </p>
                  )}
                </div>
                
                {this.state.error && (
                  <div className="bg-muted/50 p-3 rounded-md space-y-2">
                    <p className="text-xs font-semibold text-destructive">
                      Error: {this.state.error.message}
                    </p>
                    {this.state.error.stack && (
                      <details className="text-xs font-mono text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">Stack Trace</summary>
                        <pre className="mt-2 p-2 bg-background rounded border overflow-auto max-h-32">
                          {this.state.error.stack}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
                
                <div className="flex gap-2 flex-wrap">
                  <Button 
                    onClick={this.handleReload}
                    size="sm"
                    data-testid="button-reload-effects"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reload Effects
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => window.location.reload()}
                    data-testid="button-reload-page"
                  >
                    Reload Page
                  </Button>
                  
                  <Button 
                    variant="secondary"
                    size="sm"
                    onClick={this.handleReportError}
                    data-testid="button-report-error"
                  >
                    <Bug className="w-4 h-4 mr-2" />
                    Report Error
                  </Button>
                  
                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.href = '/auth'}
                    data-testid="button-back-to-auth"
                  >
                    Back to Login
                  </Button>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        </Card>
      );
    }

    return this.props.children;
  }
}