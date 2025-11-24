import Replicate from "replicate";
import sharp from "sharp";

// ZERO-LAG OPTIMIZATION: Direct Node.js wrapper for Replicate YOLOv11 GPU detection
// Eliminates Python worker IPC overhead (~250-300ms)

class ReplicateDirectDetection {
  private replicate: Replicate | null = null;
  // Updated to klutch-trackingpredictions-rohan deployment (YOLOv11 + ByteTrack)
  private deploymentName = "robklutch/klutch-trackingpredictions-rohan";
  
  async initialize(): Promise<boolean> {
    try {
      if (!process.env.REPLICATE_API_TOKEN) {
        console.log('⚠️ REPLICATE_API_TOKEN not set - Direct Replicate detection disabled');
        return false;
      }
      
      this.replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
      });
      
      console.log('✅ Direct Replicate YOLOv11 GPU detection initialized (no Python worker)');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Direct Replicate detection:', error);
      return false;
    }
  }
  
  async detectPlayers(imageBuffer: Buffer, timestampMs: number): Promise<any> {
    if (!this.replicate) {
      throw new Error('Replicate SDK not initialized');
    }
    
    const startTime = Date.now();
    
    try {
      // Get image dimensions using sharp
      const metadata = await sharp(imageBuffer).metadata();
      const imgWidth = metadata.width || 1920;
      const imgHeight = metadata.height || 1080;
      
      console.log(`🎯 Running Replicate Ultralytics YOLOv11 GPU inference on ${imgWidth}x${imgHeight} image...`);
      console.log(`⏱️ Calling Replicate DEPLOYMENT (warm, no cold start) with imgsz=640...`);
      
      // Convert buffer to base64 data URL for Replicate
      const base64Image = imageBuffer.toString('base64');
      const mimeType = metadata.format === 'png' ? 'image/png' : 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      
      // Call Replicate deployment directly (no Python worker)
      // Using klutch-trackingpredictions-rohan (YOLOv11 + ByteTrack)
      const prediction: any = await this.replicate.deployments.predictions.create(
        "robklutch",
        "klutch-trackingpredictions-rohan",
        {
          input: {
            image: dataUrl,
            conf: 0.3,
            iou: 0.45,
            imgsz: 640,
            return_json: true
          }
        }
      );
      
      // Wait for prediction to complete
      const output = await this.replicate.wait(prediction);
      const apiTime = Date.now() - startTime;
      
      console.log(`⏱️ Replicate API returned in ${apiTime}ms`);
      console.log(`🔍 Replicate output type: ${typeof output}`);
      console.log(`🔍 Replicate output keys:`, output ? Object.keys(output) : 'null');
      
      // Parse detections from JSON response
      let detections: any[] = [];
      
      // Replicate Prediction object has an 'output' field containing the actual result
      if (output && typeof output === 'object' && (output as any).output) {
        const actualOutput = (output as any).output;
        console.log(`🔍 Found output.output field, type: ${typeof actualOutput}`);
        console.log(`🔍 output.output sample:`, JSON.stringify(actualOutput).substring(0, 500));
        
        // Check if output.output is an object with a 'json' or 'predictions' field
        if (actualOutput && typeof actualOutput === 'object') {
          // Format 1: json_str (string that needs parsing)
          if (typeof actualOutput.json_str === 'string') {
            try {
              const parsed = JSON.parse(actualOutput.json_str);
              if (Array.isArray(parsed)) {
                detections = parsed.filter((det: any) => 
                  (det.class === 0 || det.name === 'person') && det.confidence > 0.3
                );
                console.log(`✅ Found ${detections.length} detections in output.output.json_str (parsed)`);
              }
            } catch (e) {
              console.error('Failed to parse json_str:', e);
            }
          }
          // Format 2: json (already parsed array)
          else if (Array.isArray(actualOutput.json)) {
            detections = actualOutput.json.filter((det: any) => 
              (det.class === 0 || det.name === 'person') && det.confidence > 0.3
            );
            console.log(`✅ Found ${detections.length} detections in output.output.json`);
          } 
          // Format 3: predictions array
          else if (Array.isArray(actualOutput.predictions)) {
            detections = actualOutput.predictions.filter((det: any) => 
              (det.class === 0 || det.name === 'person') && det.confidence > 0.3
            );
            console.log(`✅ Found ${detections.length} detections in output.output.predictions`);
          } 
          // Format 4: Direct array
          else if (Array.isArray(actualOutput)) {
            detections = actualOutput.filter((det: any) => 
              (det.class === 0 || det.name === 'person') && det.confidence > 0.3
            );
            console.log(`✅ Found ${detections.length} detections in output.output (array)`);
          } else {
            console.log(`⚠️ output.output is object with keys:`, Object.keys(actualOutput));
          }
        }
      }
      
      console.log(`✅ Parsed ${detections.length} detections from YOLOv11 JSON`);
      if (detections.length === 0) {
        console.error('⚠️ No detections found. Full output structure:', JSON.stringify(output, null, 2).substring(0, 2000));
      }
      
      // Transform detections to match expected format
      const players = detections.map((det: any, i: number) => {
        const box = det.box;
        
        // 🧪 DIAGNOSTIC: Log raw box coordinates to determine format
        console.log(`🧪 TEST: Raw box from new deployment - x1=${box.x1}, y1=${box.y1}, x2=${box.x2}, y2=${box.y2}`);
        console.log(`🧪 TEST: Image dimensions - width=${imgWidth}, height=${imgHeight}`);
        console.log(`🧪 TEST: If letterboxed: coordinates should be ~0-640. If original: coordinates should be ~0-${imgWidth}/~0-${imgHeight}`);
        
        // **ASSUMPTION**: New deployment returns boxes in ORIGINAL image coordinates (not letterboxed)
        // If this is wrong, coordinates will be severely distorted. Check logs above!
        const x1_norm = Math.max(0, Math.min(1, box.x1 / imgWidth));
        const y1_norm = Math.max(0, Math.min(1, box.y1 / imgHeight));
        const x2_norm = Math.max(0, Math.min(1, box.x2 / imgWidth));
        const y2_norm = Math.max(0, Math.min(1, box.y2 / imgHeight));
        
        console.log(`🧪 TEST: Normalized coords - x1=${x1_norm.toFixed(4)}, y1=${y1_norm.toFixed(4)}, x2=${x2_norm.toFixed(4)}, y2=${y2_norm.toFixed(4)}`);
        
        // Calculate center and dimensions
        const centerX = (x1_norm + x2_norm) / 2;
        const centerY = (y1_norm + y2_norm) / 2;
        const width = x2_norm - x1_norm;
        const height = y2_norm - y1_norm;
        
        return {
          id: `player_${i + 1}`,
          x: x1_norm,  // TOP-LEFT X (not center!)
          y: y1_norm,  // TOP-LEFT Y (not center!)
          width,
          height,
          confidence: det.confidence,
          description: `Player ${i + 1}`,
          centerX,
          centerY,
          topLeftX: x1_norm,
          topLeftY: y1_norm
        };
      });
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Replicate detection complete: ${players.length} players in ${processingTime}ms`);
      
      return {
        success: true,
        timestamp: timestampMs / 1000,
        frameAnalysis: {
          totalPlayers: players.length,
          imageSize: `${imgWidth}x${imgHeight}`,
          method: "replicate_ultralytics_yolo11_gpu_direct"
        },
        players,
        processingTime,
        modelType: "Replicate-Ultralytics-YOLOv11-GPU-Direct"
      };
      
    } catch (error) {
      console.error('❌ Direct Replicate detection error:', error);
      throw error;
    }
  }
}

export const replicateDirectDetection = new ReplicateDirectDetection();
