import { useState, useEffect, useRef } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Target, 
  AlertTriangle, 
  Move, 
  RefreshCw, 
  Eye,
  EyeOff,
  Hand,
  TrendingUp,
  Zap,
  CheckCircle,
  XCircle,
  Loader2
} from "lucide-react";
import { type TrackingStatus } from "@/hooks/useSpotlightTracker";

interface TrackingStatusIndicatorProps {
  trackingStatus: TrackingStatus;
  onManualOverride?: (position: { x: number; y: number }) => void;
  onEnterManualMode?: () => void;
  onExitManualMode?: () => void;
  onResetTracking?: () => void;
  videoRef?: React.RefObject<HTMLVideoElement>;
  className?: string;
  compact?: boolean;
}

export default function TrackingStatusIndicator({
  trackingStatus,
  onManualOverride,
  onEnterManualMode,
  onExitManualMode,
  onResetTracking,
  videoRef,
  className = '',
  compact = false
}: TrackingStatusIndicatorProps) {
  const [showDetails, setShowDetails] = useState(!compact);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Manual positioning is handled by parent component's coordinate conversion system
  // This component only provides UI controls and status display

  const getStatusIcon = () => {
    switch (trackingStatus.mode) {
      case 'idle':
        return <Eye className="w-4 h-4" />;
      case 'tracking':
        return trackingStatus.fallbackActive ? 
          <AlertTriangle className="w-4 h-4" /> : 
          <Target className="w-4 h-4" />;
      case 'predicting':
        return <TrendingUp className="w-4 h-4" />;
      case 'manual':
        return <Hand className="w-4 h-4" />;
      case 'lost':
        return <XCircle className="w-4 h-4" />;
      default:
        return <Eye className="w-4 h-4" />;
    }
  };

  const getStatusColor = () => {
    if (trackingStatus.mode === 'lost') return 'destructive';
    if (trackingStatus.mode === 'manual') return 'secondary';
    if (trackingStatus.fallbackActive) return 'warning';
    if (trackingStatus.confidence >= 0.7) return 'default';
    return 'warning';
  };

  const getStatusMessage = () => {
    switch (trackingStatus.mode) {
      case 'idle':
        return 'No player selected';
      case 'tracking':
        return trackingStatus.fallbackActive ? 
          `Low confidence tracking (${(trackingStatus.confidence * 100).toFixed(0)}%) - Consider manual positioning` :
          `Tracking active (${(trackingStatus.confidence * 100).toFixed(0)}%)`;
      case 'predicting':
        return `Predicting movement (${Math.round(trackingStatus.detectionAge / 1000)}s since detection) - Manual positioning available`;
      case 'manual':
        return 'Manual positioning active - Click the video to adjust spotlight location';
      case 'lost':
        return 'Tracking lost - Use manual positioning to continue';
      default:
        return 'Unknown status';
    }
  };

  const getFallbackDescription = () => {
    if (!trackingStatus.fallbackActive) return null;
    
    switch (trackingStatus.fallbackReason) {
      case 'low_confidence':
        return 'Using extra smoothing due to detection uncertainty';
      case 'detection_failed':
        return 'No player detected - tracking stopped';
      case 'velocity_extrapolation':
        return 'Predicting position based on recent movement';
      case 'manual_override':
        return 'User has manually positioned the tracking';
      default:
        return 'Fallback mode active';
    }
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`} data-testid="tracking-status-compact">
        <div className="flex items-center gap-1">
          {getStatusIcon()}
          <Badge variant={getStatusColor() as any} className="text-xs">
            {trackingStatus.mode}
          </Badge>
        </div>
        
        {trackingStatus.confidence > 0 && (
          <Progress 
            value={trackingStatus.confidence * 100} 
            className="w-12 h-2" 
            data-testid="confidence-progress"
          />
        )}

        {trackingStatus.canManuallyOverride && onEnterManualMode && (
          <Button 
            size="icon" 
            variant="ghost" 
            className="h-6 w-6"
            onClick={onEnterManualMode}
            data-testid="button-manual-override"
            title="Click to manually position tracking"
          >
            <Hand className="w-3 h-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className={`p-4 ${className}`} data-testid="tracking-status-detailed">
      {/* Manual positioning instructions shown when in manual mode */}
      {trackingStatus.mode === 'manual' && !compact && (
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3">
          <div className="flex items-start gap-2">
            <Hand className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Manual Positioning Active
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Click on the video where you want to position the tracking spotlight. The system will continue tracking from that position.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Status Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="font-medium">Tracking Status</span>
          <Badge variant={getStatusColor() as any} data-testid="status-badge">
            {trackingStatus.mode.toUpperCase()}
          </Badge>
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowDetails(!showDetails)}
          data-testid="button-toggle-details"
        >
          {showDetails ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
      </div>

      {/* Status Message */}
      <p className="text-sm text-muted-foreground mb-3" data-testid="status-message">
        {getStatusMessage()}
      </p>

      {/* Fallback Information */}
      {trackingStatus.fallbackActive && (
        <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Fallback Mode Active
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                {getFallbackDescription()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Metrics */}
      {showDetails && trackingStatus.mode !== 'idle' && (
        <div className="space-y-3 mb-4">
          {/* Confidence Level */}
          {trackingStatus.confidence > 0 && (
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Detection Confidence</span>
                <span className="font-mono" data-testid="confidence-value">
                  {(trackingStatus.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <Progress 
                value={trackingStatus.confidence * 100} 
                className="h-2"
                data-testid="confidence-progress-detailed"
              />
            </div>
          )}

          {/* Tracking Stability */}
          {trackingStatus.trackingStability > 0 && (
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Stability</span>
                <span className="font-mono" data-testid="stability-value">
                  {(trackingStatus.trackingStability * 100).toFixed(0)}%
                </span>
              </div>
              <Progress 
                value={trackingStatus.trackingStability * 100} 
                className="h-2"
                data-testid="stability-progress"
              />
            </div>
          )}

          {/* Movement Speed */}
          {trackingStatus.velocityMagnitude > 0.01 && (
            <div className="flex justify-between text-sm">
              <span>Movement Speed</span>
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                <span className="font-mono" data-testid="velocity-value">
                  {trackingStatus.velocityMagnitude.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Detection Age */}
          {trackingStatus.detectionAge > 1000 && (
            <div className="flex justify-between text-sm">
              <span>Last Detection</span>
              <span className="font-mono" data-testid="detection-age">
                {Math.round(trackingStatus.detectionAge / 1000)}s ago
              </span>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        {trackingStatus.canManuallyOverride && onEnterManualMode && (
          <Button
            variant={
              trackingStatus.mode === 'lost' || 
              (trackingStatus.fallbackActive && trackingStatus.confidence < 0.5) 
                ? "default" : "outline"
            }
            size="sm"
            onClick={onEnterManualMode}
            disabled={trackingStatus.mode === 'manual'}
            data-testid="button-manual-position"
            className="flex-1"
          >
            <Move className="w-4 h-4 mr-2" />
            {trackingStatus.mode === 'manual' 
              ? 'Click Video to Position' 
              : trackingStatus.mode === 'lost' 
                ? 'Fix Position Manually'
                : trackingStatus.fallbackActive 
                  ? 'Improve Positioning'
                  : 'Manual Position'
            }
          </Button>
        )}

        {onResetTracking && trackingStatus.mode !== 'idle' && (
          <Button
            variant="outline"
            size="sm"
            onClick={onResetTracking}
            data-testid="button-reset-tracking"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset Tracking
          </Button>
        )}
      </div>
    </Card>
  );
}