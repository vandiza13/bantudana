// Koneksi database Vercel — Turso (libSQL remote), pengganti file SQLite
// lokal di paket standalone (`file:/data/app.db`).
//
// Kenapa Turso, bukan file SQLite:
//   Vercel adalah serverless — filesystem tiap function bersifat
//   ephemeral (hilang setiap deploy/restart/instans baru). File
//   `app.db` yang ditulis di Vercel akan hilang, dan tiap instans
//   function akan melihat database yang berbeda. Turso memakai dialek
//   SQLite yang sama (libSQL) sehingga skema Drizzle dan seluruh SQL
//   migrasi 0001–0007 tidak berubah sama sekali — hanya cara koneksinya.
//
// Konfigurasi lewat env (isi di Vercel → Project → Settings →
// Environment Variables, dan lokal di `.env`):
//   TURSO_DATABASE_URL  — mis. libsql://bantudana-xxxx.turso.io
//   TURSO_AUTH_TOKEN    — token database Turso (RAHASIA, jangan commit)
//
// Untuk smoke test lokal tanpa akun Turso, URL boleh berupa file lokal,
// mis. TURSO_DATABASE_URL=file:/tmp/bantudana-smoke.db — @libsql/client
// mendukung keduanya dengan API yang sama.
//
// Migrasi: jalur utama adalah `npm run db:migrate` (scripts/migrate.ts)
// yang dijalankan SEBELUM deploy pertama dan setiap kali skema berubah.
// Sebagai jaring pengaman, getDb() juga menjalankan migrate() sekali
// per cold start — bila database sudah termigrasi, pemanggilan itu
// no-op (hanya membaca jurnal migrasi). Error "already exists" yang
// muncul bila dua cold start bermigrasi bersamaan diabaikan.
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { join } from "node:path";
import * as schema from "./schema";

let dbPromise: Promise<LibSQLDatabase<typeof schema>> | null = null;

/** Folder migrasi Drizzle. Di Vercel, folder `drizzle/` disertakan ke
 *  dalam function lewat `includeFiles: "drizzle/**"` di vercel.json dan
 *  tersedia di root deployment (process.cwd()). Lokal, folder yang sama
 *  ada di root repo paket ini. */
export function migrationsFolder(): string {
  return join(process.cwd(), "drizzle");
}

/** Singleton per proses (per instans serverless yang sedang hangat):
 *  satu klien Turso dipakai ulang untuk semua request di instans itu. */
export function getDb(): Promise<LibSQLDatabase<typeof schema>> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

async function initDb(): Promise<LibSQLDatabase<typeof schema>> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL belum diisi. Lokal: salin .env.example menjadi .env lalu isi. " +
        "Vercel: isi Environment Variables TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN, lalu deploy ulang.",
    );
  }
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  const client: Client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Dua cold start yang bermigrasi bersamaan: yang kalah akan melihat
    // "table already exists" — tabelnya sudah dibuat oleh yang menang,
    // jadi lanjutkan saja. Error lain (mis. URL/token salah) tetap
    // dilempar supaya gagal dengan jelas, bukan diam-diam.
    if (!/already exists/i.test(msg)) throw err;
    console.warn("[bantudana] migrate: 'already exists' diabaikan:", msg);
  }
  return db;
}
