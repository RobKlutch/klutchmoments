import express, { Request, Response } from "express";
import multer from "multer";
import { detectPlayersDirect } from "./utils/replicateService";

const app = express();

// Use in-memory storage for uploaded video clips
const upload = multer({ storage: multer.memoryStorage() });

// Optional health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ ok: true });
});

// Main detection endpoint.
// When deployed via Vercel (`/api/detect-players`), Express may see the path
// as `/` or `/api/detect-players`, so "*" covers both.
app.post("*", upload.single("video"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Missing 'video' upload" });
    }

    const buffer = req.file.buffer;
    const base64 = buffer.toString("base64");

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
