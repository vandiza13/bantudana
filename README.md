# BantuDana — Paket Deploy Vercel + Turso

Paket ini membuat **BantuDana bisa dibuka Gibran dari HP-nya sendiri
lewat Vercel**, tanpa aplikasi Muse dan tanpa VPS. Isinya aplikasi yang
sama persis dengan versi Muse (slug `bantudana`), diadaptasi seminimal
mungkin supaya jalan sebagai aplikasi serverless di Vercel.

> **Bukan tautan publik Muse.** Aplikasi interaktif Muse tidak bisa
> dipublikasikan sebagai tautan umum — hanya halaman statis yang bisa.
> Paket ini adalah jalan keluarnya: deploy mandiri ke Vercel.
> **Tidak ada URL live di sini** — URL baru ada setelah Tubagus
> push ke GitHub dan deploy di Vercel (lihat "Langkah deploy").

## Daftar isi

- [Kenapa Vercel butuh adaptasi](#kenapa-vercel-butuh-adaptasi)
- [Cara kerja versi Vercel](#cara-kerja-versi-vercel)
- [Apa yang berubah dari versi Muse/standalone](#apa-yang-berubah-dari-versi-muse-standalone)
- [Biaya: Vercel + Turso](#biaya-vercel--turso)
- [Langkah deploy](#langkah-deploy)
- [Coba lokal dulu (tanpa deploy)](#coba-lokal-dulu-tanpa-deploy)
- [Data apa yang terbawa](#data-apa-yang-terbawa)
- [Keamanan](#keamanan)
- [Troubleshooting](#troubleshooting)
- [Yang masih butuh keputusan Tubagus](#yang-masih-butuh-keputusan-tubagus)

## Kenapa Vercel butuh adaptasi

Vercel itu **serverless**: tidak ada proses yang jalan terus, dan
filesystem tiap function bersifat **ephemeral** (hilang setiap
deploy/restart/instans baru). BantuDana versi standalone (VPS/Railway)
adalah satu proses Bun yang jalan terus + file SQLite yang harus
tersimpan permanen — pola itu **tidak bisa** jalan di Vercel apa adanya.
Kalau dipaksa, database akan hilang dan tiap instans function akan
melihat data yang berbeda.

Karena itu paket ini mengubah tiga hal — dan hanya tiga hal itu:

| Bagian | Versi standalone (VPS) | Versi Vercel (paket ini) |
|---|---|---|
| Frontend | Build Bun (`Bun.build`) | Build **Vite 6** (Node.js) ke `client/dist/`, disajikan Vercel sebagai file statis |
| Backend | Server HTTP Bun (`Bun.serve`, `POST /actions`) | **Vercel Serverless Functions** Node.js 22: `api/actions.ts` (`POST /api/actions`, di-rewrite dari `/actions`) + `api/healthz.ts` |
| Database | File SQLite `/data/app.db` (volume persisten) | **Turso** (libSQL remote — dialek SQLite yang sama, skema & migrasi tidak berubah) |

Yang **tidak** berubah: seluruh logika bisnis di
`server/src/actions.ts` dan `server/src/schema.ts` disalin apa adanya
(model tenor bulan + bunga flat %/bulan, Pengaturan Admin, bunga
keterlambatan 0,1%/hari, peran Admin/User, alur bayar cicilan
ajukan → menunggu → Admin konfirmasi/tolak, laporan/CSV, pengingat
WhatsApp, jejak audit, keamanan PIN PBKDF2, kunci 15 menit setelah
5 PIN salah, sesi 30 hari).

## Cara kerja versi Vercel

```
HP Gibran ──HTTPS──> Vercel
                      ├─ /            -> client/dist/index.html (statis)
                      ├─ /assets/*    -> file statis hasil build Vite
                      ├─ GET  /healthz  -> api/healthz.ts  { ok: true }
                      └─ POST /actions  -> (rewrite) api/actions.ts
                                              -> validasi Zod request
                                              -> handler actions.ts
                                              -> validasi Zod response
                                              -> { data } / { error }
                      Turso (libSQL remote, migrasi 0001–0007)
```

- Satu origin penuh (klien + API di domain yang sama) jadi tidak
  perlu CORS.
- Auth sama seperti di Muse: setiap aksi membawa `token` di dalam
  `args`; server memvalidasi token dan peran di setiap handler.
- Rute klien apa pun (selain `/api/*`, `/assets/*`, dan file
  ber-ekstensi) di-rewrite ke `/index.html` (fallback SPA) oleh
  `vercel.json`.

## Biaya: Vercel + Turso

Harga dicek lewat pencarian web **14 Nov 2026** — **cek ulang harga
saat deploy, karena bisa berubah**.

**Turso — Free $0 (tanpa kartu kredit)**, menurut turso.tech/pricing:
100 database, **5 GB** storage total, **500 juta baris dibaca/bulan**,
**10 juta baris ditulis/bulan**, 3 GB sync/bulan, point-in-time
restore 1 hari. Untuk BantuDana (satu database kecil, pemakaian
Gibran + beberapa peminjam) ini jauh di atas kebutuhan. Catatan:
database gratis bisa diarsipkan setelah lama tidak aktif — cek
kebijakan arsip di halaman pricing Turso; dan bila kelak melewati
kuota, database bisa diblokir sampai naik tier (Developer ±$5,99/bln).
Jangan jadikan angka-angka ini janji — halaman pricing Turso adalah
sumber kebenaran.

**Vercel — Hobby $0** untuk proyek pribadi kecil (cek batasnya di
halaman pricing Vercel sebelum deploy — batas bandwidth dan eksekusi
function berlaku; BantuDana yang dipakai segelintir orang sangat
jauh di bawah batas itu). Function di paket ini dibatasi
`maxDuration: 30` detik (masih dalam batas Hobby).

**Total awal: $0/bulan** (Vercel Hobby + Turso Free). Domain sendiri
(`bantudana.vandiza.com`) tetap opsional — Vercel memberi subdomain
gratis `*.vercel.app`, domain sendiri bisa dipasang nanti dari
dashboard Vercel (atur DNS sesuai petunjuk Vercel).

## Langkah deploy

Perkiraan waktu: 30–60 menit pertama kali (termasuk buat akun).

### 0. Yang perlu disiapkan Tubagus

1. Akun **GitHub** (gratis) — untuk menyimpan kode paket ini.
2. Akun **Turso** (gratis, tanpa kartu) + **Turso CLI** terpasang
   (`curl -sSfL https://get.tur.so/install.sh | bash`, lalu
   `turso auth login`). Alternatif tanpa CLI: buat database dari
   dashboard Turso di browser.
3. Akun **Vercel** (gratis, Hobby) — bisa daftar dengan akun GitHub
   yang sama.

### 1. Push paket ini ke GitHub

```bash
cd ~/workspace/bantudana-vercel
git init
git add .
git commit -m "BantuDana — deploy Vercel + Turso"
# buat repo kosong di github.com (mis. vandiza/bantudana-vercel), lalu:
git remote add origin https://github.com/vandiza/bantudana-vercel.git
git branch -M main
git push -u origin main
```

Periksa sebelum push: `git status` tidak boleh menampilkan `.env`
(file itu dikecualikan `.gitignore`; yang boleh ikut hanya
`.env.example`).

### 2. Buat database Turso + token

```bash
turso db create bantudana
turso db show --url
# contoh hasil: libsql://bantudana-xxxxxxxx.turso.io
turso db tokens create bantudana
# hasilkan token panjang — simpan baik-baik, hanya tampil sekali
```

Catat URL dan token itu — dipakai di langkah 3 dan 4.

### 3. Jalankan migrasi (sekali, sebelum deploy pertama)

Dari folder paket ini, dengan Node.js 20+ terpasang:

```bash
npm install
cp .env.example .env
# isi TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN di .env, lalu:
npm run db:migrate
# harus menampilkan: "[migrate] selesai. Tabel: accounts, activity_log,
#  loans, loan_settings, payments, sessions"
```

Jalankan lagi perintah ini setiap kali ada file migrasi baru di
`drizzle/` (saat ini 0001–0007). Function di Vercel juga menjalankan
migrasi sebagai jaring pengaman saat cold start, tapi jangan
mengandalkan itu.

### 4. Import repo ke Vercel + isi env

1. Login Vercel → **Add New → Project** → **Import** repo
   `bantudana-vercel` dari GitHub.
2. Vercel mendeteksi `vercel.json` otomatis — biarkan
   **Framework Preset: Other**, **Build Command: `npm run build`**,
   **Output Directory: `client/dist`** (sudah tertulis di vercel.json).
3. Sebelum Deploy, buka **Environment Variables**, isi:
   ```
   TURSO_DATABASE_URL=libsql://bantudana-xxxxxxxx.turso.io
   TURSO_AUTH_TOKEN=<token dari langkah 2>
   ```
   Centang untuk Production (dan Preview bila mau).
4. Klik **Deploy**, tunggu build selesai (±2–4 menit pertama kali).
5. Catat URL-nya, mis. `https://bantudana-vercel.vercel.app`. Itulah
   tautan yang dikirim ke Gibran.

### 5. Cek kesehatan + buat akun demo

1. Buka `https://<domain>/healthz` — harus menampilkan
   `{"ok": true}`.
2. Buka `https://<domain>/` — layar Masuk/Daftar BantuDana tampil.
3. Daftar akun demo (**berurutan — Admin dulu, baru User**, karena
   akun pertama selalu jadi Admin):
   - **Admin: Gibran Yudistira, 081234567890, PIN 123456**
   - **User: Sari Wulandari, 081234567891, PIN 123456**
4. Uji alur: User ajukan pinjaman → Admin ACC → User bayar cicilan →
   Admin konfirmasi. Angka contoh: Rp2.500.000 tenor 6 bulan bunga
   2%/bulan → total bunga Rp300.000, total Rp2.800.000,
   cicilan Rp466.667/bulan.

### 6. Kirim ke Gibran

Kirim tautan domain + instruksi: Gibran **daftar pertama** dengan
nomor HP aslinya bila akun demo dihapus dulu (lihat "Data apa yang
terbawa"), atau login dengan akun demo Admin dan segera ganti PIN di
menu Akun.

## Coba lokal dulu (tanpa deploy)

Tanpa akun Vercel/Turso — memakai database file lokal sebagai
pengganti Turso (API `@libsql/client` yang sama):

```bash
cd ~/workspace/bantudana-vercel
npm install
npm run typecheck   # tsc klien + server + api
npm run build       # Vite build klien ke client/dist

# Jalankan handler Vercel secara lokal di port 3102:
rm -f /tmp/bantudana-smoke.db
TURSO_DATABASE_URL=file:/tmp/bantudana-smoke.db npm run dev:local
# di terminal lain (database harus KOSONG):
npm run smoke -- http://localhost:3102
# 13 cek: healthz, register Admin/User, login, settings, tolak
# pinjaman Admin, pengajuan Rp2,5jt/6bln, ACC, dashboard,
# bayar cicilan menunggu, konfirmasi -> sisa Rp2.333.333,
# denda keterlambatan 10 hari -> Rp4.667
```

Smoke test menolak base URL selain localhost, kecuali
`SMOKE_ALLOW_REMOTE=1` — pengaman supaya tidak sengaja mengetes
database produksi yang sudah berisi data asli.

## Data apa yang terbawa

**Tidak ada data lama yang terbawa.** Deploy baru mulai dari database
kosong (migrasi 0001–0007 dijalankan otomatis). Yang harus dibuat
ulang di deploy baru:

| Akun demo (untuk uji coba) | Peran | Nomor HP | PIN |
|---|---|---|---|
| Gibran Yudistira | **Admin** (akun pertama) | 081234567890 | 123456 |
| Sari Wulandari | **User** (akun kedua) | 081234567891 | 123456 |

- Akun **pertama** yang dibuat selalu jadi Admin. Jadi urutan
  pendaftaran penting: **buat Admin dulu, baru User**.
- Data produksi dari artifact Muse lama (akun, pinjaman, pembayaran)
  sudah hilang sejak artifact lama terhapus dan tidak bisa dipulihkan
  dari snapshot kode — deploy ini juga tidak membawanya.
- Untuk serah terima nyata ke Gibran, ada dua pilihan:
  1. Gibran memakai akun demo Admin di atas lalu **segera ganti PIN**
     di menu Akun (nomor HP-nya tetap nomor demo — catat itu).
  2. **Lebih bersih:** reset database Turso dulu
     (`turso db destroy bantudana` lalu buat ulang + `npm run db:migrate`),
     lalu Gibran daftar pertama dengan nomor HP aslinya sebagai Admin.
     Semua data ikut terhapus saat reset — hanya untuk sebelum pemakaian
     nyata.

## Keamanan

- **Wajib HTTPS.** Vercel memberi HTTPS otomatis pada semua domainnya.
  Jangan deploy BantuDana lewat HTTP polos — token sesi dan PIN akan
  lewat jaringan tanpa enkripsi.
- **Ganti PIN demo sebelum dipakai nyata.** PIN 123456 itu demo dan
  sudah tersebar di chat. Admin bisa ganti lewat menu Akun > Ganti PIN.
- **Jangan sebarkan tautan + login demo ke sembarang orang.** Siapa
  pun yang punya tautan bisa mendaftar sebagai User dan mengajukan
  pinjaman (Admin yang menyetujui — tapi tetap saja, ini aplikasi
  internal Gibran, bukan untuk publik).
- **Jangan commit `.env` atau token Turso.** Token itu setara password
  database — siapa pun yang memegangnya bisa membaca/mengubah seluruh
  data. Bila token bocor, buat token baru (`turso db tokens create`)
  dan cabut yang lama, lalu perbarui env di Vercel dan deploy ulang.
- **Backup berkala:** unduh laporan CSV dari menu Laporan (Admin)
  secara rutin. Backup penuh database Turso: `turso db shell`
  / `turso db dump` — lihat dokumentasi Turso.
- **Bukan aplikasi keuangan berizin.** BantuDana adalah alat
  pencatatan pinjaman privat Gibran (pemberi pinjaman tunggal).
  Bukan P2P lending publik — untuk itu wajib terdaftar/berizin OJK.
  Jangan terima uang nyata lewat aplikasi ini tanpa kesepakatan dan
  pencatatan yang jelas di luar aplikasi.

## Troubleshooting

| Gejala | Penyebab paling mungkin | Perbaikan |
|---|---|---|
| Build Vercel gagal di `npm ci` | `package-lock.json` tidak ikut ter-commit | Pastikan `package-lock.json` ada di repo dan ter-push |
| Build gagal: `vite: command not found` | `vite` terpasang sebagai devDependency tapi Vercel tidak install devDeps | Vercel meng-install devDeps saat build (NODE_ENV=production tidak menghalangi install di Vercel). Bila masih gagal, cek log build dan pastikan `npm run build` jalan lokal |
| `/healthz` ok, tapi `/actions` error `TURSO_DATABASE_URL belum diisi` | Env belum diisi / belum redeploy setelah isi env | Isi env di Vercel → **Redeploy** (env baru tidak berlaku untuk deployment lama) |
| Aksi gagal: `no such table: accounts` | Migrasi belum dijalankan | Jalankan `npm run db:migrate` dengan env Turso yang sama, lalu coba lagi |
| Aksi gagal: `Unable to connect` / token ditolak | URL/token salah atau token kedaluwarsa | Cek ulang `turso db show --url` dan buat token baru, perbarui env Vercel, redeploy |
| Data hilang / akun tidak ditemukan setelah redeploy | Database Turso dihapus/diganti, atau env menunjuk database lain | Cek env TURSO_DATABASE_URL di Vercel; data di Turso tidak hilang saat redeploy Vercel — yang hilang hanya bila database Tursonya yang dihapus |
| Halaman tampil tapi rute lain 404 | Rewrite SPA tidak aktif | Pastikan `vercel.json` ter-commit dan Vercel memakai `outputDirectory: client/dist` |
| Function timeout / lambat pertama kali | Cold start + migrasi pengaman saat cold start | Normal untuk request pertama setelah deploy; request berikutnya memakai instans hangat. Bila sering, migrasi sudah jalan dari `npm run db:migrate` sehingga cold start hanya membaca jurnal |

## Yang masih butuh keputusan Tubagus

1. **Repo GitHub mana** (mis. `vandiza/bantudana-vercel`) dan akun GitHub siapa.
2. **Akun siapa yang membayar/mengelola:** akun Turso dan Vercel dibuat atas nama Tubagus (Vandiza Tech) atau Gibran? Ini menentukan siapa yang memegang akses database dan deployment.
3. **Domain:** cukup subdomain gratis Vercel (`*.vercel.app`), atau pasang domain sendiri (mis. `bantudana.vandiza.com` — atur DNS sesuai petunjuk Vercel, bukan Caddy seperti di VPS).
4. **Akun demo vs akun nyata:** untuk uji coba, buat akun demo di atas. Untuk serah terima, pilih: Gibran pakai akun demo Admin (ganti PIN) atau reset database lalu Gibran daftar pertama dengan nomor aslinya (lihat "Data apa yang terbawa").
5. **Siapa yang men-deploy:** Tubagus sendiri mengikuti README ini, atau minta dipandu — butuh akses akun GitHub/Vercel/Turso (jangan kirim password lewat chat; akses dibuat lewat undangan/kolaborator).

## Struktur paket

```
bantudana-vercel/
  vercel.json            # build/output/rewrites/functions (Node 22)
  package.json           # scripts npm (Node, tanpa Bun)
  client/
    index.html           # entry Vite
    vite.config.ts       # build Vite -> client/dist
    tsconfig.json
    src/                 # React 19 — disalin apa adanya
  server/src/
    actions.ts           # logika bisnis — disalin apa adanya
    schema.ts            # skema Drizzle — disalin apa adanya
    space-shim.ts        # pengganti @hatch/space-sdk — disalin
    db.ts                # BARU: Turso (libsql://) + migrasi
  api/
    actions.ts           # Vercel Serverless Function POST /api/actions
    healthz.ts           # Vercel Serverless Function GET /api/healthz
    tsconfig.json
  drizzle/               # migrasi 0001–0007 — disalin apa adanya
  scripts/
    migrate.ts           # npm run db:migrate
    serve-local.ts       # npm run dev:local (uji handler tanpa Vercel)
    smoke-test.ts        # npm run smoke (13 cek)
  .env.example  .gitignore  README.md
```
