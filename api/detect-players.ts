// API route adapter: forwards /api/detect-players to the Express app
// in server/serverlessApp.ts, which handles multipart video upload + Replicate call.

import type { NextApiRequest, NextApiResponse } from 'next';
import app from '../../server/serverlessApp';

// IMPORTANT: disable Next's built-in body parsing so multer in the Express app
// can read the multipart/form-data payload (the uploaded video).
export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Express apps are just (req, res) => void handlers, so we can delegate directly.
  return app(req as any, res as any);
}
