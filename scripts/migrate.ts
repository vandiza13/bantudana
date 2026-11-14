// Jalankan migrasi Drizzle 0001–0007 ke database Turso.
//
// WAJIB dijalankan SEBELUM deploy pertama ke Vercel, dan setiap kali
// skema berubah (file baru di drizzle/). Function di Vercel juga
// menjalankan migrasi sebagai jaring pengaman saat cold start, tapi
// jangan mengandalkan itu — migrasi dari sini jauh lebih aman
// (sekali jalan, tanpa risiko dua cold start bermigrasi bersamaan).
//
//   cp .env.example .env   # isi TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
//   npm run db:migrate
//
// Atau tanpa file .env (token di shell, tidak tersimpan):
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:migrate
//
// Skrip ini hanya membaca env dan menjalankan DDL — tidak membuat
// akun, pinjaman, atau data apa pun.
import "dotenv/config";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { join } from "node:path";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error(
    "TURSO_DATABASE_URL belum diisi.\n" +
      "  Buat database Turso dulu (lihat README.md), lalu:\n" +
      "    cp .env.example .env   # lalu isi TURSO_DATABASE_URL + TURSO_AUTH_TOKEN\n" +
      "  atau isi lewat shell:\n" +
      "    TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:migrate",
  );
  process.exit(1);
}

const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
if (url.startsWith("libsql://") && !authToken) {
  console.warn(
    "Peringatan: TURSO_AUTH_TOKEN kosong untuk URL libsql:// — " +
      "koneksi ke Turso kemungkinan akan ditolak.",
  );
}

const client = createClient({ url, authToken });
const db = drizzle(client);
const migrationsFolder = join(process.cwd(), "drizzle");
console.log(`[migrate] database: ${url.replace(/\/\/.*@/, "//***@")}`);
console.log(`[migrate] folder migrasi: ${migrationsFolder}`);
await migrate(db, { migrationsFolder });

// Verifikasi: daftar tabel yang sekarang ada.
const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
);
console.log(
  "[migrate] selesai. Tabel:",
  tables.rows.map((r) => String(r["name"])).join(", "),
);
