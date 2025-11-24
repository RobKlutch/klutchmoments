import VideoUpload from '../VideoUpload';

export default function VideoUploadExample() {
  const handleVideoSelect = (file: File) => {
    console.log('Video selected in example:', file.name);
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <VideoUpload onVideoSelect={handleVideoSelect} maxSizeGB={2} />
    </div>
  );
}