"""
GPU Microservice for YOLOv8 + ByteTrack Video Processing
Main FastAPI application with health check and video processing endpoints.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional, Dict

import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config.settings import Settings
from .models.schemas import (
    HealthResponse,
    ProcessingRequest,
    ProcessingResponse,
    ProcessingStatus
)
from .video_processing.pipeline import VideoProcessor
from .models.detector import YOLOv8Detector
from .tracking.bytetrack import ByteTracker

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global instances
settings = Settings()
detector: Optional[YOLOv8Detector] = None
tracker: Optional[ByteTracker] = None
video_processor: Optional[VideoProcessor] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources."""
    global detector, tracker, video_processor
    
    logger.info("🚀 Starting GPU Microservice...")
    start_time = time.time()
    
    # Store start time for uptime reporting
    app.state.start_time = start_time
    
    try:
        # Initialize YOLOv8 detector
        logger.info("📦 Loading YOLOv8 model...")
        detector = YOLOv8Detector(
            model_name=settings.yolo_model,
            device=settings.device,
            confidence_threshold=settings.confidence_threshold
        )
        await detector.initialize()
        
        # Initialize ByteTracker
        logger.info("🔗 Initializing ByteTracker...")
        tracker = ByteTracker(
            track_thresh=settings.track_thresh,
            track_buffer=settings.track_buffer,
            match_thresh=settings.match_thresh,
            frame_rate=settings.default_fps
        )
        
        # Initialize video processor
        logger.info("🎬 Setting up video processor...")
        video_processor = VideoProcessor(
            detector=detector,
            tracker=tracker,
            settings=settings
        )
        
        init_time = time.time() - start_time
        logger.info(f"✅ GPU Microservice ready in {init_time:.2f}s")
        
        yield
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize service: {e}")
        raise
    finally:
        logger.info("🔄 Shutting down GPU Microservice...")
        if detector:
            detector.cleanup()
        if video_processor:
            video_processor.cleanup()


# Create FastAPI app
app = FastAPI(
    title="GPU Video Processing Service",
    description="YOLOv8 + ByteTrack video processing with spotlight effects",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint - returns service readiness status."""
    global detector, tracker, video_processor
    
    # Check if all components are initialized
    is_ready = all([
        detector is not None,
        tracker is not None,
        video_processor is not None,
        detector.is_ready() if detector else False
    ])
    
    gpu_available = detector.is_gpu_available() if detector else False
    
    return HealthResponse(
        status="ready" if is_ready else "initializing",
        gpu_available=gpu_available,
        model_loaded=detector.is_ready() if detector else False,
        version="1.0.0",
        uptime=time.time() - app.state.start_time if hasattr(app.state, 'start_time') else 0
    )


@app.post("/process", response_model=ProcessingResponse)
async def process_video(
    request: ProcessingRequest,
    background_tasks: BackgroundTasks
):
    """Main video processing endpoint."""
    global video_processor
    
    if not video_processor:
        raise HTTPException(
            status_code=503,
            detail="Video processor not initialized"
        )
    
    logger.info(f"🎬 Processing request: {request.video_path}")
    
    try:
        # Validate video path
        if not os.path.exists(request.video_path):
            raise HTTPException(
                status_code=400,
                detail=f"Video file not found: {request.video_path}"
            )
        
        # Start processing
        result = await video_processor.process_video(request)
        
        logger.info(f"✅ Processing completed: {result.output_path}")
        return result
        
    except Exception as e:
        logger.error(f"❌ Processing failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Processing failed: {str(e)}"
        )


@app.get("/status/{job_id}")
async def get_processing_status(job_id: str) -> ProcessingStatus:
    """Get processing status for a job."""
    global video_processor
    
    if not video_processor:
        raise HTTPException(
            status_code=503,
            detail="Video processor not initialized"
        )
    
    status = video_processor.get_job_status(job_id)
    if not status:
        raise HTTPException(
            status_code=404,
            detail=f"Job not found: {job_id}"
        )
    
    return status


@app.post("/detect")
async def detect_frame(
    frame_data: dict
):
    """Single frame detection endpoint for live preview."""
    global detector
    
    if not detector or not detector.is_ready():
        raise HTTPException(
            status_code=503,
            detail="YOLOv8 detector not initialized"
        )
    
    try:
        # Decode base64 image data
        import base64
        import cv2
        import numpy as np
        
        image_data = frame_data.get("imageDataUrl", "")
        timestamp = frame_data.get("timestampMs", 0) / 1000.0
        
        # Remove data URL prefix
        if image_data.startswith("data:image/"):
            image_data = image_data.split(",", 1)[1]
        
        # Decode base64 to bytes
        image_bytes = base64.b64decode(image_data)
        
        # Convert to numpy array
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise HTTPException(
                status_code=400,
                detail="Invalid image data"
            )
        
        # Run detection
        result = await detector.detect_frame(frame, 0, timestamp)
        
        # Convert to response format compatible with frontend
        players = []
        for i, bbox in enumerate(result.detections):
            players.append({
                "id": f"player_{i + 1}",
                "x": bbox.x,  # Center X
                "y": bbox.y,  # Center Y
                "width": bbox.width,
                "height": bbox.height,
                "confidence": bbox.confidence,
                "description": f"Player {i + 1}",
                # Canonical coordinates
                "centerX": bbox.x,
                "centerY": bbox.y,
                "topLeftX": bbox.x - bbox.width / 2,
                "topLeftY": bbox.y - bbox.height / 2,
            })
        
        response = {
            "success": True,
            "timestamp": timestamp,
            "frameAnalysis": {
                "totalPlayers": len(players),
            },
            "players": players,
            "processingTime": result.processing_time
        }
        
        logger.info(f"🎯 YOLOv8 detected {len(players)} players in {result.processing_time:.1f}ms")
        return response
        
    except Exception as e:
        logger.error(f"❌ Frame detection failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Detection failed: {str(e)}"
        )


# Global tracking state for persistent IDs across frames
session_trackers: Dict[str, Dict] = {}

@app.post("/track")
async def track_frame(frame_data: dict):
    """
    Frame tracking endpoint with persistent player IDs.
    Maintains consistent track_id across frames to prevent drifting.
    """
    global detector, session_trackers
    
    if not detector or not detector.is_ready():
        raise HTTPException(
            status_code=503,
            detail="YOLOv8 detector not initialized"
        )
    
    try:
        # Extract parameters
        image_data = frame_data.get("imageDataUrl", "")
        timestamp = frame_data.get("timestampMs", 0) / 1000.0
        session_id = frame_data.get("sessionId", "default")
        
        # Initialize session tracker if needed
        if session_id not in session_trackers:
            session_trackers[session_id] = {
                "tracks": {},  # track_id -> last position
                "next_id": 1,
                "last_timestamp": 0
            }
        
        tracker = session_trackers[session_id]
        
        # Decode base64 image data (same as /detect)
        import base64
        import cv2
        import numpy as np
        
        if image_data.startswith("data:image/"):
            image_data = image_data.split(",", 1)[1]
        
        image_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise HTTPException(
                status_code=400,
                detail="Invalid image data"
            )
        
        # Run detection
        result = await detector.detect_frame(frame, 0, timestamp)
        detections = result.detections
        
        # Simple tracking: assign consistent IDs based on distance
        current_tracks = {}
        for detection in detections:
            best_track_id = None
            min_distance = float('inf')
            detection_center = (detection.x, detection.y)
            
            # Find closest existing track
            for track_id, track_data in tracker["tracks"].items():
                last_pos = (track_data["x"], track_data["y"])
                distance = ((detection_center[0] - last_pos[0])**2 + 
                           (detection_center[1] - last_pos[1])**2)**0.5
                
                # Only match if within reasonable distance (0.1 = 10% of screen)
                if distance < 0.1 and distance < min_distance:
                    min_distance = distance
                    best_track_id = track_id
            
            # Assign track ID
            if best_track_id is not None:
                track_id = best_track_id
            else:
                track_id = tracker["next_id"]
                tracker["next_id"] += 1
            
            # Update tracker
            current_tracks[track_id] = {
                "x": detection.x,
                "y": detection.y,
                "width": detection.width,
                "height": detection.height,
                "confidence": detection.confidence,
                "timestamp": timestamp
            }
        
        # Update session tracker (keep only active tracks)
        tracker["tracks"] = current_tracks
        tracker["last_timestamp"] = timestamp
        
        # Clean up old sessions (older than 60 seconds)
        current_time = timestamp
        for sid in list(session_trackers.keys()):
            if current_time - session_trackers[sid]["last_timestamp"] > 60:
                del session_trackers[sid]
        
        # Convert to response format
        players = []
        for track_id, track_data in current_tracks.items():
            players.append({
                "id": f"track_{track_id}",  # Use track_ prefix for consistency
                "track_id": track_id,      # Include numeric track_id
                "x": track_data["x"],
                "y": track_data["y"],
                "width": track_data["width"],
                "height": track_data["height"],
                "confidence": track_data["confidence"],
                "description": f"Player {track_id}",
                # Canonical coordinates
                "centerX": track_data["x"],
                "centerY": track_data["y"],
                "topLeftX": track_data["x"] - track_data["width"] / 2,
                "topLeftY": track_data["y"] - track_data["height"] / 2,
            })
        
        response = {
            "success": True,
            "timestamp": timestamp,
            "sessionId": session_id,
            "frameAnalysis": {
                "totalPlayers": len(players),
            },
            "players": players,
            "processingTime": result.processing_time,
            "trackingMode": True
        }
        
        logger.info(f"🎯 TRACKING: {len(players)} players tracked for session {session_id}")
        return response
        
    except Exception as e:
        logger.error(f"❌ Frame tracking failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Tracking failed: {str(e)}"
        )


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler."""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )


if __name__ == "__main__":
    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level="info"
    )