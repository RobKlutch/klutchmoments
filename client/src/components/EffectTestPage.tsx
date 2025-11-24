import { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import EffectStaticPreview from './EffectStaticPreview';
import { type EffectSettings } from '@/lib/effectRenderer';

/**
 * **EFFECT TEST PAGE**: Quick testing interface for EffectStaticPreview debugging
 * This component allows us to test all effect types with sample data to verify the fixes work
 */
export default function EffectTestPage() {
  const [selectedEffect, setSelectedEffect] = useState('spotlight');
  const [settings, setSettings] = useState<EffectSettings>({
    intensity: 80,
    size: 100,
    color: '#3b82f6'
  });

  // Sample test data - simulates a soccer field with player selection
  const samplePreviewData = 'data:image/svg+xml;base64,' + btoa(`
    <svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="360" fill="#4ade80"/>
      <rect x="50" y="50" width="540" height="260" fill="#22c55e" stroke="#16a34a" stroke-width="3"/>
      <circle cx="320" cy="180" r="60" fill="none" stroke="#16a34a" stroke-width="2"/>
      <line x1="320" y1="50" x2="320" y2="310" stroke="#16a34a" stroke-width="2"/>
      <!-- Player figure at center -->
      <circle cx="320" cy="180" r="8" fill="#1f2937"/>
      <rect x="316" y="172" width="8" height="16" fill="#3b82f6"/>
      <text x="335" y="185" font-family="Arial" font-size="12" fill="#1f2937">Player</text>
    </svg>
  `);

  // Sample player coordinates (normalized 0-1, centered on the player figure)
  const samplePlayer = {
    x: 0.5,     // Center X (320/640 = 0.5)
    y: 0.5,     // Center Y (180/360 = 0.5)
    width: 0.1, // 10% width relative to field
    height: 0.15 // 15% height relative to field
  };

  const effects = [
    { id: 'spotlight', name: 'Spotlight' },
    { id: 'beam', name: 'Beam' },
    { id: 'circle', name: 'Circle' },
    { id: 'aura', name: 'Aura' },
    { id: 'footdisk', name: 'Foot Disk' },
    { id: 'square', name: 'Square' }
  ];

  const colors = [
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Green', value: '#10b981' },
    { name: 'Yellow', value: '#f59e0b' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'White', value: '#ffffff' }
  ];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Effect Test Page</h1>
          <p className="text-muted-foreground">Testing EffectStaticPreview rendering with sample data</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Controls */}
          <Card className="p-6 space-y-6">
            <h3 className="text-lg font-semibold">Test Controls</h3>
            
            {/* Effect Selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">Effect Type</label>
              <div className="grid grid-cols-2 gap-2">
                {effects.map((effect) => (
                  <Button
                    key={effect.id}
                    variant={selectedEffect === effect.id ? 'default' : 'outline'}
                    onClick={() => setSelectedEffect(effect.id)}
                    className="text-sm"
                    data-testid={`test-effect-${effect.id}`}
                  >
                    {effect.name}
                  </Button>
                ))}
              </div>
            </div>

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
                onValueChange={(value) => setSettings({...settings, intensity: value[0]})}
                data-testid="test-intensity-slider"
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
                max={200}
                min={50}
                step={10}
                onValueChange={(value) => setSettings({...settings, size: value[0]})}
                data-testid="test-size-slider"
              />
            </div>

            {/* Color Selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">Color</label>
              <div className="grid grid-cols-3 gap-2">
                {colors.map((color) => (
                  <Button
                    key={color.value}
                    variant={settings.color === color.value ? 'default' : 'outline'}
                    onClick={() => setSettings({...settings, color: color.value})}
                    className="text-xs flex items-center gap-2"
                    data-testid={`test-color-${color.value}`}
                  >
                    <div 
                      className="w-3 h-3 rounded-full border"
                      style={{ backgroundColor: color.value }}
                    />
                    {color.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Current Settings Debug */}
            <div className="p-4 bg-muted/30 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Debug Info</h4>
              <div className="text-xs space-y-1 font-mono">
                <div>Effect: {selectedEffect}</div>
                <div>Intensity: {settings.intensity}%</div>
                <div>Size: {settings.size}%</div>
                <div>Color: {settings.color}</div>
                <div>Player: x={samplePlayer.x}, y={samplePlayer.y}</div>
                <div>Player size: {samplePlayer.width}x{samplePlayer.height}</div>
              </div>
            </div>
          </Card>

          {/* Preview */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Effect Preview</h3>
            <EffectStaticPreview
              previewFrameDataUrl={samplePreviewData}
              selectedPlayer={samplePlayer}
              effect={selectedEffect}
              effectSettings={settings}
              className="w-full"
              showSettings={true}
              data-testid="test-effect-preview"
            />
            
            <div className="text-sm text-muted-foreground">
              ✅ If you see a visual effect (spotlight, beam, etc.) over the player figure, the fixes are working!
              <br />
              🔍 Red crosshair marks the effect center (only in development mode)
              <br />
              📊 Check browser console for detailed logging
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}