import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { 
  Play, 
  Plus, 
  Trash2, 
  Clock, 
  Rewind,
  FastForward,
  PlayCircle,
  Edit
} from "lucide-react";

import { type SlowMotionSegment } from '@/lib/effectRenderer';

interface SlowMotionSegmentsProps {
  timeSelection: { start: number; end: number };
  segments: SlowMotionSegment[];
  onSegmentsChange: (segments: SlowMotionSegment[]) => void;
  className?: string;
  maxSegments?: number;
}

export default function SlowMotionSegments({
  timeSelection,
  segments,
  onSegmentsChange,
  className = '',
  maxSegments = 5
}: SlowMotionSegmentsProps) {
  const [isAddingSegment, setIsAddingSegment] = useState(false);
  const [editingSegment, setEditingSegment] = useState<string | null>(null);
  const [newSegment, setNewSegment] = useState<Partial<SlowMotionSegment>>({
    startTime: timeSelection.start,
    endTime: Math.min(timeSelection.start + 2, timeSelection.end),
    speedFactor: 0.5,
    name: ''
  });

  const timelineRef = useRef<HTMLDivElement>(null);
  const totalDuration = timeSelection.end - timeSelection.start;

  // Format time display
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }, []);

  // Convert time to timeline position percentage
  const timeToPosition = useCallback((time: number): number => {
    return ((time - timeSelection.start) / totalDuration) * 100;
  }, [timeSelection.start, totalDuration]);

  // Convert position percentage to time
  const positionToTime = useCallback((position: number): number => {
    return timeSelection.start + (position / 100) * totalDuration;
  }, [timeSelection.start, totalDuration]);

  // Validate segment timing
  const validateSegment = useCallback((segment: Partial<SlowMotionSegment>): string | null => {
    if (segment.startTime == null || segment.endTime == null || segment.speedFactor == null) {
      return "All fields are required";
    }
    
    if (segment.startTime >= segment.endTime) {
      return "End time must be after start time";
    }
    
    if (segment.startTime < timeSelection.start || segment.endTime > timeSelection.end) {
      return "Segment must be within the selected clip time";
    }
    
    if (segment.endTime - segment.startTime < 0.5) {
      return "Segment must be at least 0.5 seconds long";
    }
    
    if (segment.speedFactor < 0.1 || segment.speedFactor > 1.0) {
      return "Speed factor must be between 10% and 100%";
    }
    
    // Check for overlap with existing segments
    const overlapping = segments.some(existing => 
      existing.id !== segment.id &&
      ((segment.startTime! >= existing.startTime && segment.startTime! < existing.endTime) ||
       (segment.endTime! > existing.startTime && segment.endTime! <= existing.endTime) ||
       (segment.startTime! <= existing.startTime && segment.endTime! >= existing.endTime))
    );
    
    if (overlapping) {
      return "Segment overlaps with an existing slow-motion segment";
    }
    
    return null;
  }, [timeSelection, segments]);

  // Add new segment
  const handleAddSegment = useCallback(() => {
    const error = validateSegment(newSegment);
    if (error) {
      alert(error);
      return;
    }
    
    const segment: SlowMotionSegment = {
      id: `segment_${Date.now()}`,
      startTime: newSegment.startTime!,
      endTime: newSegment.endTime!,
      speedFactor: newSegment.speedFactor!,
      name: newSegment.name || `Slow Motion ${segments.length + 1}`
    };
    
    const updatedSegments = [...segments, segment].sort((a, b) => a.startTime - b.startTime);
    onSegmentsChange(updatedSegments);
    
    setIsAddingSegment(false);
    setNewSegment({
      startTime: timeSelection.start,
      endTime: Math.min(timeSelection.start + 2, timeSelection.end),
      speedFactor: 0.5,
      name: ''
    });
  }, [newSegment, segments, onSegmentsChange, timeSelection, validateSegment]);

  // Delete segment
  const handleDeleteSegment = useCallback((segmentId: string) => {
    const updatedSegments = segments.filter(s => s.id !== segmentId);
    onSegmentsChange(updatedSegments);
  }, [segments, onSegmentsChange]);

  // Update segment
  const handleUpdateSegment = useCallback((segmentId: string, updates: Partial<SlowMotionSegment>) => {
    const updatedSegments = segments.map(segment => 
      segment.id === segmentId ? { ...segment, ...updates } : segment
    );
    
    const error = validateSegment(updatedSegments.find(s => s.id === segmentId)!);
    if (error) {
      alert(error);
      return;
    }
    
    onSegmentsChange(updatedSegments.sort((a, b) => a.startTime - b.startTime));
    setEditingSegment(null);
  }, [segments, onSegmentsChange, validateSegment]);

  // Timeline click handler
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingSegment) return;
    
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const position = ((e.clientX - rect.left) / rect.width) * 100;
    const time = positionToTime(position);
    
    setNewSegment(prev => ({
      ...prev,
      startTime: Math.max(timeSelection.start, Math.min(time, timeSelection.end - 0.5))
    }));
  }, [isAddingSegment, positionToTime, timeSelection]);

  return (
    <Card className={`p-6 ${className}`}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-lg font-medium flex items-center gap-2">
              <Rewind className="w-5 h-5" />
              Slow-Motion Segments
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              Define specific parts of your clip for slow-motion replay
            </p>
          </div>
          <Badge variant="secondary" className="text-xs">
            {segments.length}/{maxSegments} segments
          </Badge>
        </div>

        {/* Timeline Visualization */}
        <div className="space-y-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(timeSelection.start)}</span>
            <span>Timeline</span>
            <span>{formatTime(timeSelection.end)}</span>
          </div>
          
          <div 
            ref={timelineRef}
            className="relative h-12 bg-muted rounded-lg cursor-pointer overflow-hidden"
            onClick={handleTimelineClick}
            data-testid="slowmo-timeline"
          >
            {/* Base timeline */}
            <div className="absolute inset-0 bg-gradient-to-r from-muted-foreground/20 to-muted-foreground/40" />
            
            {/* Existing segments */}
            {segments.map((segment) => (
              <div
                key={segment.id}
                className="absolute top-1 bottom-1 bg-primary/30 border-2 border-primary rounded flex items-center justify-center group cursor-pointer"
                style={{
                  left: `${timeToPosition(segment.startTime)}%`,
                  width: `${timeToPosition(segment.endTime) - timeToPosition(segment.startTime)}%`
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingSegment(segment.id);
                }}
                data-testid={`segment-${segment.id}`}
              >
                <div className="text-xs font-medium text-primary group-hover:scale-110 transition-transform">
                  {Math.round(segment.speedFactor * 100)}%
                </div>
              </div>
            ))}
            
            {/* New segment preview */}
            {isAddingSegment && newSegment.startTime != null && newSegment.endTime != null && (
              <div
                className="absolute top-1 bottom-1 bg-green-500/40 border-2 border-green-500 border-dashed rounded flex items-center justify-center"
                style={{
                  left: `${timeToPosition(newSegment.startTime)}%`,
                  width: `${timeToPosition(newSegment.endTime) - timeToPosition(newSegment.startTime)}%`
                }}
              >
                <div className="text-xs font-medium text-green-600">
                  {Math.round((newSegment.speedFactor || 0.5) * 100)}%
                </div>
              </div>
            )}
            
            {/* Timeline markers */}
            <div className="absolute inset-x-0 top-0 h-1 flex">
              {Array.from({ length: 11 }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 border-l border-muted-foreground/30 first:border-l-0"
                />
              ))}
            </div>
          </div>
        </div>

        {/* Add Segment Controls */}
        {!isAddingSegment && segments.length < maxSegments && (
          <Button
            onClick={() => setIsAddingSegment(true)}
            variant="outline"
            className="w-full"
            data-testid="button-add-segment"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Slow-Motion Segment
          </Button>
        )}

        {/* New Segment Form */}
        {isAddingSegment && (
          <Card className="p-4 border-dashed border-green-500">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <PlayCircle className="w-4 h-4 text-green-600" />
                <h5 className="font-medium">New Slow-Motion Segment</h5>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Start Time</label>
                  <Input
                    type="number"
                    step="0.1"
                    min={timeSelection.start}
                    max={timeSelection.end - 0.5}
                    value={newSegment.startTime?.toFixed(1) || ''}
                    onChange={(e) => setNewSegment(prev => ({
                      ...prev,
                      startTime: parseFloat(e.target.value)
                    }))}
                    data-testid="input-start-time"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">End Time</label>
                  <Input
                    type="number"
                    step="0.1"
                    min={(newSegment.startTime || timeSelection.start) + 0.5}
                    max={timeSelection.end}
                    value={newSegment.endTime?.toFixed(1) || ''}
                    onChange={(e) => setNewSegment(prev => ({
                      ...prev,
                      endTime: parseFloat(e.target.value)
                    }))}
                    data-testid="input-end-time"
                  />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">Speed</label>
                  <span className="text-sm text-muted-foreground">
                    {Math.round((newSegment.speedFactor || 0.5) * 100)}%
                  </span>
                </div>
                <Slider
                  value={[Math.round((newSegment.speedFactor || 0.5) * 100)]}
                  min={10}
                  max={100}
                  step={10}
                  onValueChange={(value) => setNewSegment(prev => ({
                    ...prev,
                    speedFactor: value[0] / 100
                  }))}
                  data-testid="slider-speed-factor"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>10% (Very Slow)</span>
                  <span>100% (Normal)</span>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium">Name (optional)</label>
                <Input
                  placeholder="e.g., Goal Replay, Key Play"
                  value={newSegment.name || ''}
                  onChange={(e) => setNewSegment(prev => ({
                    ...prev,
                    name: e.target.value
                  }))}
                  data-testid="input-segment-name"
                />
              </div>
              
              <div className="flex gap-2">
                <Button onClick={handleAddSegment} size="sm" data-testid="button-confirm-segment">
                  <Clock className="w-4 h-4 mr-2" />
                  Add Segment
                </Button>
                <Button 
                  onClick={() => setIsAddingSegment(false)} 
                  variant="outline" 
                  size="sm"
                  data-testid="button-cancel-segment"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Existing Segments List */}
        {segments.length > 0 && (
          <div className="space-y-3">
            <h5 className="font-medium">Configured Segments</h5>
            {segments.map((segment) => (
              <Card key={segment.id} className="p-3">
                {editingSegment === segment.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        type="number"
                        step="0.1"
                        value={segment.startTime.toFixed(1)}
                        onChange={(e) => handleUpdateSegment(segment.id, {
                          startTime: parseFloat(e.target.value)
                        })}
                        data-testid={`edit-start-${segment.id}`}
                      />
                      <Input
                        type="number"
                        step="0.1"
                        value={segment.endTime.toFixed(1)}
                        onChange={(e) => handleUpdateSegment(segment.id, {
                          endTime: parseFloat(e.target.value)
                        })}
                        data-testid={`edit-end-${segment.id}`}
                      />
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => setEditingSegment(null)}>
                          Save
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-primary rounded-full" />
                      <div>
                        <div className="font-medium text-sm">
                          {segment.name || `Segment ${segments.indexOf(segment) + 1}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTime(segment.startTime)} - {formatTime(segment.endTime)} • {Math.round(segment.speedFactor * 100)}% speed
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingSegment(segment.id)}
                        data-testid={`button-edit-${segment.id}`}
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteSegment(segment.id)}
                        data-testid={`button-delete-${segment.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Info */}
        <div className="p-3 bg-muted/30 rounded-lg">
          <div className="flex items-start gap-2">
            <FastForward className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted-foreground">
              <p><strong>Tip:</strong> Click on the timeline to position a new segment, or click existing segments to edit them.</p>
              <p className="mt-1">Slow-motion segments will be processed in chronological order during video generation.</p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}