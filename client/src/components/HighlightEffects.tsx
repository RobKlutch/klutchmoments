import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Circle, Disc, Zap, Target, Palette, Crown, Rewind } from "lucide-react";
import EffectStaticPreview from '@/components/EffectStaticPreview';
import SlowMotionSegments from '@/components/SlowMotionSegments';
import DynamicZoom from '@/components/DynamicZoom';
import { type EffectSettings, type SlowMotionSegment, type DynamicZoomSettings } from '@/lib/effectRenderer';
import { useAuth } from '@/hooks/use-auth';
import ErrorBoundary from '@/components/ErrorBoundary';

interface HighlightEffect {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  preview: string;
}

interface HighlightEffectsProps {
  onEffectSelect?: (effect: HighlightEffect, settings: EffectSettings) => void;
  onConfirm?: () => void;
  onBack?: () => void;
  previewFrameDataUrl?: string;
  selectedPlayer?: {
    x: number;
    y: number;
    width: number;
    height: number;
    [key: string]: any;
  };
  timeSelection?: { start: number; end: number };
}

// EffectSettings interface is now imported from effectRenderer

export default function HighlightEffects({ 
  onEffectSelect, 
  onConfirm, 
  onBack, 
  previewFrameDataUrl, 
  selectedPlayer,
  timeSelection
}: HighlightEffectsProps) {
  const { user } = useAuth();
  const [selectedEffect, setSelectedEffect] = useState<HighlightEffect | null>(null);
  const [activeTab, setActiveTab] = useState<'effects'|'zoom'|'slowmotion'>('effects');
  const zoomInitRef = useRef(false);
  const [settings, setSettings] = useState<EffectSettings>({
    intensity: 80,
    size: 100,
    color: '#3b82f6',
    slowMotionSegments: [],
    dynamicZoom: {
      enabled: false,
      intensity: 'moderate',
      playerFocused: true,
      actionTriggered: true,
      contextAware: true,
      multiPlayerSupport: false,
      zoomInLevel: 1.8,
      zoomOutLevel: 0.7,
      transitionDuration: 1.5,
      triggerSensitivity: 0.6
    }
  });

  // Check if current user is admin
  const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

  // Default zoom settings for auto-selection
  const defaultZoom: DynamicZoomSettings = {
    enabled: false,
    intensity: 'moderate',
    playerFocused: true,
    actionTriggered: true,
    contextAware: true,
    multiPlayerSupport: false,
    zoomInLevel: 1.8,
    zoomOutLevel: 0.7,
    transitionDuration: 1.5,
    triggerSensitivity: 0.6,
  };

  const effects: HighlightEffect[] = [
    {
      id: 'beam',
      name: 'Spotlight Ring',
      description: 'Circular spotlight ring around the player',
      icon: <Circle className="w-5 h-5" />,
      preview: 'Bright circular ring highlighting the player with smooth tracking'
    },
    {
      id: 'footdisk',
      name: 'Ground Halo',
      description: 'Glowing disk at ground level beneath the player',
      icon: <Disc className="w-5 h-5" />,
      preview: 'Animated disk at ground level that follows player movement'
    },
    {
      id: 'aura',
      name: 'Player Aura',
      description: 'Soft glow surrounding the player',
      icon: <Zap className="w-5 h-5" />,
      preview: 'Dynamic outline that adapts to player shape and movement'
    },
    {
      id: 'focuscircle',
      name: 'Focus Circle',
      description: 'Bright circular area with dimmed surroundings',
      icon: <Target className="w-5 h-5" />,
      preview: 'Professional broadcast-style focus with bright center and dimmed background'
    }
  ];

  // **INITIAL DYNAMIC ZOOM PREVIEW**: Auto-select default spotlight effect when entering zoom tab if none selected
  useEffect(() => {
    if (activeTab !== 'zoom') { 
      zoomInitRef.current = false; 
      return; 
    }
    if (!timeSelection || zoomInitRef.current) return;
    
    zoomInitRef.current = true;
    
    // If no spotlight effect is selected, auto-select Focus Circle as default for zoom preview
    if (!selectedEffect) {
      const defaultEffect = effects.find(e => e.id === 'focuscircle') || effects[0];
      setSelectedEffect(defaultEffect);
      onEffectSelect?.(defaultEffect, settings);
      console.log('🎯 Auto-selected default spotlight effect for zoom preview:', defaultEffect.name);
    }
  }, [activeTab, timeSelection, selectedEffect, effects, settings, onEffectSelect]);

  const colors = [
    { name: 'Electric Blue', value: '#3b82f6' },
    { name: 'Bright Green', value: '#10b981' },
    { name: 'Golden Yellow', value: '#f59e0b' },
    { name: 'Vibrant Red', value: '#ef4444' },
    { name: 'Black', value: '#000000' },
    { name: 'White Beam', value: '#ffffff' }
  ];

  const handleEffectSelect = (effect: HighlightEffect) => {
    setSelectedEffect(effect);
    onEffectSelect?.(effect, settings);
    console.log('Effect selected:', effect.name, 'with settings:', settings);
  };

  const handleSettingChange = (key: keyof EffectSettings, value: number | string | SlowMotionSegment[]) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    
    if (selectedEffect) {
      onEffectSelect?.(selectedEffect, newSettings);
    }
    
    console.log('Effect setting changed:', key, value);
  };

  const handleSlowMotionSegmentsChange = (segments: SlowMotionSegment[]) => {
    handleSettingChange('slowMotionSegments', segments);
  };

  return (
    <ErrorBoundary 
      fallbackMessage="An error occurred while loading the Effects stage. The spotlight effects are currently unavailable."
      onReload={() => window.location.reload()}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h3 className="text-lg font-display font-semibold mb-2">Choose Highlight Effect</h3>
          <p className="text-sm text-muted-foreground">
            Select the type of visual effect that will follow your player
          </p>
        </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Effect Controls */}
        <div className="space-y-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'effects'|'zoom'|'slowmotion')} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="effects" data-testid="tab-effects">
                <Target className="w-4 h-4 mr-2" />
                Spotlight Effects
              </TabsTrigger>
              <TabsTrigger value="zoom" data-testid="tab-zoom">
                <Zap className="w-4 h-4 mr-2" />
                Dynamic Zoom
              </TabsTrigger>
              <TabsTrigger value="slowmotion" data-testid="tab-slowmotion">
                <Rewind className="w-4 h-4 mr-2" />
                Slow Motion
              </TabsTrigger>
            </TabsList>

            <TabsContent value="effects" className="mt-6">
              <Card className="p-6">

      {/* Effect Selection */}
      <div className="grid gap-4 mb-6">
        {effects.map((effect) => (
          <div
            key={effect.id}
            className={`
              border rounded-lg p-4 cursor-pointer transition-all duration-200 hover-elevate
              ${selectedEffect?.id === effect.id 
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20' 
                : 'border-border hover:border-primary/50'
              }
            `}
            onClick={() => handleEffectSelect(effect)}
            data-testid={`effect-option-${effect.id}`}
          >
            <div className="flex items-start gap-3">
              <div className={`
                w-10 h-10 rounded-lg flex items-center justify-center
                ${selectedEffect?.id === effect.id 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-accent text-accent-foreground'
                }
              `}>
                {effect.icon}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium">{effect.name}</h4>
                  {selectedEffect?.id === effect.id && (
                    <Badge variant="default" className="text-xs">Selected</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-2">{effect.description}</p>
                <p className="text-xs text-muted-foreground italic">{effect.preview}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Effect Settings */}
      {selectedEffect && (
        <div className="border-t pt-6 space-y-6">
          <h4 className="font-medium">Customize Effect</h4>
          
          {/* Intensity */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Intensity</label>
              <span className="text-sm text-muted-foreground">{settings.intensity}%</span>
            </div>
            <Slider
              value={[settings.intensity]}
              max={100}
              min={10}
              step={10}
              onValueChange={(value) => handleSettingChange('intensity', value[0])}
              data-testid="slider-intensity"
            />
          </div>

          {/* Size */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Size</label>
              <span className="text-sm text-muted-foreground">{settings.size}%</span>
            </div>
            <Slider
              value={[settings.size]}
              max={150}
              min={30}
              step={10}
              onValueChange={(value) => handleSettingChange('size', value[0])}
              data-testid="slider-size"
            />
          </div>

          {/* Color Selection */}
          <div>
            <label className="text-sm font-medium mb-3 block">Color</label>
            <div className="grid grid-cols-3 gap-2">
              {colors.map((color) => (
                <button
                  key={color.value}
                  className={`
                    flex items-center gap-2 p-2 rounded-md text-sm transition-all hover-elevate
                    ${settings.color === color.value 
                      ? 'bg-primary/10 border-2 border-primary' 
                      : 'border border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() => handleSettingChange('color', color.value)}
                  data-testid={`color-option-${color.value}`}
                >
                  <div 
                    className="w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: color.value }}
                  />
                  <span className="text-xs">{color.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Simple Settings Info */}
          <div className="p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Palette className="w-4 h-4" />
              <span className="text-sm font-medium">Current Settings</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {selectedEffect.name} • {settings.intensity}% intensity • {settings.size}% size
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div 
                className="w-6 h-6 rounded-full"
                style={{ 
                  backgroundColor: settings.color,
                  opacity: settings.intensity / 100,
                  transform: `scale(${settings.size / 100})`
                }}
              />
              <span className="text-xs">See live preview on the right</span>
            </div>
          </div>
        </div>
      )}

      {/* Admin Status Indicator */}
      {isAdmin && (
        <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg mb-4">
          <Crown className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-primary">Admin Access: Checkout bypass enabled</span>
        </div>
      )}

      {/* Action Buttons */}
              </Card>
            </TabsContent>

            <TabsContent value="zoom" className="mt-6">
              {timeSelection ? (
                <DynamicZoom
                  settings={settings.dynamicZoom || {
                    enabled: false,
                    intensity: 'moderate',
                    playerFocused: true,
                    actionTriggered: true,
                    contextAware: true,
                    multiPlayerSupport: false,
                    zoomInLevel: 1.8,
                    zoomOutLevel: 0.7,
                    transitionDuration: 1.5,
                    triggerSensitivity: 0.6
                  }}
                  onSettingsChange={(zoomSettings) => {
                    const updatedSettings = {
                      ...settings,
                      dynamicZoom: zoomSettings
                    };
                    setSettings(updatedSettings);
                    
                    // **ZOOM AS ADDITIVE TRANSFORM**: Update settings while keeping current spotlight effect
                    if (selectedEffect) {
                      onEffectSelect?.(selectedEffect, updatedSettings);
                      console.log('🎯 Dynamic Zoom settings updated:', { 
                        enabled: zoomSettings.enabled, 
                        spotlightEffect: selectedEffect.name 
                      });
                    } else {
                      // If no spotlight effect selected, auto-select Focus Circle as default
                      const defaultEffect = effects.find(e => e.id === 'focuscircle') || effects[0];
                      setSelectedEffect(defaultEffect);
                      onEffectSelect?.(defaultEffect, updatedSettings);
                      console.log('🎯 Auto-selected spotlight effect for zoom:', defaultEffect.name);
                    }
                  }}
                  timeSelection={timeSelection}
                  data-testid="dynamic-zoom-controls"
                />
              ) : (
                <Card className="p-6">
                  <div className="text-center space-y-3">
                    <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center">
                      <Zap className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h4 className="font-medium">Time Selection Required</h4>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Please select a time range in the previous step to configure dynamic zoom effects.
                    </p>
                  </div>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="slowmotion" className="mt-6">
              {timeSelection ? (
                <SlowMotionSegments
                  timeSelection={timeSelection}
                  segments={settings.slowMotionSegments || []}
                  onSegmentsChange={handleSlowMotionSegmentsChange}
                  data-testid="slowmotion-segments"
                />
              ) : (
                <Card className="p-6">
                  <div className="text-center space-y-3">
                    <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center">
                      <Rewind className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h4 className="font-medium">Time Selection Required</h4>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Please select a time range in the previous step to configure slow-motion segments.
                    </p>
                  </div>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Static Preview Section */}
        <div className="space-y-4">
          <div className="text-center lg:text-left">
            <h4 className="font-medium mb-2">Live Effect Preview</h4>
            <p className="text-sm text-muted-foreground">
              See exactly how your effect will look on your selected player
            </p>
          </div>
          
          {previewFrameDataUrl && selectedPlayer && selectedEffect ? (
            <EffectStaticPreview
              previewFrameDataUrl={previewFrameDataUrl}
              selectedPlayer={selectedPlayer}
              effect={selectedEffect.id}
              effectSettings={settings}
              className="w-full"
              showSettings={true}
              data-testid="effect-live-preview"
            />
          ) : (
            <Card className="p-8">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center">
                  <Palette className="w-8 h-8 text-muted-foreground" />
                </div>
                <h4 className="font-medium">Preview Not Available</h4>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  {!previewFrameDataUrl 
                    ? "Please complete the previous steps to see effect preview"
                    : !selectedPlayer 
                    ? "Please select a player in the previous step"
                    : "Please select an effect to see preview"
                  }
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Continue Button Section */}
      <div className="flex justify-between items-center pt-6 border-t">
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
          onClick={onConfirm}
          disabled={!selectedEffect}
          data-testid={isAdmin ? "button-process-video-admin" : "button-continue-checkout"}
        >
          {isAdmin ? (
            <>
              <Crown className="w-4 h-4 mr-2" />
              Process Video (Admin)
            </>
          ) : (
            "Continue to Checkout"
          )}
        </Button>
      </div>
      </div>
    </ErrorBoundary>
  );
}