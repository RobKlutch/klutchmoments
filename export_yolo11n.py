# Export YOLO11n model to ONNX format
# Make sure ultralytics, onnx, and onnxsim are installed first:
# pip install ultralytics onnx onnxruntime onnxsim

from ultralytics import YOLO

# Load the pretrained YOLO11n model (will auto-download if not cached)
model = YOLO("yolo11n.pt")

# Export to ONNX format
export_path = model.export(
    format="onnx",     # ONNX export
    dynamic=True,      # allow dynamic input sizes
    simplify=True,     # run onnxsim simplifier
    opset=17,          # safe opset for modern runtimes
    imgsz=640          # inference size
)

print(f"ONNX model saved at: {export_path}")