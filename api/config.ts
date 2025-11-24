import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Frontend loads runtime config (Supabase + API base URL) from here.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  return res.status(200).json({
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY,
    apiBaseUrl:
      process.env.VITE_API_BASE_URL || "https://klutchmoments.vercel.app/api",
  });
}
