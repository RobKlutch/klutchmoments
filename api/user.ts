import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Simple user endpoint used by the frontend after login.
 * For now we just return a dummy admin user.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const adminEmail = process.env.ADMIN_EMAIL || "admin@admin.com";

  return res.status(200).json({
    user: {
      id: "admin",
      email: adminEmail,
      role: "admin",
      name: "Admin",
    },
  });
}
