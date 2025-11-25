// Vercel serverless function for /api/detect-players
// Directly exports the Express app from server/serverlessApp.ts

import app from '../server/serverlessApp';

// Express apps are just (req, res) => void handlers, which Vercel can invoke directly.
export default app;
