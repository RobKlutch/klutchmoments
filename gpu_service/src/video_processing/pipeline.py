"""
Main video processing pipeline combining YOLO detection, ByteTrack tracking,
spotlight effects, and FFmpeg encoding.
"""

import asyncio
import logging
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np
import ffmpeg

from ..models.schemas import (
    ProcessingRequest,
    ProcessingResponse,
    ProcessingStatus,
    ProcessingStage,
    TrackingMetadata,
    TrackingData,
    BoundingBox
)
from ..models.detector import YOLOv8Detector
from ..tracking.bytetrack import ByteTracker
from ..effects.spotlight_renderer import SpotlightRenderer
from ..config.settings import Settings

logger = logging.getLogger(__name__)


class VideoProcessor:
    """Main video processing pipeline."""
    
    def __init__(
        self,
        detector: YOLOv8Detector,
        tracker: ByteTracker,
        settings: Settings
    ):
        self.detector = detector
        self.tracker = tracker
        self.settings = settings
        
        # Job tracking
        self.active_jobs: Dict[str, ProcessingStatus] = {}
        self.job_semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        
    async def process_video(
        self,
        request: ProcessingRequest
    ) -> ProcessingResponse:
        """Process video with full pipeline."""
        job_id = str(uuid.uuid4())
        start_time = time.time()
        
        # Initialize job status
        status = ProcessingStatus(
            job_id=job_id,
            stage=ProcessingStage.QUEUED,
            progress=0.0,
            message="Job queued",
            started_at=start_time
        )
        self.active_jobs[job_id] = status
        
        try:
            async with self.job_semaphore:
                logger.info(f"🎬 Starting video processing job: {job_id}")
                
                # Load and validate video
                cap, fps, total_frames, duration = await self._load_video(request.video_path)
                
                # Update job status
                status.stage = ProcessingStage.DETECTING
                status.message = "Loading video and initializing detection"
                status.progress = 0.1
                
                # Determine processing range
                start_frame = max(0, int(request.start_time * fps))
                end_frame = min(
                    total_frames - 1,
                    int(request.end_time * fps) if request.end_time else total_frames - 1
                )
                processing_frames = end_frame - start_frame + 1
                
                logger.info(
                    f"📊 Processing frames {start_frame}-{end_frame} "
                    f"({processing_frames} frames, {fps} FPS)"
                )
                
                # Create output path
                output_path = self._create_output_path(request.output_filename)
                temp_video_path = os.path.join(
                    self.settings.temp_dir,
                    f"{job_id}_temp.mp4"
                )
                
                # Process video frames
                tracking_data = await self._process_frames(
                    cap, start_frame, end_frame, fps, status, temp_video_path, request
                )
                
                # Finalize video with FFmpeg
                status.stage = ProcessingStage.ENCODING
                status.message = "Finalizing video with FFmpeg"
                status.progress = 0.9
                
                await self._finalize_video(temp_video_path, output_path)
                
                # Calculate performance metrics
                processing_time = time.time() - start_time
                performance_metrics = {
                    "processing_time_seconds": processing_time,
                    "frames_per_second": processing_frames / processing_time,
                    "realtime_factor": duration / processing_time,
                    "detector_stats": self.detector.get_performance_stats(),
                    "tracker_stats": self.tracker.get_performance_stats()
                }
                
                # Create tracking metadata
                metadata = TrackingMetadata(
                    total_frames=processing_frames,
                    fps=fps,
                    duration=duration,
                    tracks=tracking_data,
                    player_count=len(set(t.track_id for t in tracking_data))
                )
                
                # Complete job
                status.stage = ProcessingStage.COMPLETED
                status.progress = 1.0
                status.message = "Processing completed successfully"
                
                logger.info(
                    f"✅ Job {job_id} completed in {processing_time:.2f}s "
                    f"({performance_metrics['realtime_factor']:.1f}x realtime)"
                )
                
                # Cleanup
                cap.release()
                if os.path.exists(temp_video_path):
                    os.remove(temp_video_path)
                
                return ProcessingResponse(
                    job_id=job_id,
                    output_path=output_path,
                    processing_time=processing_time,
                    tracking_metadata=metadata,
                    effect_applied=request.effect_config,
                    performance_metrics=performance_metrics
                )
                
        except Exception as e:
            logger.error(f"❌ Job {job_id} failed: {e}")
            status.stage = ProcessingStage.FAILED
            status.error = str(e)
            status.message = f"Processing failed: {str(e)}"
            raise
        finally:
            # Keep job status for a while for status queries
            asyncio.create_task(self._cleanup_job_status(job_id, delay=300))
    
    async def _load_video(
        self,
        video_path: str
    ) -> tuple[cv2.VideoCapture, float, int, float]:
        """Load and validate video file."""
        # Path safety validation - prevent directory traversal attacks
        resolved_path = Path(video_path).resolve()
        
        # Ensure the resolved path doesn't contain directory traversal patterns
        if '..' in str(resolved_path) or not str(resolved_path).startswith('/'):
            raise ValueError(f"Invalid video path: {video_path}")
        
        # Check if path exists within allowed directories (configurable via settings)
        allowed_dirs = getattr(self.settings, 'allowed_video_dirs', ['/tmp', '/app/uploads'])
        path_allowed = any(str(resolved_path).startswith(allowed_dir) for allowed_dir in allowed_dirs)
        
        if not path_allowed:
            raise ValueError(f"Video path not allowed: {video_path}")
        
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video: {video_path}")
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps
        
        if duration > self.settings.max_video_duration:
            cap.release()
            raise ValueError(
                f"Video too long: {duration:.1f}s "
                f"(max: {self.settings.max_video_duration}s)"
            )
        
        logger.info(
            f"📹 Video loaded: {total_frames} frames, {fps} FPS, {duration:.1f}s"
        )
        
        return cap, fps, total_frames, duration
    
    async def _process_frames(
        self,
        cap: cv2.VideoCapture,
        start_frame: int,
        end_frame: int,
        fps: float,
        status: ProcessingStatus,
        output_path: str,
        request: ProcessingRequest
    ) -> List[TrackingData]:
        """Process video frames with detection, tracking, and effects."""
        # Get video properties
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # Initialize spotlight renderer
        spotlight_renderer = SpotlightRenderer(frame_width, frame_height)
        
        # Initialize video writer - use H264 directly to avoid double encoding
        fourcc = cv2.VideoWriter_fourcc(*'H264')
        out = cv2.VideoWriter(output_path, fourcc, fps, (frame_width, frame_height))
        
        all_tracking_data = []
        selected_track_id = None
        
        try:
            # Seek to start frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            
            processing_frames = end_frame - start_frame + 1
            
            for frame_idx in range(processing_frames):
                current_frame = start_frame + frame_idx
                timestamp = current_frame / fps
                
                # Update progress
                progress = 0.1 + 0.7 * (frame_idx / processing_frames)
                status.progress = progress
                status.message = f"Processing frame {frame_idx + 1}/{processing_frames}"
                
                # Read frame
                ret, frame = cap.read()
                if not ret:
                    logger.warning(f"⚠️ Failed to read frame {current_frame}")
                    break
                
                # Run detection
                detection_result = await self.detector.detect_frame(
                    frame, current_frame, timestamp
                )
                
                # Update tracker
                tracking_data = self.tracker.update(
                    detection_result.detections, timestamp
                )
                
                # Auto-select player on first frame or if none selected
                if selected_track_id is None and tracking_data:
                    if request.player_selection.player_id is not None:
                        selected_track_id = request.player_selection.player_id
                    elif request.player_selection.selection_box is not None:
                        # Find closest track to selection box
                        selected_track_id = self._find_closest_track(
                            tracking_data, request.player_selection.selection_box
                        )
                    elif request.player_selection.auto_select:
                        # Auto-select most prominent player
                        selected_track_id = max(
                            tracking_data,
                            key=lambda t: (
                                t.bounding_box.width * 
                                t.bounding_box.height * 
                                t.bounding_box.confidence
                            )
                        ).track_id
                
                # Apply spotlight effect
                processed_frame = spotlight_renderer.create_overlay_frame(
                    frame,
                    tracking_data,
                    request.effect_config,
                    selected_track_id,
                    frame_idx
                )
                
                # Write frame
                out.write(processed_frame)
                
                # Store tracking data
                all_tracking_data.extend(tracking_data)
                
                # Log progress periodically
                if frame_idx % 30 == 0:
                    logger.debug(
                        f"🎬 Frame {frame_idx}/{processing_frames}: "
                        f"{len(detection_result.detections)} detections, "
                        f"{len(tracking_data)} tracks"
                    )
        
        finally:
            out.release()
        
        return all_tracking_data
    
    def _find_closest_track(
        self,
        tracking_data: List[TrackingData],
        selection_box: BoundingBox
    ) -> Optional[int]:
        """Find track closest to manual selection box."""
        if not tracking_data:
            return None
        
        def box_distance(box1: BoundingBox, box2: BoundingBox) -> float:
            dx = box1.x - box2.x
            dy = box1.y - box2.y
            return np.sqrt(dx*dx + dy*dy)
        
        closest_track = min(
            tracking_data,
            key=lambda t: box_distance(t.bounding_box, selection_box)
        )
        
        return closest_track.track_id
    
    async def _finalize_video(self, temp_path: str, output_path: str):
        """Finalize video with FFmpeg for optimal encoding."""
        try:
            # Parse output resolution
            width, height = map(int, self.settings.output_resolution.split('x'))
            
            # Get input video properties to check if scaling is needed
            probe = ffmpeg.probe(temp_path)
            video_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'video'), None)
            
            if video_stream:
                input_width = int(video_stream['width'])
                input_height = int(video_stream['height'])
                needs_scaling = (input_width != width or input_height != height)
            else:
                needs_scaling = True  # Default to scaling if we can't determine input size
            
            # FFmpeg processing
            stream = ffmpeg.input(temp_path)
            
            if needs_scaling:
                # Scale and re-encode if dimensions don't match
                logger.info(f"🎬 Scaling video from {input_width}x{input_height} to {width}x{height}")
                stream = ffmpeg.filter(stream, 'scale', width, height)
                stream = ffmpeg.output(
                    stream,
                    output_path,
                    vcodec='libx264',
                    preset=self.settings.ffmpeg_preset,
                    crf=self.settings.ffmpeg_crf,
                    r=self.settings.default_fps,
                    movflags='faststart'  # Optimize for streaming
                )
            else:
                # Use stream copy to avoid double-encoding when no scaling needed
                logger.info(f"🚀 Using stream copy - no re-encoding needed ({input_width}x{input_height})")
                stream = ffmpeg.output(
                    stream,
                    output_path,
                    vcodec='copy',  # Copy video stream without re-encoding
                    acodec='copy',  # Copy audio stream if present
                    movflags='faststart'  # Optimize for streaming
                )
            
            # Run FFmpeg and properly await completion
            process = await asyncio.create_subprocess_exec(
                *ffmpeg.compile(stream, overwrite_output=True),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Wait for process completion and capture output
            stdout, stderr = await process.communicate()
            
            # Check return code and handle errors
            if process.returncode != 0:
                error_msg = f"FFmpeg failed with return code {process.returncode}"
                if stderr:
                    error_msg += f": {stderr.decode('utf-8')}"
                logger.error(f"❌ {error_msg}")
                raise RuntimeError(error_msg)
            
            logger.info(f"✅ Video finalized with FFmpeg: {output_path}")
            
        except Exception as e:
            logger.error(f"❌ FFmpeg processing failed: {e}")
            # Fallback: just copy temp file
            import shutil
            shutil.copy2(temp_path, output_path)
            raise  # Re-raise to surface the error
    
    def _create_output_path(self, custom_filename: Optional[str] = None) -> str:
        """Create output file path."""
        if custom_filename:
            filename = custom_filename
            if not filename.endswith('.mp4'):
                filename += '.mp4'
        else:
            timestamp = int(time.time())
            filename = f"highlight_{timestamp}.mp4"
        
        return os.path.join(self.settings.output_dir, filename)
    
    async def _cleanup_job_status(self, job_id: str, delay: int = 300):
        """Cleanup job status after delay."""
        await asyncio.sleep(delay)
        self.active_jobs.pop(job_id, None)
    
    def get_job_status(self, job_id: str) -> Optional[ProcessingStatus]:
        """Get processing status for a job."""
        return self.active_jobs.get(job_id)
    
    def cleanup(self):
        """Cleanup resources."""
        # Cancel active jobs
        for job_id in list(self.active_jobs.keys()):
            status = self.active_jobs[job_id]
            if status.stage not in [ProcessingStage.COMPLETED, ProcessingStage.FAILED]:
                status.stage = ProcessingStage.FAILED
                status.error = "Service shutdown"
        
        logger.info("🧹 Video processor cleanup completed")