// Vercel serverless function adapter for /api/detect-players
// Delegates handling to the Express app defined in server/serverlessApp.ts

import app from '../server/serverlessApp';

// We keep types as `any` here to avoid coupling to specific Vercel/Next types.
export default function handler(req: any, res: any) {
  // Express app signature is (req, res), so we can just forward.
  return app(req, res);
}
