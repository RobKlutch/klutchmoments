"""
Pydantic schemas for API requests and responses.
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Union
from pydantic import BaseModel, Field


class EffectType(str, Enum):
    """Available spotlight effect types."""
    CIRCLE = "circle"
    BEAM = "beam"
    GRADIENT = "gradient"


class ProcessingStage(str, Enum):
    """Processing pipeline stages."""
    QUEUED = "queued"
    DETECTING = "detecting"
    TRACKING = "tracking"
    RENDERING = "rendering"
    ENCODING = "encoding"
    COMPLETED = "completed"
    FAILED = "failed"


class BoundingBox(BaseModel):
    """Bounding box coordinates (normalized 0-1)."""
    x: float = Field(..., ge=0.0, le=1.0, description="Center X coordinate")
    y: float = Field(..., ge=0.0, le=1.0, description="Center Y coordinate")
    width: float = Field(..., ge=0.0, le=1.0, description="Box width")
    height: float = Field(..., ge=0.0, le=1.0, description="Box height")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Detection confidence")


class TrackingData(BaseModel):
    """Player tracking information."""
    track_id: int = Field(..., description="Unique track ID")
    bounding_box: BoundingBox
    timestamp: float = Field(..., description="Frame timestamp in seconds")


class EffectConfig(BaseModel):
    """Spotlight effect configuration."""
    type: EffectType = Field(default=EffectType.CIRCLE)
    radius: int = Field(default=150, ge=50, le=500, description="Effect radius in pixels")
    feather: int = Field(default=50, ge=0, le=200, description="Edge feathering in pixels")
    intensity: float = Field(default=0.7, ge=0.0, le=1.0, description="Effect intensity")
    color: str = Field(default="#FFFFFF", description="Effect color (hex)")


class PlayerSelection(BaseModel):
    """Player selection for tracking."""
    player_id: Optional[int] = Field(None, description="Specific player ID to track")
    selection_box: Optional[BoundingBox] = Field(None, description="Manual selection box")
    auto_select: bool = Field(default=True, description="Auto-select most prominent player")


class ProcessingRequest(BaseModel):
    """Video processing request."""
    video_path: str = Field(..., description="Path to input video file")
    start_time: float = Field(default=0.0, ge=0.0, description="Start time in seconds")
    end_time: Optional[float] = Field(None, ge=0.0, description="End time in seconds")
    player_selection: PlayerSelection = Field(default_factory=PlayerSelection)
    effect_config: EffectConfig = Field(default_factory=EffectConfig)
    output_filename: Optional[str] = Field(None, description="Custom output filename")


class ProcessingStatus(BaseModel):
    """Processing job status."""
    job_id: str
    stage: ProcessingStage
    progress: float = Field(..., ge=0.0, le=1.0, description="Progress percentage")
    message: str = Field(default="", description="Status message")
    started_at: datetime
    estimated_completion: Optional[datetime] = None
    error: Optional[str] = None


class TrackingMetadata(BaseModel):
    """Video tracking metadata."""
    total_frames: int
    fps: float
    duration: float
    tracks: List[TrackingData]
    player_count: int = Field(..., description="Number of unique players detected")


class ProcessingResponse(BaseModel):
    """Video processing response."""
    job_id: str
    output_path: str
    processing_time: float = Field(..., description="Processing time in seconds")
    tracking_metadata: TrackingMetadata
    effect_applied: EffectConfig
    performance_metrics: Dict[str, Union[float, int]] = Field(
        default_factory=dict,
        description="Performance metrics (fps, memory usage, etc.)"
    )


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(..., description="Service status: ready, initializing, error")
    gpu_available: bool = Field(..., description="GPU availability")
    model_loaded: bool = Field(..., description="YOLOv8 model loaded")
    version: str = Field(..., description="Service version")
    uptime: float = Field(..., description="Service uptime in seconds")


class DetectionResult(BaseModel):
    """Single frame detection result."""
    frame_index: int
    timestamp: float
    detections: List[BoundingBox]
    processing_time: float = Field(..., description="Frame processing time in ms")


class ErrorResponse(BaseModel):
    """Error response schema."""
    error: str
    detail: str
    timestamp: datetime = Field(default_factory=datetime.now)
    job_id: Optional[str] = None