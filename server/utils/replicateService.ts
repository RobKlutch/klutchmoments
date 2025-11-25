import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || "",
});

// VIDEO-BASED detection and tracking using a single model (BoT-SORT for now)
export async function detectPlayersDirect(videoBase64: string) {
  const modelId =
    process.env.REPLICATE_DETECT_MODEL ||
    process.env.REPLICATE_YOLO_MODEL;

  if (!modelId) {
    throw new Error("Missing REPLICATE_YOLO_MODEL / REPLICATE_DETECT_MODEL");
  }

  // Log which model we are calling and confirm we are sending `video`
  console.log("🔁 detectPlayersDirect -> calling Replicate model:", modelId);

  const input = {
    // IMPORTANT: this must be named `video` for the model schema
    video: `data:video/mp4;base64,${videoBase64}`,
  };

  console.log("🔁 detectPlayersDirect -> input keys:", Object.keys(input));

  const result: any = await replicate.run(modelId, {
    input,
  });

  // For now, just pass through whatever the model returns.
  // We will adapt this to the exact schema once we see `result` in logs.
  // If your model already returns `{ players: [...] }`, this will just work.
  const players = (result && (result.players || result.tracks || result.detections)) || [];

  return {
    players,
    raw: result,
  };
}
