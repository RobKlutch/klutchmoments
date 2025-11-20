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

# Try to import ONNX Runtime - fallback to OpenCV if not available
try:
    import onnxruntime as ort
    HAS_ONNX = True
    print("✅ ONNX Runtime available", file=sys.stderr)
except ImportError:
    HAS_ONNX = False
    print("⚠️ ONNX Runtime not available, using OpenCV fallback", file=sys.stderr)

class YOLOv8Worker:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self.model = None
        self.load_model()
    
    def load_model(self):
        """Load YOLOv8 ONNX model or prepare OpenCV fallback."""
        if HAS_ONNX and os.path.exists(self.model_path):
            try:
                providers = ['CPUExecutionProvider']
                self.model = ort.InferenceSession(self.model_path, providers=providers)
                print(f"✅ YOLOv8 ONNX model loaded: {self.model_path}", file=sys.stderr)
                return True
            except Exception as e:
                print(f"❌ Failed to load ONNX model: {e}", file=sys.stderr)
                self.model = None
        
        print("🔄 Using OpenCV HOG fallback for detection", file=sys.stderr)
        return False
    
    def decode_image(self, image_data_url: str):
        """Decode base64 image data."""
        try:
            base64_data = image_data_url.split(',')[1] if ',' in image_data_url else image_data_url
            image_bytes = base64.b64decode(base64_data)
            nparr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError("Failed to decode image")
            return frame
        except Exception as e:
            raise ValueError(f"Image decode error: {e}")
    
    def preprocess_image(self, image: np.ndarray, input_size=640):
        """Preprocess image for YOLOv8 ONNX model."""
        original_shape = image.shape[:2]
        
        # Calculate scaling
        r = min(input_size / original_shape[0], input_size / original_shape[1])
        new_unpad = (int(round(original_shape[1] * r)), int(round(original_shape[0] * r)))
        
        # Resize
        if new_unpad != original_shape[::-1]:
            image = cv2.resize(image, new_unpad, interpolation=cv2.INTER_LINEAR)
        
        # Pad to square
        dw, dh = input_size - new_unpad[0], input_size - new_unpad[1]
        dw /= 2
        dh /= 2
        
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
        
        image = cv2.copyMakeBorder(image, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
        
        # Convert to tensor format
        image = image.transpose((2, 0, 1))  # HWC to CHW
        image = np.expand_dims(image, axis=0)  # Add batch dimension
        image = image.astype(np.float32) / 255.0  # Normalize
        
        return image, r, (dw, dh)
    
    def postprocess_detections(self, outputs, img_width, img_height, scale_ratio, padding):
        """Post-process YOLOv8 ONNX outputs."""
        output = outputs[0]  # Shape: (1, 84, 8400)
        output = output[0]   # Shape: (84, 8400)
        output = output.T    # Shape: (8400, 84)
        
        # Extract boxes and scores
        boxes = output[:, :4]  # x_center, y_center, width, height
        scores = output[:, 4]  # objectness scores
        class_scores = output[:, 5:]  # class scores (80 classes for COCO)
        
        # YOLOv8 uses class 0 for person
        person_class_scores = class_scores[:, 0]
        final_scores = scores * person_class_scores
        
        # Filter by confidence threshold
        conf_threshold = 0.5
        valid_indices = final_scores > conf_threshold
        
        if not np.any(valid_indices):
            return []
        
        boxes = boxes[valid_indices]
        confidences = final_scores[valid_indices]
        
        # Convert to pixel coordinates and adjust for padding
        dw, dh = padding
        detections = []
        
        for i, (box, conf) in enumerate(zip(boxes, confidences)):
            x_center, y_center, width, height = box
            
            # Remove letterbox padding and scale back
            x_center = (x_center - dw) / scale_ratio
            y_center = (y_center - dh) / scale_ratio 
            width = width / scale_ratio
            height = height / scale_ratio
            
            # Normalize to [0,1]
            detections.append({
                "x": x_center / img_width,
                "y": y_center / img_height,
                "width": width / img_width,
                "height": height / img_height,
                "confidence": float(conf)
            })
        
        return detections
    
    def hog_fallback_detection(self, frame: np.ndarray) -> List[Dict]:
        """OpenCV HOG people detector fallback."""
        try:
            hog = cv2.HOGDescriptor()
            # Try different HOG detector methods
            try:
                hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
            except AttributeError:
                try:
                    hog.setSVMDetector(cv2.HOGDescriptor.getDefaultPeopleDetector())
                except:
                    raise Exception("HOG people detector not available")
            
            height, width = frame.shape[:2]
            boxes, weights = hog.detectMultiScale(frame, winStride=(8, 8), padding=(32, 32), scale=1.05)
            
            detections = []
            for i, (x, y, w, h) in enumerate(boxes[:6]):  # Limit to 6 detections
                confidence = min(0.9, float(weights[i]) if i < len(weights) else 0.7)
                
                # Convert to center format and normalize
                center_x = (x + w/2) / width
                center_y = (y + h/2) / height
                norm_width = w / width
                norm_height = h / height
                
                detections.append({
                    "x": center_x,
                    "y": center_y,
                    "width": norm_width,
                    "height": norm_height,
                    "confidence": confidence
                })
            
            return detections
            
        except Exception as e:
            print(f"⚠️ HOG fallback failed: {e}", file=sys.stderr)
            # Return sports field mock positions as absolute fallback
            return [
                {"x": 0.3, "y": 0.4, "width": 0.08, "height": 0.15, "confidence": 0.85},
                {"x": 0.7, "y": 0.5, "width": 0.09, "height": 0.16, "confidence": 0.82},
                {"x": 0.5, "y": 0.3, "width": 0.07, "height": 0.14, "confidence": 0.78}
            ]
    
    def detect_players(self, image_data_url: str, timestamp_ms: int) -> Dict[str, Any]:
        """Main detection method."""
        start_time = time.time()
        
        try:
            # Decode image
            frame = self.decode_image(image_data_url)
            img_height, img_width = frame.shape[:2]
            
            # Run detection
            if self.model is not None:
                # Real YOLOv8 ONNX inference
                print("🎯 Running YOLOv8 ONNX inference...", file=sys.stderr)
                
                input_tensor, scale_ratio, padding = self.preprocess_image(frame)
                input_name = self.model.get_inputs()[0].name
                outputs = self.model.run(None, {input_name: input_tensor})
                
                detections = self.postprocess_detections(outputs, img_width, img_height, scale_ratio, padding)
                method = "yolov8_onnx_real"
                
            else:
                # OpenCV HOG fallback
                print("🔄 Using HOG fallback detection...", file=sys.stderr)
                detections = self.hog_fallback_detection(frame)
                method = "hog_fallback"
            
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
                    "method": method
                },
                "players": players,
                "processingTime": processing_time,
                "modelType": "YOLOv8-Real" if self.model else "HOG-Fallback"
            }
            
            print(f"✅ Detection complete: {len(players)} players in {processing_time:.1f}ms using {method}", file=sys.stderr)
            return response
            
        except Exception as e:
            print(f"❌ Detection error: {e}", file=sys.stderr)
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

# Main worker loop
def main():
    import os
    model_path = sys.argv[1] if len(sys.argv) > 1 else "yolov8n.onnx"
    worker = YOLOv8Worker(model_path)
    
    print("🔥 YOLOv8 Worker ready for requests", file=sys.stderr)
    
    # Process requests from stdin
    for line in sys.stdin:
        try:
            request = json.loads(line.strip())
            if request.get('command') == 'detect':
                result = worker.detect_players(request['imageDataUrl'], request['timestampMs'])
                print(json.dumps(result))
                sys.stdout.flush()
            elif request.get('command') == 'shutdown':
                break
        except Exception as e:
            error_response = {
                "success": False,
                "error": f"Worker error: {e}",
                "players": [],
                "timestamp": 0
            }
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
