import VideoTimeline from '../VideoTimeline';

export default function VideoTimelineExample() {
  const handleTimeSelection = (startTime: number, endTime: number) => {
    console.log('Time selection in example:', startTime, 'to', endTime);
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <VideoTimeline
        videoDuration={60}
        onTimeSelection={handleTimeSelection}
        maxClipLength={15}
        minClipLength={12}
      />
    </div>
  );
}