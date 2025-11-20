#!/usr/bin/env python3
"""
Simple YOLOv8 Detection Service
Provides mock YOLOv8 detection responses for Klutch Moments
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import base64
from io import BytesIO
import random

class YOLOv8Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "healthy", "service": "YOLOv8-Mock"}')
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        if self.path == '/detect':
            # Read request
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data)
                
                # Mock YOLOv8 detection response
                detections = [
                    {
                        "id": f"player_{i+1}",
                        "x": random.uniform(0.1, 0.8),
                        "y": random.uniform(0.2, 0.7), 
                        "width": random.uniform(0.05, 0.15),
                        "height": random.uniform(0.1, 0.25),
                        "confidence": random.uniform(0.7, 0.95),
                        "centerX": random.uniform(0.15, 0.85),
                        "centerY": random.uniform(0.3, 0.8)
                    } for i in range(random.randint(1, 4))
                ]
                
                response = {
                    "success": True,
                    "detections": detections,
                    "processing_time": random.uniform(0.05, 0.15),
                    "model": "YOLOv8-Mock"
                }
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                error_response = {"error": str(e), "success": False}
                self.wfile.write(json.dumps(error_response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    server = HTTPServer(('localhost', 8000), YOLOv8Handler)
    print("🚀 YOLOv8 Mock Service starting on http://localhost:8000")
    print("✅ Health check: http://localhost:8000/health")
    print("🎯 Detection endpoint: http://localhost:8000/detect")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Service stopped")
        server.shutdown()