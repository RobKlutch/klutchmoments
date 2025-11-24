import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ZoomIn, 
  ZoomOut, 
  Target, 
  Activity, 
  Users, 
  Settings2,
  Play,
  RotateCcw
} from "lucide-react";

import { type DynamicZoomSettings } from '@/lib/effectRenderer';

interface DynamicZoomProps {
  settings: DynamicZoomSettings;
  onSettingsChange: (settings: DynamicZoomSettings) => void;
  timeSelection: { start: number; end: number };
}

const INTENSITY_PRESETS = {
  subtle: { zoomInLevel: 1.3, zoomOutLevel: 0.9, transitionDuration: 2.0 },
  moderate: { zoomInLevel: 1.8, zoomOutLevel: 0.7, transitionDuration: 1.5 },
  dramatic: { zoomInLevel: 2.5, zoomOutLevel: 0.5, transitionDuration: 1.0 }
};

export default function DynamicZoom({ settings, onSettingsChange, timeSelection }: DynamicZoomProps) {
  const [previewMode, setPreviewMode] = useState(false);

  const updateSettings = useCallback((updates: Partial<DynamicZoomSettings>) => {
    onSettingsChange({ ...settings, ...updates });
  }, [settings, onSettingsChange]);

  const applyIntensityPreset = useCallback((intensity: 'subtle' | 'moderate' | 'dramatic') => {
    const preset = INTENSITY_PRESETS[intensity];
    updateSettings({
      intensity,
      ...preset
    });
  }, [updateSettings]);

  const resetToDefaults = useCallback(() => {
    updateSettings({
      enabled: true,
      intensity: 'moderate',
      playerFocused: true,
      actionTriggered: true,
      contextAware: true,
      multiPlayerSupport: false,
      zoomInLevel: 1.8,
      zoomOutLevel: 0.7,
      transitionDuration: 1.5,
      triggerSensitivity: 0.6
    });
  }, [updateSettings]);

  const duration = timeSelection.end - timeSelection.start;

  return (
    <Card className="w-full" data-testid="card-dynamic-zoom">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ZoomIn className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Dynamic Zoom</CardTitle>
            {settings.enabled && (
              <Badge variant="secondary" className="capitalize">
                {settings.intensity}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetToDefaults}
              data-testid="button-reset-zoom"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${settings.enabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                Zoom OFF
              </span>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(enabled) => updateSettings({ enabled })}
                data-testid="switch-enable-zoom"
              />
              <span className={`text-sm font-medium ${settings.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                Zoom ON
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Zoom Intensity Presets */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Zoom Intensity</Label>
          <div className="grid grid-cols-3 gap-2">
            {(['subtle', 'moderate', 'dramatic'] as const).map((intensity) => (
              <Button
                key={intensity}
                variant={settings.intensity === intensity ? "default" : "outline"}
                size="sm"
                onClick={() => applyIntensityPreset(intensity)}
                className="capitalize"
                data-testid={`button-intensity-${intensity}`}
              >
                {intensity}
              </Button>
            ))}
          </div>
        </div>

        {/* Zoom Features */}
        <div className="space-y-4">
          <Label className="text-sm font-medium">Zoom Features</Label>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-500" />
                <span className="text-sm">Player Focus</span>
              </div>
              <Switch
                checked={settings.playerFocused}
                onCheckedChange={(playerFocused) => updateSettings({ playerFocused })}
                data-testid="switch-player-focused"
              />
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-green-500" />
                <span className="text-sm">Action Trigger</span>
              </div>
              <Switch
                checked={settings.actionTriggered}
                onCheckedChange={(actionTriggered) => updateSettings({ actionTriggered })}
                data-testid="switch-action-triggered"
              />
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-orange-500" />
                <span className="text-sm">Context Aware</span>
              </div>
              <Switch
                checked={settings.contextAware}
                onCheckedChange={(contextAware) => updateSettings({ contextAware })}
                data-testid="switch-context-aware"
              />
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-500" />
                <span className="text-sm">Multi-Player</span>
              </div>
              <Switch
                checked={settings.multiPlayerSupport}
                onCheckedChange={(multiPlayerSupport) => updateSettings({ multiPlayerSupport })}
                data-testid="switch-multi-player"
              />
            </div>
          </div>
        </div>

        {/* Advanced Controls */}
        <div className="space-y-4">
          <Label className="text-sm font-medium">Advanced Controls</Label>
          
          <div className="space-y-4">
            {/* Zoom In Level */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Zoom In Level</Label>
                <span className="text-xs font-mono">{settings.zoomInLevel.toFixed(1)}x</span>
              </div>
              <Slider
                value={[settings.zoomInLevel]}
                onValueChange={([zoomInLevel]) => updateSettings({ zoomInLevel })}
                min={1.0}
                max={3.0}
                step={0.1}
                className="w-full"
                data-testid="slider-zoom-in-level"
              />
            </div>

            {/* Zoom Out Level */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Zoom Out Level</Label>
                <span className="text-xs font-mono">{settings.zoomOutLevel.toFixed(1)}x</span>
              </div>
              <Slider
                value={[settings.zoomOutLevel]}
                onValueChange={([zoomOutLevel]) => updateSettings({ zoomOutLevel })}
                min={0.5}
                max={1.0}
                step={0.1}
                className="w-full"
                data-testid="slider-zoom-out-level"
              />
            </div>

            {/* Transition Duration */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Transition Duration</Label>
                <span className="text-xs font-mono">{settings.transitionDuration.toFixed(1)}s</span>
              </div>
              <Slider
                value={[settings.transitionDuration]}
                onValueChange={([transitionDuration]) => updateSettings({ transitionDuration })}
                min={0.5}
                max={3.0}
                step={0.1}
                className="w-full"
                data-testid="slider-transition-duration"
              />
            </div>

            {/* Trigger Sensitivity */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Trigger Sensitivity</Label>
                <span className="text-xs font-mono">{Math.round(settings.triggerSensitivity * 100)}%</span>
              </div>
              <Slider
                value={[settings.triggerSensitivity]}
                onValueChange={([triggerSensitivity]) => updateSettings({ triggerSensitivity })}
                min={0.1}
                max={1.0}
                step={0.1}
                className="w-full"
                data-testid="slider-trigger-sensitivity"
              />
            </div>
          </div>
        </div>

        {/* Preview Info */}
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <ZoomOut className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Zoom Preview</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Duration:</span>
              <span className="ml-1 font-mono">{duration.toFixed(1)}s</span>
            </div>
            <div>
              <span className="text-muted-foreground">Transitions:</span>
              <span className="ml-1 font-mono">~{Math.ceil(duration / settings.transitionDuration)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}