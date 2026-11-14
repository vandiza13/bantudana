// Healthcheck — dipakai untuk memastikan deployment hidup dan function
// merespons, tanpa menyentuh database.
//
//   GET /api/healthz   (atau GET /healthz — di-rewrite di vercel.json)
//     -> { "ok": true }  (status 200)
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("x-content-type-options", "nosniff");
  return res.status(200).json({ ok: true });
}
