import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../server/serverlessApp";

// Delegate /api/detect-players to the shared Express app
export default function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel passes (req, res) directly; Express app handles routing
  return (app as any)(req, res);
}
