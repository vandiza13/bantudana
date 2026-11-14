// Vercel Serverless Function — endpoint aksi BantuDana.
//
// Di Muse, klien memanggil server lewat `createActionClient` yang POST
// JSON `{ action, args, actionCallId }` ke `./actions` dan mengharapkan
// balasan `{ data }` atau `{ error }`. Di paket standalone (VPS/Railway),
// endpoint yang sama dilayani server HTTP Bun. Di Vercel, endpoint yang
// sama dilayani function ini; vercel.json me-rewrite `/actions` ke
// `/api/actions`, jadi klien TIDAK berubah sama sekali.
//
//   POST /api/actions   (atau POST /actions — di-rewrite)
//     body: { action: "register" | "login" | ..., args: {...} }
//     ok:   { data: {...} }            (status 200)
//     gagal: { error: "pesan ramah" }  (status 400 / 404 / 405)
//
// Semua validasi Zod request/response dan seluruh handler diambil dari
// server/src/actions.ts yang SAMA PERSIS dengan versi Muse/standalone —
// tidak ada logika bisnis yang ditulis ulang di sini. Auth tetap token
// di dalam `args`, divalidasi server di setiap handler (PIN PBKDF2,
// sesi 30 hari, kunci 15 menit setelah 5 PIN salah).
//
// Runtime: Node.js 22 (lihat vercel.json). Function ini stateless:
// koneksi Turso dibuat sekali per cold start lewat getDb() di
// server/src/db.ts, lalu dipakai ulang selama instans hangat.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Actions } from "../server/src/actions";
import { getDb } from "../server/src/db";

type ActionDef = {
  request: { parse: (a: unknown) => unknown };
  response: { parse: (a: unknown) => unknown };
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

function parseBody(req: VercelRequest): Record<string, unknown> {
  const body: unknown = req.body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      throw new Error("Body harus JSON.");
    }
  }
  if (body && typeof body === "object") return body as Record<string, unknown>;
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  let body: Record<string, unknown>;
  try {
    body = parseBody(req);
  } catch (err) {
    return res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
  const action = body["action"];
  const args = (body["args"] as Record<string, unknown>) ?? {};
  const def = (Actions as Record<string, ActionDef>)[
    typeof action === "string" ? action : ""
  ];
  if (!def) {
    return res
      .status(404)
      .json({ error: `action '${String(action)}' is not defined` });
  }
  let parsedArgs: unknown;
  try {
    parsedArgs = def.request.parse(args);
  } catch (err) {
    return res.status(400).json({
      error: `invalid args: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  try {
    const db = await getDb();
    // Konteks minimal untuk handler (lihat server/src/space-shim.ts):
    // actions.ts hanya memakai ctx.db() dan ctx.invalidateQueries().
    const ctx = {
      slug: "bantudana",
      db: () => db,
      invalidateQueries: () => {},
    };
    const result = await def.handler(ctx, parsedArgs);
    const validated = def.response.parse(result);
    return res.status(200).json({ data: validated });
  } catch (err) {
    // Pesan error dari handler (mis. "Nomor HP atau PIN salah") sudah
    // ramah pengguna; teruskan apa adanya dengan status 400.
    return res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
