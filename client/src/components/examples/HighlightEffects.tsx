import HighlightEffects from '../HighlightEffects';

export default function HighlightEffectsExample() {
  const handleEffectSelect = (effect: any, settings: any) => {
    console.log('Effect selected in example:', effect.name, settings);
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <HighlightEffects onEffectSelect={handleEffectSelect} />
    </div>
  );
}