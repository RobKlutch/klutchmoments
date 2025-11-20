"""
Configuration settings for the GPU microservice.
"""

import os
from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings with environment variable support."""
    
    # Server Configuration
    host: str = Field(default="0.0.0.0", env="HOST")
    port: int = Field(default=8000, env="PORT")
    debug: bool = Field(default=False, env="DEBUG")
    cors_origins: List[str] = Field(default=["*"], env="CORS_ORIGINS")
    
    # GPU/Device Configuration
    device: str = Field(default="cuda", env="DEVICE")  # cuda, cpu, mps
    
    # YOLOv8 Configuration
    yolo_model: str = Field(default="yolov8n.pt", env="YOLO_MODEL")  # yolov8n.pt, yolov8s.pt
    input_size: int = Field(default=640, env="INPUT_SIZE")
    confidence_threshold: float = Field(default=0.5, env="CONFIDENCE_THRESHOLD")
    nms_threshold: float = Field(default=0.5, env="NMS_THRESHOLD")
    
    # ByteTrack Configuration
    track_thresh: float = Field(default=0.6, env="TRACK_THRESH")
    track_buffer: int = Field(default=30, env="TRACK_BUFFER")
    match_thresh: float = Field(default=0.8, env="MATCH_THRESH")
    
    # Video Processing Configuration
    default_fps: int = Field(default=30, env="DEFAULT_FPS")
    max_video_duration: int = Field(default=300, env="MAX_VIDEO_DURATION")  # seconds
    
    # Output Configuration
    output_dir: str = Field(default="./output", env="OUTPUT_DIR")
    temp_dir: str = Field(default="./temp", env="TEMP_DIR")
    
    # FFmpeg Configuration
    ffmpeg_preset: str = Field(default="fast", env="FFMPEG_PRESET")
    ffmpeg_crf: int = Field(default=23, env="FFMPEG_CRF")
    output_resolution: str = Field(default="1920x1080", env="OUTPUT_RESOLUTION")
    
    # Performance Configuration
    max_concurrent_jobs: int = Field(default=2, env="MAX_CONCURRENT_JOBS")
    processing_timeout: int = Field(default=3600, env="PROCESSING_TIMEOUT")  # seconds
    
    # Effect Configuration
    spotlight_radius: int = Field(default=150, env="SPOTLIGHT_RADIUS")
    spotlight_feather: int = Field(default=50, env="SPOTLIGHT_FEATHER")
    spotlight_intensity: float = Field(default=0.7, env="SPOTLIGHT_INTENSITY")
    
    # Security Configuration - Allowed video directories
    allowed_video_dirs: List[str] = Field(default=["/app/videos", "/app/uploads", "/tmp"], env="ALLOWED_VIDEO_DIRS")
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        
        # Create output directories
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(self.temp_dir, exist_ok=True)
    
    class Config:
        env_file = ".env"
        case_sensitive = False