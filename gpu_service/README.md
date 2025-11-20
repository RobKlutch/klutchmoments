# GPU Video Processing Microservice

A high-performance microservice for sports video processing using YOLOv8 object detection, ByteTrack multi-object tracking, and OpenCV spotlight effects.

## Features

- **YOLOv8 Detection**: Advanced object detection optimized for sports players
- **ByteTrack Tracking**: Robust multi-object tracking with stable player IDs
- **Spotlight Effects**: Real-time OpenCV overlay rendering (circle, beam, gradient)
- **GPU Acceleration**: CUDA support for optimal performance
- **FFmpeg Encoding**: Professional video output (1080p30/60fps)
- **RESTful API**: FastAPI with async processing
- **Docker Support**: GPU-enabled containerization

## Quick Start

### Prerequisites

- NVIDIA GPU with CUDA 11.8+
- Docker with NVIDIA Container Runtime
- Or: Python 3.10+ with CUDA toolkit

### Docker Deployment (Recommended)

```bash
# Build the container
docker build -t gpu-video-processor .

# Run with GPU support
docker run --gpus all -p 8000:8000 \
  -v $(pwd)/output:/app/output \
  -v $(pwd)/videos:/app/videos \
  gpu-video-processor
```

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env

# Start the service
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000
```

## API Endpoints

### Health Check
```http
GET /health
```

Response:
```json
{
  "status": "ready",
  "gpu_available": true,
  "model_loaded": true,
  "version": "1.0.0",
  "uptime": 123.45
}
```

### Process Video
```http
POST /process
```

Request:
```json
{
  "video_path": "/path/to/video.mp4",
  "start_time": 0.0,
  "end_time": 10.0,
  "player_selection": {
    "auto_select": true,
    "player_id": null,
    "selection_box": null
  },
  "effect_config": {
    "type": "circle",
    "radius": 150,
    "feather": 50,
    "intensity": 0.7,
    "color": "#FFFFFF"
  },
  "output_filename": "highlight.mp4"
}
```

Response:
```json
{
  "job_id": "uuid-string",
  "output_path": "/app/output/highlight.mp4",
  "processing_time": 12.34,
  "tracking_metadata": {
    "total_frames": 300,
    "fps": 30.0,
    "duration": 10.0,
    "tracks": [...],
    "player_count": 5
  },
  "effect_applied": {...},
  "performance_metrics": {
    "processing_time_seconds": 12.34,
    "frames_per_second": 24.3,
    "realtime_factor": 0.81
  }
}
```

### Job Status
```http
GET /status/{job_id}
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVICE` | `cuda` | Processing device (cuda/cpu/mps) |
| `YOLO_MODEL` | `yolov8n.pt` | YOLOv8 model size |
| `CONFIDENCE_THRESHOLD` | `0.5` | Detection confidence threshold |
| `TRACK_THRESH` | `0.6` | Tracking confidence threshold |
| `MAX_CONCURRENT_JOBS` | `2` | Maximum parallel jobs |
| `OUTPUT_RESOLUTION` | `1920x1080` | Video output resolution |

## Performance

- **Target**: ≤ 2x realtime processing for 1080p video
- **Throughput**: ~15-30 FPS on RTX 3080
- **Memory**: ~4-6GB VRAM for YOLOv8n
- **Latency**: Model warmup < 5 seconds

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   FastAPI App   │    │  Video Processor │    │  YOLOv8 Detector│
│                 │────│                  │────│                 │
│  - Health       │    │  - Frame Extract │    │  - GPU Inference│
│  - Process      │    │  - Pipeline Mgmt │    │  - Person Class │
│  - Status       │    │  - FFmpeg Encode │    │  - Confidence   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                    ┌──────────────────┐    ┌─────────────────┐
                    │   ByteTracker    │    │Spotlight Renderer│
                    │                  │────│                 │
                    │  - Kalman Filter │    │  - Circle Effect│
                    │  - ID Management │    │  - Beam Effect  │
                    │  - IoU Matching  │    │  - Gradient     │
                    └──────────────────┘    └─────────────────┘
```

## Development

### Project Structure
```
gpu_service/
├── src/
│   ├── main.py                 # FastAPI application
│   ├── config/
│   │   └── settings.py         # Configuration
│   ├── models/
│   │   ├── detector.py         # YOLOv8 detection
│   │   └── schemas.py          # Pydantic models
│   ├── tracking/
│   │   └── bytetrack.py        # Multi-object tracking
│   ├── effects/
│   │   └── spotlight_renderer.py # OpenCV effects
│   └── video_processing/
│       └── pipeline.py         # Main processing pipeline
├── requirements.txt
├── Dockerfile
└── README.md
```

### Testing
```bash
# Install test dependencies
pip install pytest pytest-asyncio

# Run tests
pytest tests/

# Load testing
python tests/load_test.py
```

### Model Caching

YOLOv8 models are automatically downloaded and cached:
- `yolov8n.pt`: ~6MB, fastest inference
- `yolov8s.pt`: ~22MB, better accuracy
- `yolov8m.pt`: ~50MB, high accuracy

## Troubleshooting

### GPU Issues
```bash
# Check CUDA availability
python -c "import torch; print(torch.cuda.is_available())"

# Check GPU memory
nvidia-smi
```

### Performance Tuning
- Use `yolov8n.pt` for speed, `yolov8s.pt` for accuracy
- Adjust `CONFIDENCE_THRESHOLD` based on video quality
- Lower `INPUT_SIZE` for faster processing
- Increase `MAX_CONCURRENT_JOBS` for multi-GPU setups

### Memory Management
- Monitor VRAM usage with `nvidia-smi`
- Reduce batch size if running out of memory
- Use CPU fallback with `DEVICE=cpu`

## License

MIT License - see LICENSE file for details.