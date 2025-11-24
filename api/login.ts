import type { VercelRequest, VercelResponse } from "@vercel/node";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      return res.status(200).json({
        success: true,
        user: { email }
      });
    }

    return res.status(401).json({ error: "Invalid email or password" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Internal Server Error" });
  }
}
