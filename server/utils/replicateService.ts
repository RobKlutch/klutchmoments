import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || "",
});

// VIDEO-BASED detection and tracking using BoT-SORT
export async function detectPlayersDirect(videoBase64: string) {
  const modelId =
    process.env.REPLICATE_DETECT_MODEL ||
    process.env.REPLICATE_YOLO_MODEL;

  if (!modelId) {
    throw new Error("Missing REPLICATE_YOLO_MODEL / REPLICATE_DETECT_MODEL");
  }

  const result: any = await replicate.run(modelId, {
    input: {
      // IMPORTANT: BoT-SORT expects "video", not "image"
      video: `data:video/mp4;base64,${videoBase64}`,
    },
  });

  // TEMP: Pass raw output forward until we map final schema
  return {
    players: result?.players ?? [],
    raw: result,
  };
}
