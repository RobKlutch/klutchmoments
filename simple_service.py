#!/usr/bin/env python3
"""
Minimal YOLOv8 service for debugging
"""
from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok", "service": "yolo"}

@app.post("/detect")  
def detect(data: dict):
    return {
        "success": True,
        "players": [
            {"id": "player_1", "x": 0.15, "y": 0.55, "width": 0.08, "height": 0.15, "confidence": 0.92}
        ]
    }

if __name__ == "__main__":
    print("Starting service on 0.0.0.0:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)