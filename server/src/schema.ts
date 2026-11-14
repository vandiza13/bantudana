// Skema database BantuDana.
//
// Lima tabel:
// - accounts: akun login. Role "admin" (Gibran, pemberi pinjaman) menyetujui
//   pinjaman dan mencatat pembayaran; role "user" (peminjam) mengajukan
//   pinjaman dan hanya melihat pinjamannya sendiri. Akun pertama yang dibuat
//   menjadi admin; akun berikutnya otomatis user.
// - sessions: token sesi login (acak, disimpan sebagai hash SHA-256).
// - loans: satu baris per pinjaman. Status persetujuan disimpan di sini;
//   status tampil (aktif/terlambat/lunas) dihitung dari pembayaran + tempo.
//   borrower_account_id menautkan pinjaman ke akun peminjam (NULL untuk
//   pinjaman lama / yang dibuat admin tanpa akun tertaut).
// - payments: satu baris per pembayaran untuk sebuah pinjaman. Pembayaran
//   yang dicatat langsung oleh admin berstatus "dikonfirmasi" dan langsung
//   mengurangi sisa tagihan. Pembayaran yang DIAJUKAN peminjam dari alur
//   "Bayar cicilan" berstatus "menunggu" dan TIDAK mengurangi sisa tagihan
//   sampai admin mengonfirmasinya ("dikonfirmasi") atau menolaknya
//   ("ditolak"). submitted_by_account_id menandai akun pengaju (NULL =
//   dicatat langsung oleh admin).
// - activity_log: jejak audit — setiap pembuatan, persetujuan, penolakan,
//   perubahan, dan pembayaran dicatat dengan waktu kejadiannya.
// - loan_settings: pengaturan pinjaman milik admin (satu baris, id=1):
//   bunga default %/bulan, bunga keterlambatan %/hari, tenor default &
//   batas tenor, batas pokok, dan pilihan cepat tenor/nominal yang
//   tampil di form pengajuan peminjam. Bunga/tenor/denda TIDAK diatur
//   dari form pinjaman — admin mengaturnya di menu Pengaturan, dan
//   admin sendiri tidak bisa mengajukan pinjaman.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(), // nomor HP ternormalisasi = ID login
  pinHash: text("pin_hash").notNull(), // format: saltHex:hashHex (PBKDF2)
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(), // SHA-256 dari token sesi
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const loans = sqliteTable("loans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  borrowerAccountId: integer("borrower_account_id").references(
    () => accounts.id,
  ),
  borrowerName: text("borrower_name").notNull(),
  phone: text("phone").notNull(),
  purpose: text("purpose").notNull(),
  principal: integer("principal").notNull(),
  feePercent: real("fee_percent").notNull().default(0),
  // Model tenor + bunga flat %/bulan (sejak 14 Nov 2026):
  // total bunga = pokok × bunga%/bulan × tenor; total tagihan = pokok +
  // total bunga; cicilan/bln = total tagihan / tenor (dibulatkan, cicilan
  // terakhir menyesuaikan sisa). Pinjaman lama bermigrasi sebagai tenor
  // 1 bulan dengan bunga = feePercent lama dan totalDue yang tidak berubah.
  tenorMonths: integer("tenor_months").notNull().default(1),
  interestPercent: real("interest_percent").notNull().default(0), // % per bulan
  monthlyPayment: integer("monthly_payment").notNull().default(0),
  totalInterest: integer("total_interest").notNull().default(0),
  startDate: text("start_date"), // YYYY-MM-DD; NULL = pinjaman lama
  totalDue: integer("total_due").notNull(),
  dueDate: text("due_date").notNull(), // YYYY-MM-DD — jatuh tempo akhir (cicilan terakhir)
  status: text("status", { enum: ["menunggu", "disetujui", "ditolak"] })
    .notNull()
    .default("menunggu"),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
});

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loanId: integer("loan_id")
    .notNull()
    .references(() => loans.id),
  amount: integer("amount").notNull(),
  method: text("method", {
    enum: ["tunai", "transfer", "ewallet", "lainnya"],
  })
    .notNull()
    .default("tunai"),
  note: text("note").notNull().default(""),
  // Alur bayar cicilan oleh peminjam: pengajuan mulai "menunggu" dan baru
  // mengurangi sisa tagihan setelah admin mengonfirmasi. Pembayaran lama
  // dan yang dicatat langsung admin bermigrasi sebagai "dikonfirmasi".
  status: text("status", {
    enum: ["menunggu", "dikonfirmasi", "ditolak"],
  })
    .notNull()
    .default("dikonfirmasi"),
  submittedByAccountId: integer("submitted_by_account_id").references(
    () => accounts.id,
  ),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  paidAt: integer("paid_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const loanSettings = sqliteTable("loan_settings", {
  id: integer("id").primaryKey(), // selalu 1 — satu baris pengaturan global
  defaultInterestPercent: real("default_interest_percent").notNull().default(2),
  // Bunga keterlambatan % per HARI (default 0,1%/hari), diatur admin di
  // menu Pengaturan — satu tempat dengan bunga normal. Denda dihitung
  // server dari sisa cicilan yang terlambat × rate × hari terlambat dan
  // berhenti bertambah pada tanggal cicilan itu lunas (terkonfirmasi).
  lateFeePercentPerDay: real("late_fee_percent_per_day").notNull().default(0.1),
  defaultTenorMonths: integer("default_tenor_months").notNull().default(3),
  minTenorMonths: integer("min_tenor_months").notNull().default(1),
  maxTenorMonths: integer("max_tenor_months").notNull().default(36),
  tenorOptions: text("tenor_options").notNull().default("[1,3,6,12]"), // JSON array bulan
  minPrincipal: integer("min_principal").notNull().default(50_000),
  maxPrincipal: integer("max_principal").notNull().default(100_000_000),
  nominalOptions: text("nominal_options")
    .notNull()
    .default("[500000,1000000,1500000,2000000,2500000,3000000,4000000,5000000]"), // JSON array rupiah
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loanId: integer("loan_id")
    .notNull()
    .references(() => loans.id),
  type: text("type", {
    enum: [
      "dibuat",
      "disetujui",
      "ditolak",
      "diubah",
      "pembayaran",
      "pembayaran_dihapus",
      "pembayaran_diajukan",
      "pembayaran_dikonfirmasi",
      "pembayaran_ditolak",
      "pembayaran_dibatalkan",
    ],
  }).notNull(),
  description: text("description").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
