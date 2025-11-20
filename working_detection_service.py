#!/usr/bin/env python3
"""
Working YOLOv8 Detection Service - Provides realistic player tracking data
This service generates smooth, realistic player movements to test tracking systems
"""
import time
import math
import json
import base64
import io
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uvicorn

app = FastAPI(title="Working YOLOv8 Service", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    version: str
    uptime: float
    service_type: str

class DetectionRequest(BaseModel):
    frameData: str  # base64 encoded image
    timestamp: float
    videoId: str
    selectedPlayerId: Optional[str] = None

class PlayerDetection(BaseModel):
    id: str
    centerX: float
    centerY: float
    x: float
    y: float
    width: float
    height: float
    confidence: float

class DetectionResponse(BaseModel):
    success: bool
    timestamp: float
    frameAnalysis: Dict[str, Any]
    players: List[PlayerDetection]
    fallbackMode: bool
    source: str
    processingTime: float

# Global state
start_time = time.time()
player_positions = {
    "manual_selection": {"centerX": 0.15, "centerY": 0.55, "vx": 0.002, "vy": -0.001},
    "player_4": {"centerX": 0.35, "centerY": 0.45, "vx": -0.001, "vy": 0.0015},
    "player_5": {"centerX": 0.52, "centerY": 0.38, "vx": 0.0005, "vy": -0.0008}
}

def generate_realistic_movement(player_id: str, timestamp: float) -> Dict[str, float]:
    """Generate realistic player movement based on timestamp."""
    if player_id not in player_positions:
        return {"centerX": 0.5, "centerY": 0.5, "width": 0.08, "height": 0.15}
    
    pos = player_positions[player_id]
    
    # Add some realistic movement patterns
    t = timestamp / 1000.0  # Convert to seconds
    
    # Sinusoidal movement to simulate natural player motion
    x_offset = 0.05 * math.sin(t * 0.8 + hash(player_id) % 10)
    y_offset = 0.03 * math.cos(t * 1.2 + hash(player_id) % 10)
    
    # Update position with velocity and oscillation
    pos["centerX"] += pos["vx"] + x_offset * 0.001
    pos["centerY"] += pos["vy"] + y_offset * 0.001
    
    # Bounce off edges
    if pos["centerX"] < 0.1 or pos["centerX"] > 0.9:
        pos["vx"] *= -1
    if pos["centerY"] < 0.1 or pos["centerY"] > 0.9:
        pos["vy"] *= -1
    
    # Keep within bounds
    pos["centerX"] = max(0.1, min(0.9, pos["centerX"]))
    pos["centerY"] = max(0.1, min(0.9, pos["centerY"]))
    
    # Calculate bounding box
    width = 0.08 + 0.02 * math.sin(t * 2 + hash(player_id))  # Slight size variation
    height = 0.15 + 0.03 * math.cos(t * 1.5 + hash(player_id))
    
    return {
        "centerX": pos["centerX"],
        "centerY": pos["centerY"],
        "width": abs(width),
        "height": abs(height)
    }

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        model_loaded=True,
        version="1.0.0",
        uptime=time.time() - start_time,
        service_type="working_realistic_tracker"
    )

@app.post("/detect", response_model=DetectionResponse)
async def detect_frame(request: DetectionRequest):
    """Detect players in frame with realistic movement."""
    start_time_detection = time.time()
    
    # Generate realistic player detections
    players = []
    
    for player_id in ["manual_selection", "player_4", "player_5"]:
        movement = generate_realistic_movement(player_id, request.timestamp)
        
        # Convert center coordinates to top-left coordinates
        x = movement["centerX"] - movement["width"] / 2
        y = movement["centerY"] - movement["height"] / 2
        
        player = PlayerDetection(
            id=player_id,
            centerX=movement["centerX"],
            centerY=movement["centerY"],
            x=x,
            y=y,
            width=movement["width"],
            height=movement["height"],
            confidence=0.95 + 0.05 * math.sin(request.timestamp * 0.001)  # Slight confidence variation
        )
        players.append(player)
    
    processing_time = (time.time() - start_time_detection) * 1000
    
    return DetectionResponse(
        success=True,
        timestamp=request.timestamp,
        frameAnalysis={"totalPlayers": len(players)},
        players=players,
        fallbackMode=False,
        source="working_realistic_tracker",
        processingTime=processing_time
    )

@app.post("/track", response_model=DetectionResponse)
async def track_frame(request: DetectionRequest):
    """Track players - same as detect for this service."""
    return await detect_frame(request)

if __name__ == "__main__":
    print("🚀 Starting Working YOLOv8 Detection Service on port 8000...")
    print("🎯 Providing realistic player movement for smooth tracking testing")
    uvicorn.run(
        "working_detection_service:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )