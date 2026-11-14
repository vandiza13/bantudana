// Server lokal untuk menguji BantuDana lengkap (frontend + API) tanpa deploy.
//
// Menjalankan handler asli `api/actions.ts` + `api/healthz.ts` di atas
// server HTTP Node biasa (port 3102), dengan adaptor kecil req/res,
// PLUS menyajikan frontend hasil `npm run build` (client/dist) di URL yang
// sama — jadi buka http://localhost:3102 di browser langsung tampil
// aplikasi BantuDana, bukan cuma JSON API.
//
// Urutan pakai:
//   npm run build        # sekali, hasilkan client/dist
//   npm run dev:local    # sajikan UI + API di http://localhost:3102
//
// Dipakai bersama scripts/smoke-test.ts:
//
//   TURSO_DATABASE_URL=file:/tmp/bantudana-smoke.db npm run dev:local
//   # di terminal lain:
//   npm run smoke -- http://localhost:3102
//
// Untuk database lokal, URL boleh `file:...` (tidak perlu akun Turso).
// JANGAN arahkan server lokal ini ke database Turso produksi lalu
// menjalankan smoke test — smoke test membuat akun/pinjaman demo dan
// hanya boleh jalan melawan database kosong/uji.
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/actions.js";
import healthz from "../api/healthz.js";

const DIST_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "client", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const PORT = Number(process.env.PORT ?? 3102);

type FakeRes = {
  status: (code: number) => FakeRes;
  json: (body: unknown) => void;
  setHeader: (key: string, value: string) => void;
};

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let statusCode = 200;
  const fakeRes: FakeRes = {
    status(code: number) {
      statusCode = code;
      return fakeRes;
    },
    json(body: unknown) {
      send(statusCode, body);
    },
    setHeader(key: string, value: string) {
      res.setHeader(key, value);
    },
  };
  try {
    if (url.pathname === "/healthz") {
      await healthz(
        { method: req.method } as never,
        fakeRes as never,
      );
      return;
    }
    if (url.pathname === "/actions") {
      let body: unknown = {};
      try {
        body = await readJsonBody(req);
      } catch {
        send(400, { error: "Body harus JSON." });
        return;
      }
      await handler(
        { method: req.method, body, query: {} } as never,
        fakeRes as never,
      );
      return;
    }
    // Frontend statis (client/dist) + SPA fallback ke index.html.
    // Jalankan `npm run build` dulu bila dist belum ada.
    if (req.method === "GET" || req.method === "HEAD") {
      const cleanPath = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = join(DIST_DIR, cleanPath);
      const safe = resolve(filePath).startsWith(resolve(DIST_DIR));
      if (safe && existsSync(filePath) && !filePath.endsWith("/")) {
        res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
        res.end(readFileSync(filePath));
        return;
      }
      const indexPath = join(DIST_DIR, "index.html");
      if (safe && existsSync(indexPath) && !cleanPath.includes(".")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(indexPath));
        return;
      }
      if (!existsSync(indexPath)) {
        send(404, { error: "Frontend belum di-build. Jalankan `npm run build` dulu, lalu `npm run dev:local` lagi." });
        return;
      }
    }
    send(404, { error: "Not found" });
  } catch (err) {
    console.error("[serve-local] error:", err);
    if (!res.headersSent) send(500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[serve-local] BantuDana (UI + API) di http://localhost:${PORT}`);
  console.log(`[serve-local] TURSO_DATABASE_URL=${process.env.TURSO_DATABASE_URL ?? "(belum diisi)"}`);
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    console.log(`[serve-local] Frontend belum di-build — jalankan \`npm run build\` dulu di terminal lain, lalu refresh browser.`);
  }
  console.log(`[serve-local] Uji API: npm run smoke -- http://localhost:${PORT}`);
});
