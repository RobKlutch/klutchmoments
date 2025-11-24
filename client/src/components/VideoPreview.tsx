import { useState, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, RotateCcw, Download, Volume2, VolumeX, Maximize } from "lucide-react";
import SocialSharing from "@/components/SocialSharing";
import SpotlightOverlay from "@/components/SpotlightOverlay";
import { useSpotlightTracker } from "@/hooks/useSpotlightTracker";

interface VideoPreviewProps {
  videoUrl?: string;
  highlightEffect?: any;  // Full effect object instead of just string
  effectSettings?: any;   // Separate effect settings
  playerPosition?: { x: number; y: number };
  selectedPlayer?: any;  // Add selected player data for tracking
  onDownload?: () => void;
  onRestart?: () => void;
}

// **UNIFIED TRACKING**: Now uses useSpotlightTracker hook for consistent tracking

export default function VideoPreview({ 
  videoUrl, 
  highlightEffect = { name: 'spotlight' },
  effectSettings = {},
  playerPosition,
  selectedPlayer,
  onDownload,
  onRestart
}: VideoPreviewProps) {
  console.log('🏷️ VideoPreview.tsx is rendering with:', {
    videoUrl: !!videoUrl,
    selectedPlayer: !!selectedPlayer,
    effectSettings,
    highlightEffect
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(15);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // **UNIFIED TRACKING**: Use comprehensive useSpotlightTracker hook with per-frame lookup
  const { 
    currentBox, 
    status: trackingStatus, 
    getBoxByIdAtTime // **CRITICAL**: Per-frame lookup function for live tracking
  } = useSpotlightTracker(
    videoRef, 
    playerPosition || null, // **FIX**: Handle undefined playerPosition
    { 
      effect: highlightEffect.name || 'spotlight', 
      settings: effectSettings, 
      externalMode: false, // **FIX**: Let hook manage frame updates automatically
      selectedPlayer: selectedPlayer,  // **FIX**: Pass selectedPlayer for proper bbox seeding
      componentName: 'VideoPreview' // **DEBUG**: Identify this component in logs
    }
  );

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // **REMOVED**: All duplicate tracking logic now handled by useSpotlightTracker
  

  const handlePlayPause = async () => {
    if (!videoRef.current) return;
    
    try {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
        console.log('🎬 Preview paused - useSpotlightTracker will handle tracking state');
      } else {
        await videoRef.current.play();
        setIsPlaying(true);
        console.log('🎬 Preview playing - useSpotlightTracker will handle tracking state');
      }
    } catch (error) {
      console.error('Error playing/pausing video:', error);
    }
  };
  
  // **NEW**: Video time update handler for live tracking
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };
  

  const handleMuteToggle = () => {
    if (!videoRef.current) return;
    
    const newMutedState = !isMuted;
    videoRef.current.muted = newMutedState;
    setIsMuted(newMutedState);
    console.log(newMutedState ? 'Audio muted' : 'Audio unmuted');
  };

  const handleFullscreen = () => {
    if (!videoRef.current) return;
    
    try {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
      console.log('Fullscreen requested');
    } catch (error) {
      console.error('Error entering fullscreen:', error);
    }
  };

  const handleDownload = () => {
    console.log('Download initiated');
    onDownload?.();
    // todo: remove mock functionality - would trigger download
  };

  const handleRestart = () => {
    console.log('Restarting editing process');
    onRestart?.();
  };

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-6">
        <div className="mb-4 sm:mb-6">
          <h3 className="text-lg sm:text-xl font-display font-semibold mb-2">Preview Your Highlight</h3>
          <p className="text-sm text-muted-foreground">
            Review your highlight reel before downloading and sharing
          </p>
        </div>

        {/* Video Player */}
        <div className="relative mb-4 sm:mb-6 bg-black rounded-lg overflow-hidden aspect-video group">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            playsInline
            preload="metadata"
            muted={isMuted}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/60">
            <div className="text-center">
              <Play className="w-16 h-16 mx-auto mb-2 opacity-50" />
              <p>Processed highlight will appear here</p>
              <p className="text-sm mt-1">With your selected highlight effect applied</p>
            </div>
          </div>
        )}

        {/* **UNIFIED SPOTLIGHT OVERLAY**: Now with per-frame tracking support */}
        <SpotlightOverlay
          videoRef={videoRef}
          trackingBox={currentBox}
          effect={highlightEffect.name || 'focuscircle'}
          settings={{
            intensity: effectSettings.intensity || 20,
            size: effectSettings.size || 50,
            color: effectSettings.color || '#3b82f6'
          }}
          isVisible={!!selectedPlayer && !!currentBox}
          sampleTime={currentTime} // **CRITICAL**: Current video time for per-frame lookups
          realVideoTime={currentTime} // **CRITICAL**: Current video time for time-based logic
          getBoxByIdAtTime={getBoxByIdAtTime} // **CRITICAL**: Per-frame lookup function
          selectedPlayerId={selectedPlayer?.id} // **CRITICAL**: Selected player ID for tracking
          selectedPlayer={selectedPlayer} // **DEBUG**: Full player object for matching
          showDebugOverlay={true} // **DEBUG**: Enable visual debugging for testing
        />
        
        {/* Tracking Status Indicator */}
        {selectedPlayer && (
          <div className="absolute top-4 left-4 px-3 py-1 bg-black/70 text-white text-sm rounded-full backdrop-blur-sm">
            {trackingStatus === 'idle' && '⚪ Ready'}
            {trackingStatus === 'tracking' && '🟢 Tracking'}
            {trackingStatus === 'lost' && '🔴 Lost'}
          </div>
        )}

        {/* Video Controls Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
          <div className="flex items-center gap-4">
            <Button
              size="icon"
              variant="secondary"
              className="w-12 h-12 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm"
              onClick={handlePlayPause}
              data-testid="button-preview-play"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </Button>
          </div>
        </div>

        {/* Control Bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="w-8 h-8 text-white hover:bg-white/20"
                onClick={handleMuteToggle}
                data-testid="button-mute-toggle"
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
              <span className="text-sm">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            
            <Button
              size="icon"
              variant="ghost"
              className="w-8 h-8 text-white hover:bg-white/20"
              onClick={handleFullscreen}
              data-testid="button-fullscreen"
            >
              <Maximize className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

        {/* Highlight Details */}
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-muted/30 rounded-lg">
          <h4 className="font-medium mb-3 text-sm sm:text-base">Highlight Details</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 text-xs sm:text-sm">
          <div>
            <span className="text-muted-foreground">Duration:</span>
            <div className="font-medium">{duration}s</div>
          </div>
          <div>
            <span className="text-muted-foreground">Effect:</span>
            <div className="font-medium capitalize">{highlightEffect.name || 'spotlight'}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Quality:</span>
            <div className="font-medium">HD 1080p</div>
          </div>
          <div>
            <span className="text-muted-foreground">Format:</span>
            <div className="font-medium">MP4</div>
          </div>
        </div>
      </div>

        {/* Status and Watermark Info */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-green-600 text-xs">
              Ready for Download
            </Badge>
            <span className="text-xs sm:text-sm text-muted-foreground">
              Watermark included
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            File size: ~{Math.round(duration * 0.8)}MB
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleRestart}
            className="flex-1"
            data-testid="button-restart-editing"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Start Over
          </Button>
          
          <Button
            onClick={handleDownload}
            className="flex-1 bg-green-600 hover:bg-green-700"
            data-testid="button-download-highlight"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Highlight
          </Button>
        </div>

        {/* Tips */}
        <div className="mt-4 text-xs text-muted-foreground">
          <p>💡 Tip: Your highlight is optimized for social media sharing</p>
        </div>
      </Card>

      {/* Social Sharing */}
      <SocialSharing
        videoUrl={videoUrl}
        title="Check out my amazing sports highlight!"
        description="Created with Klutch Moments - Spotlight Your Talent. Get Noticed."
        onDownload={handleDownload}
      />
    </div>
  );
}