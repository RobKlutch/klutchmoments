import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || "",
});

// Direct YOLOv11 / botsort detection used by the serverless entrypoint
export async function detectPlayersDirect(imageBase64: string) {
  if (!process.env.REPLICATE_YOLO_MODEL) {
    throw new Error("Missing REPLICATE_YOLO_MODEL");
  }

  const modelId = process.env.REPLICATE_YOLO_MODEL;

  // Call your YOLO11-botsort model on Replicate
  const result: any = await replicate.run(modelId, {
    input: {
      // backend expects a data URL
      image: `data:image/jpeg;base64,${imageBase64}`,
      confidence: 0.15,
      iou_threshold: 0.4,
      max_detections: 25,
    },
  });

  // Normalize to the shape the rest of the app expects
  return {
    players: result?.players || [],
    raw: result,
  };
}
