import ProcessingStatus from '../ProcessingStatus';

export default function ProcessingStatusExample() {
  const handleComplete = () => {
    console.log('Processing completed in example');
  };

  const handleError = (error: string) => {
    console.log('Processing error in example:', error);
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <ProcessingStatus
        isProcessing={true}
        onComplete={handleComplete}
        onError={handleError}
      />
    </div>
  );
}