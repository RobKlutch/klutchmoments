import type { VercelRequest, VercelResponse } from "@vercel/node";
import express, { Request, Response } from "express";
import multer from "multer";
import Replicate from "replicate";

// Create an Express app inside the Vercel function file
const app = express();

// In-memory storage for single frames
const upload = multer({ storage: multer.memoryStorage() });

// Optional health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ ok: true });
});

// Main YOLO detection endpoint.
// IMPORTANT: when called via Vercel API route `/api/detect-players`,
// the Express app may see the path as `/` or `/api/detect-players`.
// Using "*" ensures it works in both cases.
app.post("*", upload.single("frame"), async (req: Request, res: Response) => {
  try {
    const token = process.env.REPLICATE_API_TOKEN;
    const modelId = process.env.REPLICATE_YOLO_MODEL;

    if (!token) {
      return res.status(500).json({
        error: "REPLICATE_API_TOKEN not configured on the server",
      });
    }

    if (!modelId) {
      return res.status(500).json({
        error: "REPLICATE_YOLO_MODEL not configured on the server",
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Missing 'frame' upload" });
    }

    // Frame from client as JPEG blob
    const buffer = req.file.buffer;
    const base64 = buffer.toString("base64");
    const imageDataUrl = `data:image/jpeg;base64,${base64}`;

    const replicate = new Replicate({
      auth: token,
    });

    const prediction = await replicate.run(modelId, {
      input: {
        image: imageDataUrl,
      },
    });

    res.json({
      success: true,
      model: modelId,
      prediction,
    });
  } catch (error: any) {
    console.error("🚨 Replicate detect-players error:", error);

    res.status(500).json({
      error: "Replicate detection failed",
      details: error?.message ?? String(error),
    });
  }
});

// Vercel entrypoint – delegate to the Express app
export default function handler(req: VercelRequest, res: VercelResponse) {
  return (app as any)(req, res);
}
