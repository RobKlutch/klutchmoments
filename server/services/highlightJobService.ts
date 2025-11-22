import { randomUUID } from "crypto";
import { z } from "zod";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_YOLO_MODEL = process.env.REPLICATE_YOLO_MODEL;
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const highlightJobRequestSchema = z.object({
  videoUrl: z.string().url("videoUrl must be an http(s) URL").optional(),
  videoId: z.string().min(1, "videoId is required when videoUrl is absent").optional(),
  playerSelection: z.object({
    id: z.string().min(1, "playerSelection.id is required"),
    boundingBox: z.object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    frameTimeMs: z.number().int().nonnegative().optional()
  }),
  spotlight: z.object({
    type: z.string().min(1),
    intensity: z.number().min(0).max(1).optional(),
    ring: z.boolean().optional(),
    beam: z.string().optional(),
    color: z.string().optional(),
    size: z.number().optional(),
  })
});

export type HighlightJobRequest = z.infer<typeof highlightJobRequestSchema>;

interface NormalizedBox {
  id: string;
  label: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}

export interface NormalizedBoundingBoxes {
  frames: Array<{
    frameIndex: number;
    timeMs: number;
    boxes: NormalizedBox[];
  }>;
}

function getSupabaseHeaders(useServiceKey = false) {
  const key = useServiceKey ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !key) {
    throw new Error("Supabase configuration is missing. Please set SUPABASE_URL and the appropriate key.");
  }

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  } as Record<string, string>;
}

async function supabaseRequest<T>(path: string, options: RequestInit & { useServiceKey?: boolean } = {}): Promise<T> {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
  }

  const { useServiceKey = false, ...rest } = options;
  const headers = {
    ...getSupabaseHeaders(useServiceKey),
    ...(rest.headers || {}) as Record<string, string>,
  };

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...rest,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

export async function insertHighlightJob(request: HighlightJobRequest, userId?: string) {
  const payload = {
    id: randomUUID(),
    user_id: userId || null,
    video_url: request.videoUrl || null,
    player_id: request.playerSelection.id,
    model_name: REPLICATE_YOLO_MODEL || null,
    spotlight_type: request.spotlight.type,
    spotlight_settings: request.spotlight,
    bounding_boxes: null,
    status: "queued",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    video_reference: request.videoId || null,
  } as Record<string, any>;

  const rows = await supabaseRequest<any[]>(
    `/rest/v1/highlight_jobs`,
    {
      method: "POST",
      useServiceKey: true,
      body: JSON.stringify(payload),
    }
  );

  return rows[0];
}

export async function updateHighlightJob(id: string, updates: Record<string, any>) {
  return supabaseRequest<any[]>(
    `/rest/v1/highlight_jobs?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      useServiceKey: true,
      body: JSON.stringify(updates),
    }
  ).then(rows => rows[0]);
}

export async function getHighlightJob(id: string) {
  const rows = await supabaseRequest<any[]>(
    `/rest/v1/highlight_jobs?id=eq.${encodeURIComponent(id)}&limit=1`,
    {
      method: "GET",
      useServiceKey: true,
    }
  );

  return rows[0] || null;
}

function normalizeReplicateOutput(output: any): NormalizedBoundingBoxes {
  const frames: NormalizedBoundingBoxes["frames"] = [];

  const outputFrames = Array.isArray(output)
    ? output
    : Array.isArray(output?.predictions)
      ? output.predictions
      : Array.isArray(output?.results)
        ? output.results
        : [];

  outputFrames.forEach((frame: any, index: number) => {
    const detections = Array.isArray(frame?.detections)
      ? frame.detections
      : Array.isArray(frame)
        ? frame
        : Array.isArray(frame?.predictions)
          ? frame.predictions
          : [];

    const boxes: NormalizedBox[] = detections.map((det: any, detIndex: number) => {
      const width = Number(det.width ?? det.w ?? 0);
      const height = Number(det.height ?? det.h ?? 0);
      const xCenter = Number(det.x ?? det.center_x ?? det.cx ?? 0);
      const yCenter = Number(det.y ?? det.center_y ?? det.cy ?? 0);

      // Normalize coordinates to 0-1 if they look like pixel values
      const normalizeIfPixels = (value: number) => (value > 1 ? value / 1000 : value);

      return {
        id: String(det.id || detIndex),
        label: det.class || det.label || "player",
        confidence: Number(det.confidence ?? det.score ?? 0),
        box: {
          x: normalizeIfPixels(xCenter),
          y: normalizeIfPixels(yCenter),
          width: normalizeIfPixels(width || 0.1),
          height: normalizeIfPixels(height || 0.1),
        },
      };
    });

    frames.push({
      frameIndex: frame.frame_index ?? index,
      timeMs: frame.time ?? frame.timestamp ?? index * 1000,
      boxes,
    });
  });

  return { frames };
}

async function runReplicateYolo(videoUrl: string, spotlightType: string) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error("Missing REPLICATE_API_TOKEN environment variable");
  }
  if (!REPLICATE_YOLO_MODEL) {
    throw new Error("Missing REPLICATE_YOLO_MODEL environment variable (owner/model:version)");
  }

  const predictionResponse = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    },
    body: JSON.stringify({
      version: REPLICATE_YOLO_MODEL,
      input: {
        video: videoUrl,
        prompt: `Detect players for ${spotlightType} spotlight overlay`,
      },
    }),
  });

  if (!predictionResponse.ok) {
    const body = await predictionResponse.text();
    throw new Error(`Replicate request failed (${predictionResponse.status}): ${body}`);
  }

  let prediction = await predictionResponse.json();

  const terminalStates = new Set(["succeeded", "failed", "canceled"]);
  let attempt = 0;

  while (!terminalStates.has(prediction.status) && attempt < 20) {
    attempt += 1;
    await new Promise(resolve => setTimeout(resolve, 1500));

    const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      },
    });

    if (!statusResponse.ok) {
      const body = await statusResponse.text();
      throw new Error(`Failed to poll Replicate prediction: ${body}`);
    }

    prediction = await statusResponse.json();
  }

  if (!terminalStates.has(prediction.status)) {
    throw new Error("Replicate job did not finish within the expected time window");
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Replicate job ${prediction.status}`);
  }

  return normalizeReplicateOutput(prediction.output);
}

export async function processHighlightJob(jobId: string, request: HighlightJobRequest) {
  try {
    await updateHighlightJob(jobId, { status: "processing", updated_at: new Date().toISOString() });

    if (!request.videoUrl) {
      throw new Error("videoUrl is required for Replicate processing");
    }

    const boundingBoxes = await runReplicateYolo(request.videoUrl, request.spotlight.type);

    await updateHighlightJob(jobId, {
      status: "done",
      bounding_boxes: boundingBoxes,
      model_name: REPLICATE_YOLO_MODEL,
      spotlight_type: request.spotlight.type,
      spotlight_settings: request.spotlight,
      updated_at: new Date().toISOString(),
    });

    return boundingBoxes;
  } catch (error) {
    console.error("Highlight processing failed", error);
    await updateHighlightJob(jobId, {
      status: "failed",
      bounding_boxes: { error: error instanceof Error ? error.message : String(error) },
      updated_at: new Date().toISOString(),
    });
    throw error;
  }
}
