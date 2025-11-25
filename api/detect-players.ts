// api/detect-players.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || '',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const modelId =
      process.env.REPLICATE_DETECT_MODEL ||
      process.env.REPLICATE_YOLO_MODEL;

    if (!modelId) {
      res
        .status(500)
        .json({ error: 'Missing REPLICATE_YOLO_MODEL / REPLICATE_DETECT_MODEL' });
      return;
    }

    let body: any = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // fall through, will fail validation below
      }
    }

    const {
      videoUrl,
      timestampMs,
      sessionId,
      detectionMethod,
      selectedPlayerId,
    } = body || {};

    if (!videoUrl) {
      res.status(400).json({ error: 'Missing videoUrl in request body' });
      return;
    }

    const input: any = {
      video: videoUrl,        // Replicate botsort expects a video URL string
      conf: 0.4,
    };

    if (selectedPlayerId !== undefined && selectedPlayerId !== null) {
      input.selected_player_id = Number(selectedPlayerId);
    }

    console.log('🎥 Calling Replicate detect-players', {
      modelId,
      videoUrl,
      sessionId,
      detectionMethod,
      timestampMs,
      selectedPlayerId,
      inputKeys: Object.keys(input),
    });

    const result: any = await replicate.run(modelId, { input });

    // We don't yet know the exact shape; pass through and expose a generic "players" field.
    const players =
      result?.selected_player ||
      result?.players ||
      result?.tracks ||
      [];

    res.status(200).json({
      success: true,
      model: modelId,
      players,
      raw: result,
    });
  } catch (error: any) {
    console.error('🚨 Replicate detect-players error:', error);
    res.status(500).json({
      error: 'Replicate detection failed',
      details: error?.message ?? String(error),
    });
  }
}
