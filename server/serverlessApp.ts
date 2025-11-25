import express, { Request, Response } from "express";
import multer from "multer";
import { detectPlayersDirect } from "./utils/replicateService";

const app = express();

// Use in-memory storage for single frames
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
    if (!req.file) {
      return res.status(400).json({ error: "Missing 'frame' upload" });
    }

    const buffer = req.file.buffer;
    const base64 = buffer.toString("base64");

    // This will use REPLICATE_DETECT_MODEL if set, otherwise REPLICATE_YOLO_MODEL
    const { players, raw } = await detectPlayersDirect(base64);

    res.json({
      success: true,
      model:
        process.env.REPLICATE_DETECT_MODEL ||
        process.env.REPLICATE_YOLO_MODEL ||
        "unknown",
      players,
      raw,
    });
  } catch (error: any) {
    console.error("🚨 Replicate detect-players error:", error);

    res.status(500).json({
      error: "Replicate detection failed",
      details: error?.message ?? String(error),
    });
  }
});

export default app;
