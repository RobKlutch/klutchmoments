import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../server/serverlessApp";

// Serves /api/detections/latest via Express
export default function handler(req: VercelRequest, res: VercelResponse) {
  return (app as any)(req, res);
}
