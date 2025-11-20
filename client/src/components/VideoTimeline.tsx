import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, Scissors } from "lucide-react";

interface VideoTimelineProps {
  videoUrl?: string;
  videoDuration?: number;
  onTimeSelection?: (startTime: number, endTime: number) => void;
  onFrameCapture?: (frameDataUrl: string, timestamp: number) => void;
  onConfirm?: () => void;
  onBack?: () => void;
  maxClipLength?: number;
  minClipLength?: number;
}

export default function VideoTimeline({ 
  videoUrl, 
  videoDuration = 60,
  onTimeSelection,
  onFrameCapture,
  onConfirm,
  onBack,
  maxClipLength = 15,
  minClipLength = 1
}: VideoTimelineProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(15);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    onTimeSelection?.(startTime, endTime);
  }, [startTime, endTime, onTimeSelection]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    
    if (isPlaying) {
      video.pause();
      console.log('Video paused');
    } else {
      video.play();
      console.log('Video played');
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const timeline = event.currentTarget;
    const rect = timeline.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickPercent = clickX / rect.width;
    const clickTime = clickPercent * videoDuration;
    
    // Move video to clicked position
    const video = videoRef.current;
    if (video) {
      video.currentTime = clickTime;
    }
    setCurrentTime(clickTime);
    console.log('Timeline clicked at:', formatTime(clickTime));
  };

  const handleSelectionDrag = (event: React.MouseEvent<HTMLDivElement>, dragType: 'start' | 'end' | 'move') => {
    setIsDragging(true);
    const timeline = event.currentTarget.closest('[data-timeline]') as HTMLElement;
    if (!timeline) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const rect = timeline.getBoundingClientRect();
      const moveX = e.clientX - rect.left;
      const movePercent = Math.max(0, Math.min(1, moveX / rect.width));
      const moveTime = movePercent * videoDuration;
      
      if (dragType === 'start') {
        const newStart = Math.max(0, Math.min(moveTime, endTime - minClipLength));
        setStartTime(newStart);
      } else if (dragType === 'end') {
        const newEnd = Math.min(videoDuration, Math.max(moveTime, startTime + minClipLength));
        setEndTime(newEnd);
      } else if (dragType === 'move') {
        const duration = endTime - startTime;
        const newStart = Math.max(0, Math.min(videoDuration - duration, moveTime - duration / 2));
        setStartTime(newStart);
        setEndTime(newStart + duration);
      }
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleReset = () => {
    setCurrentTime(0);
    setStartTime(0);
    setEndTime(15);
    setIsPlaying(false);
    console.log('Timeline reset');
  };


  const selectedDuration = endTime - startTime;

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-display font-semibold mb-2">Select Your Clip</h3>
        <p className="text-sm text-muted-foreground">
          Choose up to {maxClipLength} seconds for your highlight reel
        </p>
      </div>

      {/* Video Preview */}
      <div className="relative mb-6 bg-black rounded-lg overflow-hidden aspect-video">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const duration = e.currentTarget.duration;
              if (duration && endTime > duration) {
                setEndTime(Math.min(duration, startTime + maxClipLength));
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/60">
            <div className="text-center">
              <Play className="w-16 h-16 mx-auto mb-2 opacity-50" />
              <p>Video preview will appear here</p>
            </div>
          </div>
        )}
        
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Button
            size="icon"
            variant="secondary"
            className="w-16 h-16 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm"
            onClick={handlePlayPause}
            data-testid="button-play-pause"
          >
            {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
          </Button>
        </div>
      </div>

      {/* Timeline Controls */}
      <div className="space-y-6">
        {/* Timeline Header */}
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium">Timeline & Clip Selection</label>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Current: {formatTime(currentTime)}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Selection: {formatTime(startTime)} - {formatTime(endTime)}</span>
              <span className={`font-medium ${
                selectedDuration >= minClipLength && selectedDuration <= maxClipLength 
                  ? 'text-green-600' 
                  : 'text-destructive'
              }`}>
                ({selectedDuration.toFixed(1)}s)
              </span>
            </div>
          </div>
        </div>

        {/* Combined Timeline */}
        <div 
          className="relative w-full h-12 bg-muted rounded-md cursor-pointer" 
          onClick={handleTimelineClick}
          data-timeline
          data-testid="timeline-combined"
        >
          {/* Timeline track */}
          <div className="absolute inset-0 bg-gradient-to-r from-muted-foreground/20 to-muted-foreground/10 rounded-md" />
          
          {/* Selection window */}
          <div 
            className="absolute top-0 h-full bg-primary/30 border border-primary rounded-sm transition-all"
            style={{
              left: `${(startTime / videoDuration) * 100}%`,
              width: `${((endTime - startTime) / videoDuration) * 100}%`
            }}
            data-testid="selection-window"
          >
            {/* Selection handles */}
            <div 
              className="absolute left-0 top-0 w-2 h-full bg-primary cursor-ew-resize rounded-l-sm hover:bg-primary/80"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSelectionDrag(e, 'start');
              }}
              data-testid="selection-handle-start"
            />
            <div 
              className="absolute right-0 top-0 w-2 h-full bg-primary cursor-ew-resize rounded-r-sm hover:bg-primary/80"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSelectionDrag(e, 'end');
              }}
              data-testid="selection-handle-end"
            />
            
            {/* Move handle (center area) */}
            <div 
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => {
                e.stopPropagation();
                handleSelectionDrag(e, 'move');
              }}
              data-testid="selection-move-handle"
            />
            
            {/* Selection label */}
            <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs text-primary font-medium whitespace-nowrap">
              {selectedDuration.toFixed(1)}s clip
            </div>
          </div>
          
          {/* Current time indicator */}
          <div 
            className="absolute top-0 w-0.5 h-full bg-destructive z-10 transition-all"
            style={{ left: `${(currentTime / videoDuration) * 100}%` }}
            data-testid="playhead"
          >
            <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-destructive rounded-full" />
          </div>
          
          {/* Time markers */}
          <div className="absolute bottom-0 left-0 text-xs text-muted-foreground transform translate-y-full pt-1">
            0:00
          </div>
          <div className="absolute bottom-0 right-0 text-xs text-muted-foreground transform translate-y-full pt-1">
            {formatTime(videoDuration)}
          </div>
        </div>
        
        {/* Duration validation */}
        {(selectedDuration < minClipLength || selectedDuration > maxClipLength) && (
          <p className="text-xs text-destructive">
            Clip must be between {minClipLength}-{maxClipLength} seconds. Drag the handles to adjust.
          </p>
        )}

        {/* Control Buttons */}
        <div className="flex justify-between items-center pt-4 border-t">
          <div className="flex gap-2">
            {onBack && (
              <Button
                variant="outline"
                onClick={onBack}
                data-testid="button-back"
              >
                Back
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleReset}
              data-testid="button-reset-timeline"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          </div>

          <Button
            onClick={onConfirm}
            disabled={selectedDuration < minClipLength || selectedDuration > maxClipLength}
            data-testid="button-next-step"
          >
            <Scissors className="w-4 h-4 mr-2" />
            Next Step
          </Button>
        </div>
      </div>

    </Card>
  );
}