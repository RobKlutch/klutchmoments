#!/bin/bash
# GPU-Optimized startup script

echo "🚀 Starting Klutch GPU-Optimized API..."

# Check GPU availability
echo "🔍 Checking GPU status..."
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
    export CUDA_VISIBLE_DEVICES=0
    export NVIDIA_VISIBLE_DEVICES=0
else
    echo "⚠️ No GPU detected, falling back to CPU"
fi

# Check YOLO model availability
if [ -f "yolo11n.onnx" ]; then
    echo "✅ YOLO11n ONNX model found"
    export YOLO_MODEL_PATH="./yolo11n.onnx"
else
    echo "⚠️ YOLO11n model not found, using fallback"
fi

# Set optimal environment variables for GPU inference
export OMP_NUM_THREADS=4
export CUDA_LAUNCH_BLOCKING=0
export TORCH_CUDA_ARCH_LIST="6.0;6.1;7.0;7.5;8.0;8.6"

# Performance monitoring
echo "📊 System Resources:"
echo "CPU Cores: $(nproc)"
echo "Memory: $(free -h | grep Mem | awk '{print $2}')"
echo "Disk: $(df -h / | tail -1 | awk '{print $4}')"

# Start the optimized API server
echo "🎯 Starting GPU API server..."
exec node server/api-optimized.js