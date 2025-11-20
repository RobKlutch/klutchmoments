"""
Test suite for the GPU video processing microservice.
"""

import pytest
import asyncio
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch
import tempfile
import os

from src.main import app


@pytest.fixture
def client():
    """Test client fixture."""
    return TestClient(app)


@pytest.fixture
def sample_video_path():
    """Create a temporary video file for testing."""
    # Create a temporary file that simulates a video
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as f:
        f.write(b'fake video content')
        temp_path = f.name
    
    yield temp_path
    
    # Cleanup
    try:
        os.unlink(temp_path)
    except FileNotFoundError:
        pass


class TestHealthEndpoint:
    """Test health check endpoint."""
    
    def test_health_check_service_starting(self, client):
        """Test health check when service is starting."""
        with patch('src.main.detector', None):
            response = client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] in ["ready", "initializing"]
    
    def test_health_check_service_ready(self, client):
        """Test health check when service is ready."""
        # Mock all components as ready
        mock_detector = Mock()
        mock_detector.is_ready.return_value = True
        mock_detector.is_gpu_available.return_value = True
        
        with patch('src.main.detector', mock_detector), \
             patch('src.main.tracker', Mock()), \
             patch('src.main.video_processor', Mock()):
            response = client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ready"
            assert data["gpu_available"] is True
            assert data["model_loaded"] is True
            assert "version" in data
            assert "uptime" in data


class TestProcessEndpoint:
    """Test video processing endpoint."""
    
    def test_process_video_missing_file(self, client):
        """Test processing with non-existent video file."""
        request_data = {
            "video_path": "/non/existent/video.mp4",
            "start_time": 0.0,
            "end_time": 10.0,
            "player_selection": {"auto_select": True},
            "effect_config": {"type": "circle"}
        }
        
        response = client.post("/process", json=request_data)
        assert response.status_code == 400
        assert "not found" in response.json()["detail"].lower()
    
    def test_process_video_service_not_ready(self, client):
        """Test processing when service is not ready."""
        with patch('src.main.video_processor', None):
            request_data = {
                "video_path": "/fake/video.mp4",
                "start_time": 0.0,
                "end_time": 10.0,
                "player_selection": {"auto_select": True},
                "effect_config": {"type": "circle"}
            }
            
            response = client.post("/process", json=request_data)
            assert response.status_code == 503
            assert "not initialized" in response.json()["detail"].lower()
    
    @patch('src.main.video_processor')
    async def test_process_video_success(self, mock_processor, client, sample_video_path):
        """Test successful video processing."""
        # Mock successful processing
        mock_result = {
            "job_id": "test-job-123",
            "output_path": "/app/output/test.mp4",
            "processing_time": 12.34,
            "tracking_metadata": {
                "total_frames": 300,
                "fps": 30.0,
                "duration": 10.0,
                "tracks": [],
                "player_count": 2
            },
            "effect_applied": {"type": "circle"},
            "performance_metrics": {"realtime_factor": 1.2}
        }
        
        mock_processor.process_video.return_value = mock_result
        
        request_data = {
            "video_path": sample_video_path,
            "start_time": 0.0,
            "end_time": 10.0,
            "player_selection": {"auto_select": True},
            "effect_config": {"type": "circle"}
        }
        
        response = client.post("/process", json=request_data)
        assert response.status_code == 200
        data = response.json()
        assert data["job_id"] == "test-job-123"
        assert data["output_path"] == "/app/output/test.mp4"
        assert "tracking_metadata" in data
    
    def test_process_video_invalid_request(self, client):
        """Test processing with invalid request data."""
        request_data = {
            "video_path": "",  # Empty path
            "start_time": -1.0,  # Negative time
            "effect_config": {"type": "invalid_effect"}  # Invalid effect
        }
        
        response = client.post("/process", json=request_data)
        assert response.status_code == 422  # Validation error


class TestStatusEndpoint:
    """Test job status endpoint."""
    
    @patch('src.main.video_processor')
    def test_get_status_existing_job(self, mock_processor, client):
        """Test getting status for existing job."""
        mock_status = {
            "job_id": "test-job-123",
            "stage": "completed",
            "progress": 1.0,
            "message": "Processing completed",
            "started_at": "2023-01-01T00:00:00Z"
        }
        
        mock_processor.get_job_status.return_value = mock_status
        
        response = client.get("/status/test-job-123")
        assert response.status_code == 200
        data = response.json()
        assert data["job_id"] == "test-job-123"
        assert data["stage"] == "completed"
    
    @patch('src.main.video_processor')
    def test_get_status_nonexistent_job(self, mock_processor, client):
        """Test getting status for non-existent job."""
        mock_processor.get_job_status.return_value = None
        
        response = client.get("/status/nonexistent-job")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    
    def test_get_status_service_not_ready(self, client):
        """Test getting status when service is not ready."""
        with patch('src.main.video_processor', None):
            response = client.get("/status/test-job")
            assert response.status_code == 503


@pytest.mark.asyncio
class TestIntegration:
    """Integration tests for the full pipeline."""
    
    async def test_pipeline_components_initialization(self):
        """Test that all pipeline components can be initialized."""
        from src.models.detector import YOLOv8Detector
        from src.tracking.bytetrack import ByteTracker
        from src.effects.spotlight_renderer import SpotlightRenderer
        from src.video_processing.pipeline import VideoProcessor
        from src.config.settings import Settings
        
        # Test component initialization
        settings = Settings()
        
        # Mock detector (don't actually load model in tests)
        detector = Mock(spec=YOLOv8Detector)
        detector.is_ready.return_value = True
        detector.is_gpu_available.return_value = False  # Use CPU for tests
        
        tracker = ByteTracker()
        
        # Test spotlight renderer
        renderer = SpotlightRenderer(1920, 1080)
        assert renderer.frame_width == 1920
        assert renderer.frame_height == 1080
        
        # Test video processor
        processor = VideoProcessor(detector, tracker, settings)
        assert processor.detector == detector
        assert processor.tracker == tracker
    
    async def test_schemas_validation(self):
        """Test that all schemas validate correctly."""
        from src.models.schemas import (
            ProcessingRequest,
            EffectConfig,
            PlayerSelection,
            BoundingBox
        )
        
        # Test valid request
        valid_request = {
            "video_path": "/path/to/video.mp4",
            "start_time": 0.0,
            "end_time": 10.0,
            "player_selection": {
                "auto_select": True,
                "player_id": None,
                "selection_box": None
            },
            "effect_config": {
                "type": "circle",
                "radius": 150,
                "feather": 50,
                "intensity": 0.7,
                "color": "#FFFFFF"
            }
        }
        
        request = ProcessingRequest(**valid_request)
        assert request.video_path == "/path/to/video.mp4"
        assert request.start_time == 0.0
        assert request.effect_config.type == "circle"
        
        # Test bounding box validation
        bbox = BoundingBox(x=0.5, y=0.5, width=0.2, height=0.3, confidence=0.8)
        assert 0.0 <= bbox.x <= 1.0
        assert 0.0 <= bbox.confidence <= 1.0


if __name__ == "__main__":
    pytest.main([__file__])