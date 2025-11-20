import VideoPreview from '../VideoPreview';

export default function VideoPreviewExample() {
  const handleDownload = () => {
    console.log('Download triggered in example');
  };

  const handleRestart = () => {
    console.log('Restart triggered in example');
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <VideoPreview
        highlightEffect="spotlight"
        playerPosition={{ x: 45, y: 60 }}
        onDownload={handleDownload}
        onRestart={handleRestart}
      />
    </div>
  );
}