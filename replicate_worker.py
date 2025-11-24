#!/usr/bin/env python3
import sys
import json
import numpy as np
import cv2
import base64
import time
import os
from typing import List, Dict, Any
import traceback

# Import Replicate SDK
try:
    from replicate import Client
    HAS_REPLICATE = True
    print("✅ Replicate SDK available", file=sys.stderr)
except ImportError:
    HAS_REPLICATE = False
    print("❌ Replicate SDK not available", file=sys.stderr)
    sys.exit(1)

class ReplicateYOLOWorker:
    def __init__(self):
        self.api_token = os.environ.get('REPLICATE_API_TOKEN')
        if not self.api_token:
            print("❌ REPLICATE_API_TOKEN not set", file=sys.stderr)
            sys.exit(1)
        
        self.client = Client(api_token=self.api_token)
        # Use warm deployment endpoint (eliminates cold starts)
        # Updated to klutch-trackingpredictions-rohan deployment (YOLOv11 + ByteTrack)
        self.deployment_name = "robklutch/klutch-trackingpredictions-rohan"
        print(f"✅ Replicate client initialized with warm deployment: {self.deployment_name}", file=sys.stderr)
    
    def decode_image(self, image_data_url: str):
        """Decode base64 image data."""
        try:
            base64_data = image_data_url.split(',')[1] if ',' in image_data_url else image_data_url
            image_bytes = base64.b64decode(base64_data)
            nparr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError("Failed to decode image")
            return frame, base64_data
        except Exception as e:
            raise ValueError(f"Image decode error: {e}")
    
    def detect_players(self, image_data_url: str, timestamp_ms: int) -> Dict[str, Any]:
        """Main detection method using Replicate API."""
        start_time = time.time()
        
        try:
            # Decode image to get dimensions
            frame, base64_data = self.decode_image(image_data_url)
            img_height, img_width = frame.shape[:2]
            
            print(f"🎯 Running Replicate Ultralytics YOLOv11 GPU inference on {img_width}x{img_height} image...", file=sys.stderr)
            
            # Prepare data URI for Replicate
            data_uri = f"data:image/jpeg;base64,{base64_data}"
            
            # Track Replicate API timing
            api_start = time.time()
            print(f"⏱️ Calling Replicate DEPLOYMENT (warm, no cold start) with imgsz=640...", file=sys.stderr)
            
            # Run via warm deployment endpoint (eliminates cold starts!)
            prediction = self.client.deployments.predictions.create(
                self.deployment_name,
                input={
                    "image": data_uri,
                    "conf": 0.3,           # Confidence threshold
                    "iou": 0.45,           # IoU threshold for NMS
                    "imgsz": 640,          # Image size (restored for accuracy)
                    "return_json": True,   # Return JSON with bounding boxes!
                }
            )
            
            # Wait for prediction to complete
            prediction.wait()
            output = prediction.output
            
            api_time = (time.time() - api_start) * 1000
            print(f"⏱️ Replicate API returned in {api_time:.1f}ms", file=sys.stderr)
            
            # Parse Replicate YOLOv11 output
            # Log what we get from Replicate for debugging
            print(f"🔍 Replicate output type: {type(output)}", file=sys.stderr)
            
            # Parse actual detections from Replicate YOLOv11 response
            detections = []
            
            # YOLOv11 returns dict with 'json_str' containing JSON string
            if isinstance(output, dict) and 'json_str' in output:
                import json as json_lib
                detection_data = json_lib.loads(output['json_str'])
                print(f"✅ Parsed {len(detection_data)} detections from YOLOv11 JSON", file=sys.stderr)
                
                # **FIX**: Ultralytics letterboxes to 640×640 - we need to unpad before normalizing
                # Calculate letterbox parameters (assuming imgsz=640)
                model_size = 640
                img_aspect = img_width / img_height
                
                if img_aspect > 1:
                    # Wide image - padding on top/bottom
                    scale = model_size / img_width
                    pad_y = (model_size - img_height * scale) / 2
                    pad_x = 0
                else:
                    # Tall image - padding on left/right
                    scale = model_size / img_height
                    pad_x = (model_size - img_width * scale) / 2
                    pad_y = 0
                
                # Calculate effective dimensions after letterboxing (the actual content area)
                effective_width = model_size - 2 * pad_x
                effective_height = model_size - 2 * pad_y
                
                print(f"📐 Letterbox: img={img_width}x{img_height}, scale={scale:.4f}, pad=({pad_x:.1f},{pad_y:.1f}), effective={effective_width:.0f}x{effective_height:.0f}", file=sys.stderr)
                
                # Filter for "person" class only (class 0 in COCO)
                for i, det in enumerate(detection_data):
                    if det.get('class') == 0 or det.get('name') == 'person':
                        box = det['box']
                        print(f"🔍 RAW BOX {i+1}: x1={box['x1']:.1f}, y1={box['y1']:.1f}, x2={box['x2']:.1f}, y2={box['y2']:.1f} (in 640x640 letterboxed)", file=sys.stderr)
                        
                        # Remove padding to get coordinates in effective (scaled content) space
                        x1_scaled = box['x1'] - pad_x
                        y1_scaled = box['y1'] - pad_y
                        x2_scaled = box['x2'] - pad_x
                        y2_scaled = box['y2'] - pad_y
                        
                        print(f"📐 UNPADDED {i+1}: x1={x1_scaled:.1f}, y1={y1_scaled:.1f}, x2={x2_scaled:.1f}, y2={y2_scaled:.1f} (in {effective_width:.0f}x{effective_height:.0f})", file=sys.stderr)
                        
                        # Scale back to ORIGINAL image pixel coordinates
                        x1_original = x1_scaled / scale
                        y1_original = y1_scaled / scale
                        x2_original = x2_scaled / scale
                        y2_original = y2_scaled / scale
                        
                        print(f"🔙 ORIGINAL PIXELS {i+1}: x1={x1_original:.1f}, y1={y1_original:.1f}, x2={x2_original:.1f}, y2={y2_original:.1f} (in {img_width}x{img_height})", file=sys.stderr)
                        
                        # NOW normalize to [0, 1] based on ORIGINAL image dimensions
                        x1_norm = max(0, min(1, x1_original / img_width))
                        y1_norm = max(0, min(1, y1_original / img_height))
                        x2_norm = max(0, min(1, x2_original / img_width))
                        y2_norm = max(0, min(1, y2_original / img_height))
                        
                        print(f"✅ NORMALIZED {i+1}: ({x1_norm:.4f}, {y1_norm:.4f}) to ({x2_norm:.4f}, {y2_norm:.4f})", file=sys.stderr)
                        
                        # Calculate center and dimensions in normalized space
                        center_x = (x1_norm + x2_norm) / 2
                        center_y = (y1_norm + y2_norm) / 2
                        width = x2_norm - x1_norm
                        height = y2_norm - y1_norm
                        
                        print(f"🎯 FINAL {i+1}: center=({center_x:.4f}, {center_y:.4f}), size=({width:.4f}x{height:.4f})", file=sys.stderr)
                        
                        detections.append({
                            "x": center_x,
                            "y": center_y,
                            "width": width,
                            "height": height,
                            "confidence": det['confidence']
                        })
            else:
                print(f"⚠️ Unexpected YOLOv11 output format: {output}", file=sys.stderr)
                # Empty detections array - real GPU inference returned no players
                detections = []
            
            processing_time = (time.time() - start_time) * 1000
            
            # Format response
            players = []
            for i, detection in enumerate(detections):
                players.append({
                    "id": f"player_{i + 1}",
                    "x": detection["x"],
                    "y": detection["y"],
                    "width": detection["width"],
                    "height": detection["height"],
                    "confidence": detection["confidence"],
                    "description": f"Player {i + 1}",
                    "centerX": detection["x"],
                    "centerY": detection["y"],
                    "topLeftX": detection["x"] - detection["width"] / 2,
                    "topLeftY": detection["y"] - detection["height"] / 2
                })
            
            response = {
                "success": True,
                "timestamp": timestamp_ms / 1000,
                "frameAnalysis": {
                    "totalPlayers": len(players),
                    "imageSize": f"{img_width}x{img_height}",
                    "method": "replicate_ultralytics_yolo11_gpu"
                },
                "players": players,
                "processingTime": processing_time,
                "modelType": "Replicate-Ultralytics-YOLOv11-GPU"
            }
            
            print(f"✅ Replicate detection complete: {len(players)} players in {processing_time:.1f}ms", file=sys.stderr)
            return response
            
        except Exception as e:
            print(f"❌ Replicate detection error: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            
            # Return error response
            return {
                "success": False,
                "error": str(e),
                "timestamp": timestamp_ms / 1000,
                "frameAnalysis": {"totalPlayers": 0},
                "players": [],
                "processingTime": (time.time() - start_time) * 1000
            }
    
    def mock_detections_from_replicate(self, img_width: int, img_height: int) -> List[Dict]:
        """Mock detection parser - replace with actual Replicate output parser."""
        # This is a placeholder - actual implementation will parse Replicate's JSON/image output
        return [
            {"x": 0.3, "y": 0.4, "width": 0.08, "height": 0.15, "confidence": 0.92},
            {"x": 0.7, "y": 0.5, "width": 0.09, "height": 0.16, "confidence": 0.89},
            {"x": 0.5, "y": 0.3, "width": 0.07, "height": 0.14, "confidence": 0.85}
        ]

# Main worker loop
def main():
    worker = ReplicateYOLOWorker()
    
    print("🔥 Replicate YOLOv11 Worker ready for requests", file=sys.stderr)
    
    # Process requests from stdin
    for line in sys.stdin:
        try:
            request = json.loads(line.strip())
            if request.get('command') == 'detect':
                result = worker.detect_players(request['imageDataUrl'], request['timestampMs'])
                # Include requestId for response matching
                result['requestId'] = request.get('requestId')
                print(json.dumps(result))
                sys.stdout.flush()
            elif request.get('command') == 'shutdown':
                break
        except Exception as e:
            error_response = {
                "success": False,
                "error": f"Worker error: {e}",
                "players": [],
                "timestamp": 0,
                "requestId": request.get('requestId') if 'request' in locals() else None
            }
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
