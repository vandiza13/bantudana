// Actions BantuDana — pinjaman dana dengan pemberi pinjaman tunggal (admin).
//
// Model akses:
// - Login wajib. Akun pertama yang dibuat menjadi ADMIN (Gibran, pemberi
//   pinjaman); setiap akun yang dibuat sesudahnya menjadi USER (peminjam).
// - Admin melihat semua pinjaman, menyetujui/menolak pengajuan, mencatat
//   pembayaran, mengubah/menghapus data, membuka laporan, dan mengatur
//   semua ketentuan pinjaman dari menu Pengaturan.
// - Admin TIDAK bisa mengajukan/memiliki pinjaman: createLoan menolak
//   role admin di server. Admin hanya mengatur — yang meminjam adalah user.
// - User hanya melihat pinjaman miliknya sendiri, hanya bisa mengajukan
//   pinjaman baru atas namanya sendiri, dan hanya bisa mengubah/membatalkan
//   pengajuannya sendiri selama masih berstatus menunggu.
// - Bayar cicilan: peminjam mengajukan pembayaran dari halaman detail
//   pinjamannya (submitPayment) — pengajuan berstatus "menunggu" dan TIDAK
//   mengurangi sisa tagihan. Admin mengonfirmasi (confirmPayment → sisa
//   berkurang) atau menolak (rejectPayment) dari riwayat pembayaran.
//   Peminjam dapat membatalkan pengajuannya sendiri selama masih menunggu
//   (withdrawPayment). Admin tetap dapat mencatat pembayaran langsung
//   (recordPayment) yang langsung terkonfirmasi.
// - Bunga keterlambatan diatur admin di menu Pengaturan juga — satu
//   tempat dengan bunga normal: late_fee_percent_per_day (% per hari,
//   default 0,1%/hari). Denda dihitung server dari sisa cicilan yang
//   terlambat × rate × hari terlambat, ditambahkan di atas sisa tagihan
//   (totalOwed = remaining + lateFee), ditampilkan terpisah di detail
//   pinjaman & Beranda, dan berhenti bertambah pada tanggal cicilan
//   yang bersangkutan lunas lewat pembayaran terkonfirmasi. Denda
//   dihitung dari rate Pengaturan yang berlaku saat ini; mengubah rate
//   di Pengaturan mengubah denda yang masih berjalan.
// - Bunga & tenor diatur admin di menu Pengaturan (tabel loan_settings):
//   bunga default, tenor default, batas tenor, batas pokok, dan pilihan
//   cepat yang tampil di form peminjam. Form pinjaman TIDAK punya kolom
//   bunga (peminjam tidak bisa mengubah bunga), tapi bunga default dari
//   Pengaturan DITAMPILKAN TERBUKA di form peminjam dan pengajuan baru
//   menyimpannya sebagai bunga pinjaman — nilai bunga kiriman klien
//   selalu diabaikan. Bunga tersimpan tidak pernah berubah lewat
//   updateLoan; bunga final dapat disesuaikan admin saat menyetujui.
//   Batas pokok/tenor dari Pengaturan ditegakkan server pada
//   create/update/approve.
//
// Keamanan:
// - PIN tidak pernah disimpan mentah: PBKDF2-SHA256 (100rb iterasi, salt
//   acak per akun). Token sesi acak 32 byte; di database hanya disimpan
//   hash SHA-256-nya, dan sesi kedaluwarsa dalam 30 hari.
// - Login dibatasi: 5x PIN salah berturut-turut mengunci akun 15 menit.
// - Semua peran & kepemilikan dicek ulang di server pada SETIAP aksi;
//   token dari klien tidak pernah dipercaya begitu saja.
// - Uang selalu integer rupiah; total tagihan dihitung ulang di server.
// - Pembayaran tidak boleh melebihi sisa tagihan (dicek di server).
// - Setiap perubahan penting ditulis ke activity_log sebagai jejak audit.

import {
defineAction,
z,
type ActionsModule,
type Ctx,
} from "./space-shim.js";
import { asc, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema.js";

// ---------------------------------------------------------------------------
// Skema bersama
// ---------------------------------------------------------------------------

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
  .refine((v) => {
    const [y = 0, m = 0, d = 0] = v.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return (
      dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
    );
  }, "Tanggal tidak valid");

const phoneStr = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\+?\d{8,16}$/, "Nomor HP harus 8–16 digit angka"),
  );

const pinStr = z
  .string()
  .regex(/^\d{6}$/, "PIN harus tepat 6 digit angka");

const tokenStr = z.string().min(20).max(200);

// Batas keras absolut. Batas yang berlaku sehari-hari (pokok min/maks,
// tenor min/maks) datang dari Pengaturan admin dan dicek di handler.
const loanInput = z.object({
  borrowerName: z.string().trim().min(2, "Nama minimal 2 karakter").max(80),
  phone: phoneStr,
  purpose: z.string().trim().min(2, "Keperluan wajib diisi").max(120),
  principal: z
    .number()
    .int("Nominal harus bilangan bulat")
    .min(1, "Nominal wajib diisi")
    .max(1_000_000_000, "Nominal terlalu besar"),
  tenorMonths: z
    .number()
    .int("Tenor harus bilangan bulat (bulan)")
    .min(1, "Tenor minimal 1 bulan")
    .max(120, "Tenor terlalu panjang"),
  // Diterima demi kompatibilitas klien, tetapi TIDAK PERNAH dipakai:
  // bunga tidak diatur dari form pinjaman (lihat menu Pengaturan).
  interestPercent: z
    .number()
    .min(0, "Bunga tidak boleh negatif")
    .max(20, "Bunga maksimal 20% per bulan")
    .default(0),
  startDate: dateStr.optional(),
  note: z.string().trim().max(500).default(""),
});

const settingsView = z.object({
  defaultInterestPercent: z.number(), // bunga default % per bulan
  lateFeePercentPerDay: z.number(), // bunga keterlambatan % per hari
  defaultTenorMonths: z.number(), // tenor yang terpilih awal di form peminjam
  minTenorMonths: z.number(),
  maxTenorMonths: z.number(),
  tenorOptions: z.array(z.number()), // pilihan cepat tenor di form peminjam
  minPrincipal: z.number(),
  maxPrincipal: z.number(),
  nominalOptions: z.array(z.number()), // pilihan cepat nominal di form peminjam
});

type SettingsView = z.infer<typeof settingsView>;

/** Nilai bawaan — sama dengan default kolom tabel loan_settings. Dipakai
 *  selama admin belum pernah menyimpan pengaturan. */
const DEFAULT_SETTINGS: SettingsView = {
  defaultInterestPercent: 2,
  lateFeePercentPerDay: 0.1,
  defaultTenorMonths: 3,
  minTenorMonths: 1,
  maxTenorMonths: 36,
  tenorOptions: [1, 3, 6, 12],
  minPrincipal: 50_000,
  maxPrincipal: 100_000_000,
  nominalOptions: [
    500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000, 4_000_000,
    5_000_000,
  ],
};

const installmentView = z.object({
  index: z.number(), // cicilan ke- (1-based)
  dueDate: z.string(),
  amount: z.number(),
  paidAmount: z.number(),
  remainingAmount: z.number(),
  status: z.enum(["lunas", "terlambat", "berjalan", "menunggu"]),
  lateDays: z.number(), // hari terlambat cicilan ini (0 bila tepat waktu)
  lateFee: z.number(), // denda keterlambatan cicilan ini (rupiah)
});

type InstallmentView = z.infer<typeof installmentView>;

const loanView = z.object({
  id: z.number(),
  borrowerAccountId: z.number().nullable(),
  borrowerName: z.string(),
  phone: z.string(),
  purpose: z.string(),
  principal: z.number(),
  tenorMonths: z.number(),
  interestPercent: z.number(), // bunga flat % per bulan
  interestPerMonth: z.number(), // bunga dalam rupiah per bulan
  totalInterest: z.number(),
  monthlyPayment: z.number(), // cicilan per bulan (cicilan terakhir bisa beda)
  totalDue: z.number(),
  paidTotal: z.number(),
  remaining: z.number(),
  lateFeePercentPerDay: z.number(), // rate denda dari Pengaturan admin
  lateFee: z.number(), // total denda keterlambatan terhitung (rupiah)
  totalOwed: z.number(), // remaining + lateFee — total yang harus dibayar
  status: z.enum(["menunggu", "disetujui", "ditolak"]),
  displayStatus: z.enum(["menunggu", "aktif", "terlambat", "lunas", "ditolak"]),
  startDate: z.string(),
  dueDate: z.string(), // jatuh tempo akhir (cicilan terakhir)
  nextDueDate: z.string().nullable(), // jatuh tempo cicilan berikutnya
  nextInstallmentAmount: z.number(), // sisa cicilan berikutnya yang belum dibayar
  currentInstallment: z.number(), // cicilan ke- yang sedang berjalan (1-based)
  paidInstallments: z.number(),
  installments: z.array(installmentView),
  daysLate: z.number(),
  dueInDays: z.number(),
  note: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});

type LoanView = z.infer<typeof loanView>;
type LoanRow = typeof schema.loans.$inferSelect;
type AccountRow = typeof schema.accounts.$inferSelect;

const paymentView = z.object({
  id: z.number(),
  loanId: z.number(),
  amount: z.number(),
  method: z.enum(["tunai", "transfer", "ewallet", "lainnya"]),
  note: z.string(),
  // menunggu = diajukan peminjam, belum mengurangi sisa tagihan;
  // dikonfirmasi = sah & mengurangi sisa; ditolak = tidak berlaku.
  status: z.enum(["menunggu", "dikonfirmasi", "ditolak"]),
  submittedByAccountId: z.number().nullable(), // NULL = dicatat langsung admin
  paidAt: z.string(),
});

const pendingPaymentView = paymentView.extend({
  borrowerName: z.string(),
  purpose: z.string(),
});

const activityView = z.object({
  id: z.number(),
  type: z.string(),
  description: z.string(),
  createdAt: z.string(),
});

const accountView = z.object({
  id: z.number(),
  name: z.string(),
  phone: z.string(),
  role: z.enum(["admin", "user"]),
});

type AccountView = z.infer<typeof accountView>;

const authResponse = z.object({
  token: z.string(),
  account: accountView,
  adminExists: z.boolean(),
});

type AuthResponse = z.infer<typeof authResponse>;

const okResponse = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------------------
// Kripto: PIN (PBKDF2) & token sesi (SHA-256)
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function pbkdf2Hex(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hex(pin, salt, PBKDF2_ITERATIONS);
  return `${bytesToHex(salt)}:${hash}`;
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex = "", hashHex = ""] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const computed = await pbkdf2Hex(pin, hexToBytes(saltHex), PBKDF2_ITERATIONS);
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

function newSessionToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

// ---------------------------------------------------------------------------
// Sesi & peran
// ---------------------------------------------------------------------------

function toAccountView(a: AccountRow): AccountView {
  return { id: a.id, name: a.name, phone: a.phone, role: a.role };
}

async function createSession(
  ctx: Ctx,
  account: AccountRow,
): Promise<AuthResponse> {
  const db = ctx.db<typeof schema>();
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({
    tokenHash: await sha256Hex(token),
    accountId: account.id,
    expiresAt,
  });
  return { token, account: toAccountView(account), adminExists: true };
}

async function requireAccount(ctx: Ctx, token: string): Promise<AccountRow> {
  const db = ctx.db<typeof schema>();
  const tokenHash = await sha256Hex(token);
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .limit(1);
  const session = rows[0];
  if (!session) throw new Error("Sesi tidak ditemukan. Silakan masuk lagi.");
  if (session.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, tokenHash));
    throw new Error("Sesi sudah berakhir. Silakan masuk lagi.");
  }
  const accs = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, session.accountId))
    .limit(1);
  const account = accs[0];
  if (!account) throw new Error("Akun tidak ditemukan. Silakan masuk lagi.");
  return account;
}

function requireAdmin(account: AccountRow): void {
  if (account.role !== "admin")
    throw new Error("Aksi ini hanya untuk admin (pemberi pinjaman).");
}

function parseIntList(json: string, fallback: number[]): number[] {
  try {
    const v: unknown = JSON.parse(json);
    if (Array.isArray(v)) {
      const nums = v.filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n),
      );
      if (nums.length > 0) return nums;
    }
  } catch {
    // JSON rusak → pakai bawaan.
  }
  return fallback;
}

/** Pengaturan pinjaman efektif: baris tersimpan, atau bawaan bila belum ada. */
async function loadSettings(ctx: Ctx): Promise<SettingsView> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.loanSettings)
    .where(eq(schema.loanSettings.id, 1))
    .limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_SETTINGS;
  return {
    defaultInterestPercent: row.defaultInterestPercent,
    lateFeePercentPerDay: row.lateFeePercentPerDay,
    defaultTenorMonths: row.defaultTenorMonths,
    minTenorMonths: row.minTenorMonths,
    maxTenorMonths: row.maxTenorMonths,
    tenorOptions: parseIntList(row.tenorOptions, DEFAULT_SETTINGS.tenorOptions),
    minPrincipal: row.minPrincipal,
    maxPrincipal: row.maxPrincipal,
    nominalOptions: parseIntList(
      row.nominalOptions,
      DEFAULT_SETTINGS.nominalOptions,
    ),
  };
}

function rpFmt(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

/** Tegakkan batas pokok & tenor dari Pengaturan admin. */
function assertWithinSettings(
  s: SettingsView,
  principal: number,
  tenorMonths: number,
): void {
  if (principal < s.minPrincipal || principal > s.maxPrincipal)
    throw new Error(
      `Nominal pinjaman harus antara ${rpFmt(s.minPrincipal)} dan ${rpFmt(s.maxPrincipal)} (diatur admin di Pengaturan).`,
    );
  if (tenorMonths < s.minTenorMonths || tenorMonths > s.maxTenorMonths)
    throw new Error(
      `Tenor harus antara ${s.minTenorMonths} dan ${s.maxTenorMonths} bulan (diatur admin di Pengaturan).`,
    );
}

/** Pinjaman yang boleh dilihat akun ini: admin = semua, user = miliknya. */
function visibleTo(account: AccountRow, loan: LoanRow): boolean {
  return account.role === "admin" || loan.borrowerAccountId === account.id;
}

// ---------------------------------------------------------------------------
// Helper pinjaman
// ---------------------------------------------------------------------------

function parseDateOnly(v: string): Date {
  const [y = 1970, m = 1, d = 1] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function diffDays(from: string, to: string): number {
  const ms = parseDateOnly(to).getTime() - parseDateOnly(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Tambah N bulan ke tanggal YYYY-MM-DD (hari diklem ke akhir bulan tujuan). */
export function addMonths(dateStr: string, months: number): string {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Hitungan pinjaman flat %/bulan — satu-satunya sumber kebenaran, dipakai
 * create/update/approve supaya klien tidak bisa memanipulasi total.
 * total bunga = pokok × bunga%/bulan × tenor
 * total tagihan = pokok + total bunga
 * cicilan/bln = total tagihan / tenor dibulatkan; cicilan terakhir
 * menyesuaikan sisa supaya jumlah jadwal persis total tagihan.
 */
function computeTerms(
  principal: number,
  interestPercent: number,
  tenorMonths: number,
): { totalInterest: number; totalDue: number; monthlyPayment: number } {
  const totalInterest = Math.round(
    (principal * interestPercent * tenorMonths) / 100,
  );
  const totalDue = principal + totalInterest;
  const monthlyPayment =
    tenorMonths > 1 ? Math.round(totalDue / tenorMonths) : totalDue;
  return { totalInterest, totalDue, monthlyPayment };
}

/** Jadwal cicilan: nominal per cicilan (terakhir menyesuaikan) + tempo per bulan. */
function buildSchedule(
  loan: LoanRow,
  startDate: string,
): { dueDate: string; amount: number }[] {
  const tenor = Math.max(1, loan.tenorMonths);
  const out: { dueDate: string; amount: number }[] = [];
  let allocated = 0;
  for (let i = 1; i <= tenor; i++) {
    const amount =
      i < tenor ? loan.monthlyPayment : loan.totalDue - allocated;
    allocated += amount;
    out.push({ dueDate: addMonths(startDate, i), amount });
  }
  return out;
}

/** Satu pembayaran terkonfirmasi, untuk alokasi cicilan & denda. */
type ConfirmedPayment = { amount: number; paidDate: string };

/**
 * Denda keterlambatan satu cicilan (rupiah):
 * basis × rate%/hari × hari terlambat, dibulatkan ke rupiah terdekat.
 * Contoh: cicilan Rp466.667 terlambat 10 hari pada 0,1%/hari →
 * 466.667 × 0,1% × 10 = Rp4.667.
 */
function lateFeeFor(
  base: number,
  lateDays: number,
  ratePercentPerDay: number,
): number {
  if (base <= 0 || lateDays <= 0 || ratePercentPerDay <= 0) return 0;
  return Math.round((base * ratePercentPerDay * lateDays) / 100);
}

function toView(
  loan: LoanRow,
  confirmed: ConfirmedPayment[],
  today: string,
  lateRate: number,
): LoanView {
  const paidTotal = confirmed.reduce((s, p) => s + p.amount, 0);
  const startDate = loan.startDate ?? loan.createdAt.toISOString().slice(0, 10);
  // Pinjaman lama (startDate NULL, tenor 1): tempo tetap tanggal dueDate
  // aslinya — jangan digeser oleh hitungan jadwal baru.
  const schedule = loan.startDate
    ? buildSchedule(loan, startDate)
    : [{ dueDate: loan.dueDate, amount: loan.totalDue }];
  // Pembayaran terkonfirmasi dialokasikan berurutan ke cicilan paling
  // awal (urut tanggal bayar). Tanggal cicilan menjadi lunas = tanggal
  // pembayaran yang menuntaskannya — denda berhenti bertambah di situ.
  const queue = confirmed.map((p) => ({ ...p }));
  let qi = 0;
  const installments: InstallmentView[] = schedule.map((s, i) => {
    let paidAmount = 0;
    let paidOffDate: string | null = null;
    while (paidAmount < s.amount && qi < queue.length) {
      const pay = queue[qi];
      if (!pay) break;
      const take = Math.min(pay.amount, s.amount - paidAmount);
      pay.amount -= take;
      paidAmount += take;
      if (paidAmount >= s.amount) paidOffDate = pay.paidDate;
      if (pay.amount <= 0) qi++;
    }
    const remainingAmount = s.amount - paidAmount;
    let status: InstallmentView["status"];
    if (remainingAmount <= 0) status = "lunas";
    else if (loan.status !== "disetujui") status = "menunggu";
    else if (diffDays(today, s.dueDate) < 0) status = "terlambat";
    else status = "berjalan";
    // Denda hanya untuk pinjaman yang disetujui. Cicilan lunas: basis
    // nominal penuh, hari dihitung sampai tanggal lunasnya. Cicilan
    // belum lunas: basis sisa yang belum dibayar, hari sampai hari ini.
    let lateDays = 0;
    let lateFee = 0;
    if (loan.status === "disetujui") {
      if (paidOffDate) {
        lateDays = Math.max(0, diffDays(s.dueDate, paidOffDate));
        lateFee = lateFeeFor(s.amount, lateDays, lateRate);
      } else if (remainingAmount > 0) {
        lateDays = Math.max(0, diffDays(s.dueDate, today));
        lateFee = lateFeeFor(remainingAmount, lateDays, lateRate);
      }
    }
    return {
      index: i + 1,
      dueDate: s.dueDate,
      amount: s.amount,
      paidAmount,
      remainingAmount,
      status,
      lateDays,
      lateFee,
    };
  });
  const remaining = Math.max(0, loan.totalDue - paidTotal);
  const lateFee = installments.reduce((s, i) => s + i.lateFee, 0);
  const next = installments.find((i) => i.remainingAmount > 0) ?? null;
  const dueDate = schedule[schedule.length - 1]?.dueDate ?? loan.dueDate;
  // Keterlambatan & tempo terdekat dihitung dari cicilan berikutnya yang
  // belum lunas — bukan dari jatuh tempo akhir.
  const dueInDays = next ? diffDays(today, next.dueDate) : 0;
  let displayStatus: LoanView["displayStatus"];
  if (loan.status === "menunggu") displayStatus = "menunggu";
  else if (loan.status === "ditolak") displayStatus = "ditolak";
  else if (remaining <= 0) displayStatus = "lunas";
  else if (next && dueInDays < 0) displayStatus = "terlambat";
  else displayStatus = "aktif";
  return {
    id: loan.id,
    borrowerAccountId: loan.borrowerAccountId,
    borrowerName: loan.borrowerName,
    phone: loan.phone,
    purpose: loan.purpose,
    principal: loan.principal,
    tenorMonths: loan.tenorMonths,
    interestPercent: loan.interestPercent,
    interestPerMonth: Math.round((loan.principal * loan.interestPercent) / 100),
    totalInterest: loan.totalInterest,
    monthlyPayment: loan.monthlyPayment,
    totalDue: loan.totalDue,
    paidTotal,
    remaining,
    lateFeePercentPerDay: lateRate,
    lateFee,
    totalOwed: remaining + lateFee,
    status: loan.status,
    displayStatus,
    startDate,
    dueDate,
    nextDueDate: next ? next.dueDate : null,
    nextInstallmentAmount: next ? next.remainingAmount : 0,
    currentInstallment: next ? next.index : loan.tenorMonths,
    paidInstallments: installments.filter((i) => i.status === "lunas").length,
    installments,
    daysLate: displayStatus === "terlambat" ? -dueInDays : 0,
    dueInDays,
    note: loan.note,
    createdAt: loan.createdAt.toISOString(),
    decidedAt: loan.decidedAt ? loan.decidedAt.toISOString() : null,
  };
}

/** Total terbayar per pinjaman — HANYA pembayaran terkonfirmasi yang
 *  mengurangi sisa tagihan. Pengajuan pembayaran yang masih menunggu
 *  konfirmasi admin tidak dihitung sama sekali. */
async function paidTotalsByLoan(ctx: Ctx): Promise<Map<number, number>> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select({ loanId: schema.payments.loanId, amount: schema.payments.amount })
    .from(schema.payments)
    .where(eq(schema.payments.status, "dikonfirmasi"));
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.loanId, (map.get(r.loanId) ?? 0) + r.amount);
  return map;
}

/** Pembayaran terkonfirmasi per pinjaman, urut tanggal bayar — dipakai
 *  mengalokasikan pembayaran ke cicilan dan menghitung denda
 *  keterlambatan (denda berhenti pada tanggal cicilan lunas). */
async function confirmedPaymentsByLoan(
  ctx: Ctx,
): Promise<Map<number, ConfirmedPayment[]>> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select({
      loanId: schema.payments.loanId,
      amount: schema.payments.amount,
      paidAt: schema.payments.paidAt,
      id: schema.payments.id,
    })
    .from(schema.payments)
    .where(eq(schema.payments.status, "dikonfirmasi"))
    .orderBy(asc(schema.payments.paidAt), asc(schema.payments.id));
  const map = new Map<number, ConfirmedPayment[]>();
  for (const r of rows) {
    const list = map.get(r.loanId) ?? [];
    list.push({
      amount: r.amount,
      paidDate: r.paidAt.toISOString().slice(0, 10),
    });
    map.set(r.loanId, list);
  }
  return map;
}

/** Total pengajuan pembayaran yang masih menunggu konfirmasi, per pinjaman. */
async function pendingTotalsByLoan(ctx: Ctx): Promise<Map<number, number>> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select({ loanId: schema.payments.loanId, amount: schema.payments.amount })
    .from(schema.payments)
    .where(eq(schema.payments.status, "menunggu"));
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.loanId, (map.get(r.loanId) ?? 0) + r.amount);
  return map;
}

async function loadLoanRow(ctx: Ctx, loanId: number): Promise<LoanRow> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.loans)
    .where(eq(schema.loans.id, loanId))
    .limit(1);
  const loan = rows[0];
  if (!loan) throw new Error("Pinjaman tidak ditemukan.");
  return loan;
}

async function loadView(
  ctx: Ctx,
  loanId: number,
  today: string,
): Promise<LoanView> {
  const loan = await loadLoanRow(ctx, loanId);
  const confirmed = await confirmedPaymentsByLoan(ctx);
  const settings = await loadSettings(ctx);
  return toView(
    loan,
    confirmed.get(loan.id) ?? [],
    today,
    settings.lateFeePercentPerDay,
  );
}

/** Cari akun peminjam dari nomor HP (untuk pinjaman yang dibuat admin). */
async function findAccountByPhone(
  ctx: Ctx,
  phone: string,
): Promise<AccountRow | null> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.phone, phone))
    .limit(1);
  return rows[0] ?? null;
}

function sortViews(views: LoanView[]): LoanView[] {
  const rank: Record<LoanView["displayStatus"], number> = {
    menunggu: 0,
    terlambat: 1,
    aktif: 2,
    lunas: 3,
    ditolak: 4,
  };
  return [...views].sort((a, b) => {
    const r = rank[a.displayStatus] - rank[b.displayStatus];
    if (r !== 0) return r;
    if (a.displayStatus === "menunggu")
      return b.createdAt.localeCompare(a.createdAt);
    if (a.displayStatus === "terlambat") return b.daysLate - a.daysLate;
    if (a.displayStatus === "aktif")
      return (a.nextDueDate ?? a.dueDate).localeCompare(b.nextDueDate ?? b.dueDate);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

type AppDb = ReturnType<Ctx["db"]>;

async function runBatch(
  db: AppDb,
  stmts: BatchItem<"sqlite">[],
): Promise<void> {
  const [first, ...rest] = stmts;
  if (first) await db.batch([first, ...rest]);
}

// ---------------------------------------------------------------------------
// Actions — autentikasi
// ---------------------------------------------------------------------------

export const Actions = {
  getAuthStatus: defineAction({
    description:
      "Status awal aplikasi: apakah akun admin sudah ada. Dipakai layar masuk untuk membedakan pendaftaran admin pertama dari pendaftaran peminjam.",
    request: z.object({}),
    response: z.object({ adminExists: z.boolean(), accountCount: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({ id: schema.accounts.id, role: schema.accounts.role })
        .from(schema.accounts);
      return {
        adminExists: rows.some((r) => r.role === "admin"),
        accountCount: rows.length,
      };
    },
  }),

  register: defineAction({
    description:
      "Membuat akun baru dan langsung masuk. Akun pertama menjadi admin (pemberi pinjaman); akun berikutnya menjadi user (peminjam).",
    request: z.object({
      name: z.string().trim().min(2, "Nama minimal 2 karakter").max(80),
      phone: phoneStr,
      pin: pinStr,
    }),
    response: authResponse,
    async handler(ctx, args): Promise<AuthResponse> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.phone, args.phone))
        .limit(1);
      if (existing[0])
        throw new Error(
          "Nomor HP ini sudah terdaftar. Silakan masuk dengan PIN Anda.",
        );
      const all = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .limit(1);
      const role = all.length === 0 ? "admin" : "user";
      const inserted = await db
        .insert(schema.accounts)
        .values({
          name: args.name,
          phone: args.phone,
          pinHash: await hashPin(args.pin),
          role,
        })
        .returning();
      const account = inserted[0];
      if (!account) throw new Error("Gagal membuat akun.");
      // Pinjaman lama yang nomornya cocok dengan akun peminjam baru
      // langsung tertaut, supaya muncul di beranda peminjam.
      if (role === "user") {
        await db
          .update(schema.loans)
          .set({ borrowerAccountId: account.id })
          .where(eq(schema.loans.phone, args.phone));
      }
      ctx.invalidateQueries();
      return createSession(ctx, account);
    },
  }),

  login: defineAction({
    description:
      "Masuk dengan nomor HP dan PIN 6 digit. Mengembalikan token sesi dan data akun (termasuk peran admin/user).",
    request: z.object({ phone: phoneStr, pin: pinStr }),
    response: authResponse,
    async handler(ctx, args): Promise<AuthResponse> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.phone, args.phone))
        .limit(1);
      const account = rows[0];
      if (!account)
        throw new Error("Nomor HP atau PIN salah. Periksa kembali.");
      if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
        const mins = Math.max(
          1,
          Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60_000),
        );
        throw new Error(
          `Akun terkunci sementara karena terlalu banyak PIN salah. Coba lagi dalam ${mins} menit.`,
        );
      }
      const valid = await verifyPin(args.pin, account.pinHash);
      if (!valid) {
        const attempts = account.failedAttempts + 1;
        const lockedUntil =
          attempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : null;
        await db
          .update(schema.accounts)
          .set({
            failedAttempts: lockedUntil ? 0 : attempts,
            lockedUntil,
          })
          .where(eq(schema.accounts.id, account.id));
        throw new Error(
          lockedUntil
            ? `PIN salah ${MAX_FAILED_ATTEMPTS}x — akun dikunci ${LOCK_MINUTES} menit demi keamanan.`
            : "Nomor HP atau PIN salah. Periksa kembali.",
        );
      }
      if (account.failedAttempts !== 0 || account.lockedUntil) {
        await db
          .update(schema.accounts)
          .set({ failedAttempts: 0, lockedUntil: null })
          .where(eq(schema.accounts.id, account.id));
      }
      return createSession(ctx, account);
    },
  }),

  logout: defineAction({
    description: "Keluar: menghapus sesi yang sedang aktif.",
    request: z.object({ token: tokenStr }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.tokenHash, await sha256Hex(args.token)));
      return { ok: true as const };
    },
  }),

  getSession: defineAction({
    description:
      "Memeriksa token sesi dan mengembalikan akun yang sedang masuk (nama, nomor HP, peran).",
    request: z.object({ token: tokenStr }),
    response: z.object({ account: accountView }),
    async handler(ctx, args) {
      const account = await requireAccount(ctx, args.token);
      return { account: toAccountView(account) };
    },
  }),

  changePin: defineAction({
    description: "Mengganti PIN akun yang sedang masuk (PIN lama wajib benar).",
    request: z.object({
      token: tokenStr,
      oldPin: pinStr,
      newPin: pinStr,
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const account = await requireAccount(ctx, args.token);
      if (!(await verifyPin(args.oldPin, account.pinHash)))
        throw new Error("PIN lama salah.");
      if (args.newPin === args.oldPin)
        throw new Error("PIN baru harus berbeda dari PIN lama.");
      await db
        .update(schema.accounts)
        .set({ pinHash: await hashPin(args.newPin) })
        .where(eq(schema.accounts.id, account.id));
      return { ok: true as const };
    },
  }),

  listBorrowers: defineAction({
    description:
      "Admin: daftar akun peminjam (role user) yang terdaftar, ditampilkan di menu Akun admin.",
    request: z.object({ token: tokenStr }),
    response: z.object({ borrowers: z.array(accountView) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const rows = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.role, "user"))
        .orderBy(asc(schema.accounts.name));
      return { borrowers: rows.map(toAccountView) };
    },
  }),

  // -------------------------------------------------------------------------
  // Actions — pengaturan pinjaman (khusus admin yang mengubah)
  // -------------------------------------------------------------------------

  getSettings: defineAction({
    description:
      "Pengaturan pinjaman yang berlaku (bunga default, bunga keterlambatan %/hari, tenor default & batasnya, batas pokok, pilihan cepat form). Dipakai form pengajuan peminjam dan menu Pengaturan admin.",
    request: z.object({ token: tokenStr }),
    response: z.object({ settings: settingsView }),
    async handler(ctx, args) {
      await requireAccount(ctx, args.token);
      return { settings: await loadSettings(ctx) };
    },
  }),

  updateSettings: defineAction({
    description:
      "Admin: menyimpan pengaturan pinjaman dari menu Pengaturan — bunga default %/bulan, bunga keterlambatan %/hari, tenor default, batas tenor, batas pokok, dan pilihan cepat tenor/nominal untuk form peminjam. Hanya admin; bunga, denda & tenor tidak diatur dari form pinjaman.",
    request: z.object({
      token: tokenStr,
      defaultInterestPercent: z
        .number()
        .min(0, "Bunga default tidak boleh negatif")
        .max(20, "Bunga default maksimal 20% per bulan"),
      lateFeePercentPerDay: z
        .number()
        .min(0, "Bunga keterlambatan tidak boleh negatif")
        .max(5, "Bunga keterlambatan maksimal 5% per hari"),
      defaultTenorMonths: z.number().int().min(1).max(36),
      minTenorMonths: z.number().int().min(1).max(36),
      maxTenorMonths: z.number().int().min(1).max(36),
      tenorOptions: z.array(z.number().int().min(1).max(36)).min(1).max(12),
      minPrincipal: z
        .number()
        .int()
        .min(10_000, "Pokok minimal paling kecil Rp10.000")
        .max(100_000_000),
      maxPrincipal: z
        .number()
        .int()
        .min(10_000)
        .max(100_000_000, "Pokok maksimal paling besar Rp100.000.000"),
      nominalOptions: z
        .array(z.number().int().min(10_000).max(100_000_000))
        .min(1)
        .max(12),
    }),
    response: z.object({ settings: settingsView }),
    async handler(ctx, args): Promise<{ settings: SettingsView }> {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      if (args.minTenorMonths > args.maxTenorMonths)
        throw new Error("Tenor minimum tidak boleh lebih besar dari tenor maksimum.");
      if (
        args.defaultTenorMonths < args.minTenorMonths ||
        args.defaultTenorMonths > args.maxTenorMonths
      )
        throw new Error("Tenor default harus berada di antara tenor minimum dan maksimum.");
      if (args.minPrincipal >= args.maxPrincipal)
        throw new Error("Pokok minimum harus lebih kecil dari pokok maksimum.");
      const tenorOptions = [...new Set(args.tenorOptions)]
        .filter(
          (t) => t >= args.minTenorMonths && t <= args.maxTenorMonths,
        )
        .sort((a, b) => a - b);
      if (tenorOptions.length === 0)
        throw new Error(
          "Pilihan tenor cepat harus berada di antara tenor minimum dan maksimum.",
        );
      const nominalOptions = [...new Set(args.nominalOptions)]
        .filter((n) => n >= args.minPrincipal && n <= args.maxPrincipal)
        .sort((a, b) => a - b);
      if (nominalOptions.length === 0)
        throw new Error(
          "Pilihan nominal cepat harus berada di antara pokok minimum dan maksimum.",
        );
      const settings: SettingsView = {
        defaultInterestPercent:
          Math.round(args.defaultInterestPercent * 100) / 100,
        lateFeePercentPerDay:
          Math.round(args.lateFeePercentPerDay * 1000) / 1000,
        defaultTenorMonths: args.defaultTenorMonths,
        minTenorMonths: args.minTenorMonths,
        maxTenorMonths: args.maxTenorMonths,
        tenorOptions,
        minPrincipal: args.minPrincipal,
        maxPrincipal: args.maxPrincipal,
        nominalOptions,
      };
      await db
        .insert(schema.loanSettings)
        .values({
          id: 1,
          defaultInterestPercent: settings.defaultInterestPercent,
          lateFeePercentPerDay: settings.lateFeePercentPerDay,
          defaultTenorMonths: settings.defaultTenorMonths,
          minTenorMonths: settings.minTenorMonths,
          maxTenorMonths: settings.maxTenorMonths,
          tenorOptions: JSON.stringify(settings.tenorOptions),
          minPrincipal: settings.minPrincipal,
          maxPrincipal: settings.maxPrincipal,
          nominalOptions: JSON.stringify(settings.nominalOptions),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.loanSettings.id,
          set: {
            defaultInterestPercent: settings.defaultInterestPercent,
            lateFeePercentPerDay: settings.lateFeePercentPerDay,
            defaultTenorMonths: settings.defaultTenorMonths,
            minTenorMonths: settings.minTenorMonths,
            maxTenorMonths: settings.maxTenorMonths,
            tenorOptions: JSON.stringify(settings.tenorOptions),
            minPrincipal: settings.minPrincipal,
            maxPrincipal: settings.maxPrincipal,
            nominalOptions: JSON.stringify(settings.nominalOptions),
            updatedAt: new Date(),
          },
        });
      ctx.invalidateQueries();
      return { settings };
    },
  }),

  // -------------------------------------------------------------------------
  // Actions — pinjaman
  // -------------------------------------------------------------------------

  getDashboard: defineAction({
    description:
      "Ringkasan beranda sesuai peran: admin melihat semua pinjaman; user hanya miliknya. Termasuk statistik, daftar menunggu persetujuan, dan jatuh tempo terdekat.",
    request: z.object({ token: tokenStr, today: dateStr }),
    response: z.object({
      stats: z.object({
        activeCount: z.number(),
        totalOutstanding: z.number(), // sisa tagihan + denda keterlambatan
        lateFeeTotal: z.number(), // porsi denda dari totalOutstanding
        pendingCount: z.number(),
        overdueCount: z.number(),
        overdueAmount: z.number(), // sisa + denda pinjaman terlambat
        totalLent: z.number(),
        totalCollected: z.number(),
        paidOffCount: z.number(),
      }),
      pending: z.array(loanView),
      upcoming: z.array(loanView),
      pendingPayments: z.array(pendingPaymentView),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      const loans = (await db.select().from(schema.loans)).filter((l) =>
        visibleTo(me, l),
      );
      const visibleLoanIds = new Set(loans.map((l) => l.id));
      const loanById = new Map(loans.map((l) => [l.id, l]));
      const pendingPayRows = (
        await db
          .select()
          .from(schema.payments)
          .where(eq(schema.payments.status, "menunggu"))
          .orderBy(desc(schema.payments.createdAt))
      ).filter((p) => visibleLoanIds.has(p.loanId));
      const pendingPayments = pendingPayRows.map((p) => {
        const l = loanById.get(p.loanId);
        return {
          id: p.id,
          loanId: p.loanId,
          amount: p.amount,
          method: p.method,
          note: p.note,
          status: p.status,
          submittedByAccountId: p.submittedByAccountId,
          paidAt: p.paidAt.toISOString(),
          borrowerName: l?.borrowerName ?? "",
          purpose: l?.purpose ?? "",
        };
      });
      const confirmed = await confirmedPaymentsByLoan(ctx);
      const settings = await loadSettings(ctx);
      const views = loans.map((l) =>
        toView(
          l,
          confirmed.get(l.id) ?? [],
          args.today,
          settings.lateFeePercentPerDay,
        ),
      );
      const active = views.filter(
        (v) => v.displayStatus === "aktif" || v.displayStatus === "terlambat",
      );
      const overdue = views.filter((v) => v.displayStatus === "terlambat");
      const upcoming = [...active].sort((a, b) =>
        (a.nextDueDate ?? a.dueDate).localeCompare(b.nextDueDate ?? b.dueDate),
      );
      return {
        stats: {
          activeCount: active.length,
          totalOutstanding: active.reduce((s, v) => s + v.totalOwed, 0),
          lateFeeTotal: views.reduce((s, v) => s + v.lateFee, 0),
          pendingCount: views.filter((v) => v.status === "menunggu").length,
          overdueCount: overdue.length,
          overdueAmount: overdue.reduce((s, v) => s + v.totalOwed, 0),
          totalLent: views
            .filter((v) => v.status === "disetujui")
            .reduce((s, v) => s + v.principal, 0),
          totalCollected: views.reduce((s, v) => s + v.paidTotal, 0),
          paidOffCount: views.filter((v) => v.displayStatus === "lunas")
            .length,
        },
        pending: sortViews(views.filter((v) => v.status === "menunggu")),
        upcoming,
        pendingPayments,
      };
    },
  }),

  listLoans: defineAction({
    description:
      "Daftar pinjaman sesuai peran (admin: semua; user: miliknya) dengan status tampil, sisa tagihan, dan keterlambatan terhitung.",
    request: z.object({
      token: tokenStr,
      today: dateStr,
      filter: z
        .enum(["semua", "menunggu", "aktif", "terlambat", "lunas", "ditolak"])
        .default("semua"),
      search: z.string().trim().max(80).default(""),
    }),
    response: z.object({ loans: z.array(loanView) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      const loans = await db
        .select()
        .from(schema.loans)
        .orderBy(desc(schema.loans.createdAt));
      const confirmed = await confirmedPaymentsByLoan(ctx);
      const settings = await loadSettings(ctx);
      let views = loans
        .filter((l) => visibleTo(me, l))
        .map((l) =>
          toView(
            l,
            confirmed.get(l.id) ?? [],
            args.today,
            settings.lateFeePercentPerDay,
          ),
        );
      if (args.filter !== "semua") {
        views = views.filter((v) => v.displayStatus === args.filter);
      }
      if (args.search) {
        const q = args.search.toLowerCase();
        views = views.filter(
          (v) =>
            v.borrowerName.toLowerCase().includes(q) ||
            v.purpose.toLowerCase().includes(q) ||
            v.phone.includes(q),
        );
      }
      return { loans: sortViews(views) };
    },
  }),

  getLoan: defineAction({
    description:
      "Detail satu pinjaman (data lengkap, riwayat pembayaran, jejak aktivitas). User hanya bisa membuka pinjamannya sendiri.",
    request: z.object({
      token: tokenStr,
      id: z.number().int().positive(),
      today: dateStr,
    }),
    response: z.object({
      loan: loanView,
      payments: z.array(paymentView),
      activity: z.array(activityView),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      const row = await loadLoanRow(ctx, args.id);
      if (!visibleTo(me, row))
        throw new Error("Pinjaman ini bukan milik Anda.");
      const confirmed = await confirmedPaymentsByLoan(ctx);
      const settings = await loadSettings(ctx);
      const loan = toView(
        row,
        confirmed.get(row.id) ?? [],
        args.today,
        settings.lateFeePercentPerDay,
      );
      const pays = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.loanId, args.id))
        .orderBy(desc(schema.payments.paidAt));
      const acts = await db
        .select()
        .from(schema.activityLog)
        .where(eq(schema.activityLog.loanId, args.id))
        .orderBy(desc(schema.activityLog.createdAt));
      return {
        loan,
        payments: pays.map((p) => ({
          id: p.id,
          loanId: p.loanId,
          amount: p.amount,
          method: p.method,
          note: p.note,
          status: p.status,
          submittedByAccountId: p.submittedByAccountId,
          paidAt: p.paidAt.toISOString(),
        })),
        activity: acts.map((a) => ({
          id: a.id,
          type: a.type,
          description: a.description,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },
  }),

  createLoan: defineAction({
    description:
      "Membuat pengajuan pinjaman baru berstatus menunggu persetujuan admin. HANYA untuk peminjam (user): admin ditolak di server karena admin hanya mengatur (menu Pengaturan, persetujuan, pembayaran), bukan meminjam. Nama & nomor diambil dari akun peminjam; bunga yang disimpan adalah bunga default dari Pengaturan admin (tampil terbuka di form peminjam) — nilai bunga kiriman klien selalu diabaikan, dan admin masih dapat menyesuaikan bunga final saat menyetujui. Pokok & tenor ditegakkan dalam batas Pengaturan admin.",
    request: loanInput.extend({ token: tokenStr }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      if (me.role === "admin")
        throw new Error(
          "Admin tidak mengajukan pinjaman. Pinjaman diajukan oleh peminjam — admin mengatur ketentuannya di menu Pengaturan dan menyetujui pengajuan yang masuk.",
        );
      const settings = await loadSettings(ctx);
      assertWithinSettings(settings, args.principal, args.tenorMonths);
      const borrowerName = me.name;
      const phone = me.phone;
      // Bunga pengajuan = bunga default Pengaturan admin, tampil terbuka
      // di form peminjam. Nilai kiriman klien tidak pernah dipakai.
      const interestPercent = settings.defaultInterestPercent;
      const startDate = args.startDate ?? todayStr();
      const terms = computeTerms(args.principal, interestPercent, args.tenorMonths);
      const dueDate = addMonths(startDate, args.tenorMonths);
      const inserted = await db
        .insert(schema.loans)
        .values({
          borrowerAccountId: me.id,
          borrowerName,
          phone,
          purpose: args.purpose,
          principal: args.principal,
          feePercent: 0,
          tenorMonths: args.tenorMonths,
          interestPercent,
          monthlyPayment: terms.monthlyPayment,
          totalInterest: terms.totalInterest,
          startDate,
          totalDue: terms.totalDue,
          dueDate,
          note: args.note,
          status: "menunggu",
        })
        .returning({ id: schema.loans.id });
      const row = inserted[0];
      if (!row) throw new Error("Gagal menyimpan pinjaman.");
      await db.insert(schema.activityLog).values({
        loanId: row.id,
        type: "dibuat",
        description: `Pinjaman diajukan oleh ${borrowerName}: ${args.purpose} — pokok Rp${args.principal.toLocaleString("id-ID")}, tenor ${args.tenorMonths} bulan, bunga ${interestPercent}%/bulan mengikuti bunga default Pengaturan admin (dapat disesuaikan admin saat persetujuan), total tagihan Rp${terms.totalDue.toLocaleString("id-ID")}, jatuh tempo akhir sementara ${dueDate}.`,
      });
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  approveLoan: defineAction({
    description:
      "Admin: menyetujui pinjaman yang masih menunggu. Di sinilah bunga final pinjaman ditetapkan — hanya oleh admin, terisi otomatis dari bunga default di Pengaturan dan dapat disesuaikan per pinjaman saat persetujuan; tenor final juga dapat disesuaikan dalam batas Pengaturan. Total tagihan & cicilan dihitung ulang di server sebelum pinjaman aktif.",
    request: z.object({
      token: tokenStr,
      id: z.number().int().positive(),
      tenorMonths: z.number().int().min(1).max(36).optional(),
      interestPercent: z.number().min(0).max(20).optional(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const loan = await loadLoanRow(ctx, args.id);
      if (loan.status !== "menunggu")
        throw new Error("Pinjaman ini sudah diputuskan sebelumnya.");
      const settings = await loadSettings(ctx);
      const tenorMonths = args.tenorMonths ?? loan.tenorMonths;
      if (
        tenorMonths < settings.minTenorMonths ||
        tenorMonths > settings.maxTenorMonths
      )
        throw new Error(
          `Tenor final harus antara ${settings.minTenorMonths} dan ${settings.maxTenorMonths} bulan (diatur admin di Pengaturan).`,
        );
      const interestPercent =
        args.interestPercent != null
          ? Math.round(args.interestPercent * 100) / 100
          : loan.interestPercent;
      const terms = computeTerms(loan.principal, interestPercent, tenorMonths);
      // Pinjaman lama (startDate NULL): tempo asli dipertahankan apa adanya.
      const startDate = loan.startDate;
      const dueDate = startDate
        ? addMonths(startDate, tenorMonths)
        : loan.dueDate;
      const changed =
        tenorMonths !== loan.tenorMonths ||
        interestPercent !== loan.interestPercent;
      await runBatch(db, [
        db
          .update(schema.loans)
          .set({
            status: "disetujui",
            decidedAt: new Date(),
            tenorMonths,
            interestPercent,
            monthlyPayment: terms.monthlyPayment,
            totalInterest: terms.totalInterest,
            totalDue: terms.totalDue,
            startDate,
            dueDate,
          })
          .where(eq(schema.loans.id, args.id)),
        db.insert(schema.activityLog).values({
          loanId: args.id,
          type: "disetujui",
          description: changed
            ? `Disetujui oleh admin (pemberi pinjaman) dengan syarat final: tenor ${tenorMonths} bulan, bunga ${interestPercent}%/bulan, total tagihan Rp${terms.totalDue.toLocaleString("id-ID")}, cicilan Rp${terms.monthlyPayment.toLocaleString("id-ID")}/bulan.`
            : `Disetujui oleh admin (pemberi pinjaman): tenor ${tenorMonths} bulan, bunga ${interestPercent}%/bulan, cicilan Rp${terms.monthlyPayment.toLocaleString("id-ID")}/bulan.`,
        }),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  rejectLoan: defineAction({
    description: "Admin: menolak pinjaman yang masih menunggu persetujuan.",
    request: z.object({
      token: tokenStr,
      id: z.number().int().positive(),
      reason: z.string().trim().max(300).default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const loan = await loadLoanRow(ctx, args.id);
      if (loan.status !== "menunggu")
        throw new Error("Pinjaman ini sudah diputuskan sebelumnya.");
      await runBatch(db, [
        db
          .update(schema.loans)
          .set({ status: "ditolak", decidedAt: new Date() })
          .where(eq(schema.loans.id, args.id)),
        db.insert(schema.activityLog).values({
          loanId: args.id,
          type: "ditolak",
          description: args.reason
            ? `Ditolak oleh admin (pemberi pinjaman). Alasan: ${args.reason}`
            : "Ditolak oleh admin (pemberi pinjaman).",
        }),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  updateLoan: defineAction({
    description:
      "Mengubah data pinjaman; total tagihan & cicilan dihitung ulang di server dari tanggal mulai asal. Bunga TIDAK bisa diubah dari sini oleh siapa pun — bunga tersimpan selalu dipertahankan; bunga diatur admin di menu Pengaturan dan ditetapkan final saat persetujuan. Pokok & tenor ditegakkan dalam batas Pengaturan. Admin bisa mengubah pinjaman apa pun (kecuali yang ditolak). User hanya bisa mengubah pokok/tenor/keperluan pengajuannya sendiri yang masih menunggu.",
    request: loanInput.extend({
      token: tokenStr,
      id: z.number().int().positive(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      const loan = await loadLoanRow(ctx, args.id);
      if (loan.status === "ditolak")
        throw new Error("Pinjaman yang ditolak tidak dapat diubah.");
      const isAdmin = me.role === "admin";
      if (!isAdmin) {
        if (loan.borrowerAccountId !== me.id)
          throw new Error("Pinjaman ini bukan milik Anda.");
        if (loan.status !== "menunggu")
          throw new Error(
            "Pengajuan yang sudah diputuskan hanya bisa diubah oleh admin.",
          );
      }
      const totals = await paidTotalsByLoan(ctx);
      const paid = totals.get(args.id) ?? 0;
      const borrowerName = isAdmin ? args.borrowerName : me.name;
      const phone = isAdmin ? args.phone : me.phone;
      const settings = await loadSettings(ctx);
      assertWithinSettings(settings, args.principal, args.tenorMonths);
      // Bunga tidak diatur dari form pinjaman: bunga tersimpan selalu
      // dipertahankan apa adanya, nilai kiriman klien diabaikan.
      const interestPercent = loan.interestPercent;
      const terms = computeTerms(args.principal, interestPercent, args.tenorMonths);
      if (terms.totalDue < paid)
        throw new Error(
          "Total tagihan baru lebih kecil dari pembayaran yang sudah masuk.",
        );
      // Tanggal mulai asal dipertahankan; tempo akhir dihitung ulang.
      // Pinjaman lama tanpa tanggal mulai: tempo lamanya dipertahankan.
      const dueDate = loan.startDate
        ? addMonths(loan.startDate, args.tenorMonths)
        : loan.dueDate;
      const linkedAccount = isAdmin
        ? await findAccountByPhone(ctx, args.phone)
        : null;
      await runBatch(db, [
        db
          .update(schema.loans)
          .set({
            borrowerAccountId: isAdmin
              ? linkedAccount
                ? linkedAccount.id
                : null
              : loan.borrowerAccountId,
            borrowerName,
            phone,
            purpose: args.purpose,
            principal: args.principal,
            tenorMonths: args.tenorMonths,
            interestPercent,
            monthlyPayment: terms.monthlyPayment,
            totalInterest: terms.totalInterest,
            totalDue: terms.totalDue,
            dueDate,
            note: args.note,
          })
          .where(eq(schema.loans.id, args.id)),
        db.insert(schema.activityLog).values({
          loanId: args.id,
          type: "diubah",
          description: `Data pinjaman diubah oleh ${isAdmin ? "admin" : borrowerName}: pokok Rp${args.principal.toLocaleString("id-ID")}, tenor ${args.tenorMonths} bulan, bunga ${interestPercent}%/bulan, total tagihan Rp${terms.totalDue.toLocaleString("id-ID")}, cicilan Rp${terms.monthlyPayment.toLocaleString("id-ID")}/bulan, jatuh tempo akhir ${dueDate}.`,
        }),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteLoan: defineAction({
    description:
      "Menghapus pinjaman beserta pembayaran dan jejak aktivitasnya. Admin: pinjaman apa pun. User: hanya pengajuannya sendiri yang masih menunggu (membatalkan pengajuan).",
    request: z.object({ token: tokenStr, id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      const loan = await loadLoanRow(ctx, args.id);
      if (me.role !== "admin") {
        if (loan.borrowerAccountId !== me.id)
          throw new Error("Pinjaman ini bukan milik Anda.");
        if (loan.status !== "menunggu")
          throw new Error(
            "Hanya pengajuan yang masih menunggu yang bisa dibatalkan.",
          );
      }
      await runBatch(db, [
        db.delete(schema.payments).where(eq(schema.payments.loanId, args.id)),
        db
          .delete(schema.activityLog)
          .where(eq(schema.activityLog.loanId, args.id)),
        db.delete(schema.loans).where(eq(schema.loans.id, args.id)),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  recordPayment: defineAction({
    description:
      "Admin: mencatat pembayaran untuk pinjaman yang disetujui; jumlah tidak boleh melebihi sisa tagihan.",
    request: z.object({
      token: tokenStr,
      loanId: z.number().int().positive(),
      amount: z
        .number()
        .int("Jumlah harus bilangan bulat")
        .min(1, "Jumlah pembayaran minimal Rp1"),
      method: z
        .enum(["tunai", "transfer", "ewallet", "lainnya"])
        .default("tunai"),
      note: z.string().trim().max(200).default(""),
      paidAt: z.string().datetime().optional(),
      today: dateStr,
    }),
    response: z.object({ loan: loanView }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const view = await loadView(ctx, args.loanId, args.today);
      if (view.status !== "disetujui")
        throw new Error(
          "Pembayaran hanya bisa dicatat untuk pinjaman yang disetujui.",
        );
      if (view.remaining <= 0)
        throw new Error("Pinjaman ini sudah lunas.");
      if (args.amount > view.remaining)
        throw new Error(
          `Jumlah melebihi sisa tagihan (Rp${view.remaining.toLocaleString("id-ID")}).`,
        );
      const paidAt = args.paidAt ? new Date(args.paidAt) : new Date();
      if (Number.isNaN(paidAt.getTime()))
        throw new Error("Waktu pembayaran tidak valid.");
      const remainingAfter = view.remaining - args.amount;
      await runBatch(db, [
        db.insert(schema.payments).values({
          loanId: args.loanId,
          amount: args.amount,
          method: args.method,
          note: args.note,
          // Dicatat langsung oleh admin = langsung terkonfirmasi.
          status: "dikonfirmasi",
          submittedByAccountId: null,
          decidedAt: new Date(),
          paidAt,
        }),
        db.insert(schema.activityLog).values({
          loanId: args.loanId,
          type: "pembayaran",
          description:
            remainingAfter <= 0
              ? `Pembayaran Rp${args.amount.toLocaleString("id-ID")} diterima — pinjaman LUNAS.`
              : `Pembayaran Rp${args.amount.toLocaleString("id-ID")} diterima. Sisa tagihan Rp${remainingAfter.toLocaleString("id-ID")}.`,
        }),
      ]);
      ctx.invalidateQueries();
      return { loan: await loadView(ctx, args.loanId, args.today) };
    },
  }),

  submitPayment: defineAction({
    description:
      "Peminjam (user): mengajukan pembayaran cicilan untuk pinjamannya sendiri yang sudah disetujui, dari tombol Bayar cicilan. Pengajuan berstatus menunggu konfirmasi admin dan TIDAK mengurangi sisa tagihan sampai admin mengonfirmasi. Jumlah tidak boleh melebihi sisa tagihan setelah dikurangi pengajuan lain yang masih menunggu.",
    request: z.object({
      token: tokenStr,
      loanId: z.number().int().positive(),
      amount: z
        .number()
        .int("Jumlah harus bilangan bulat")
        .min(1, "Jumlah pembayaran minimal Rp1"),
      method: z
        .enum(["tunai", "transfer", "ewallet", "lainnya"])
        .default("transfer"),
      note: z.string().trim().max(200).default(""),
      paidAt: z.string().datetime().optional(),
      today: dateStr,
    }),
    response: z.object({ loan: loanView }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      if (me.role === "admin")
        throw new Error(
          "Admin tidak mengajukan pembayaran — admin mencatat pembayaran langsung atau mengonfirmasi pengajuan peminjam.",
        );
      const loan = await loadLoanRow(ctx, args.loanId);
      if (loan.borrowerAccountId !== me.id)
        throw new Error("Pinjaman ini bukan milik Anda.");
      const view = await loadView(ctx, args.loanId, args.today);
      if (view.status !== "disetujui")
        throw new Error(
          "Pembayaran hanya bisa diajukan untuk pinjaman yang sudah disetujui.",
        );
      if (view.remaining <= 0)
        throw new Error("Pinjaman ini sudah lunas.");
      const pendingTotals = await pendingTotalsByLoan(ctx);
      const pending = pendingTotals.get(args.loanId) ?? 0;
      const available = view.remaining - pending;
      if (args.amount > available)
        throw new Error(
          pending > 0
            ? `Jumlah melebihi sisa yang bisa diajukan: sisa tagihan Rp${view.remaining.toLocaleString("id-ID")} dan Rp${pending.toLocaleString("id-ID")} sedang menunggu konfirmasi admin.`
            : `Jumlah melebihi sisa tagihan (Rp${view.remaining.toLocaleString("id-ID")}).`,
        );
      const paidAt = args.paidAt ? new Date(args.paidAt) : new Date();
      if (Number.isNaN(paidAt.getTime()))
        throw new Error("Waktu pembayaran tidak valid.");
      await runBatch(db, [
        db.insert(schema.payments).values({
          loanId: args.loanId,
          amount: args.amount,
          method: args.method,
          note: args.note,
          status: "menunggu",
          submittedByAccountId: me.id,
          paidAt,
        }),
        db.insert(schema.activityLog).values({
          loanId: args.loanId,
          type: "pembayaran_diajukan",
          description: `Pembayaran Rp${args.amount.toLocaleString("id-ID")} diajukan oleh ${me.name} (cicilan ke-${view.currentInstallment} dari ${view.tenorMonths}) — menunggu konfirmasi admin, sisa tagihan belum berubah.`,
        }),
      ]);
      ctx.invalidateQueries();
      return { loan: await loadView(ctx, args.loanId, args.today) };
    },
  }),

  confirmPayment: defineAction({
    description:
      "Admin: mengonfirmasi pengajuan pembayaran dari peminjam. Setelah dikonfirmasi, pembayaran mengurangi sisa tagihan dan dialokasikan ke cicilan berurutan. Jumlah dicek ulang terhadap sisa tagihan saat konfirmasi.",
    request: z.object({
      token: tokenStr,
      paymentId: z.number().int().positive(),
      today: dateStr,
    }),
    response: z.object({ loan: loanView }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const rows = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, args.paymentId))
        .limit(1);
      const pay = rows[0];
      if (!pay) throw new Error("Pengajuan pembayaran tidak ditemukan.");
      if (pay.status !== "menunggu")
        throw new Error("Pengajuan pembayaran ini sudah diputuskan sebelumnya.");
      const view = await loadView(ctx, pay.loanId, args.today);
      if (view.status !== "disetujui")
        throw new Error("Pinjaman ini tidak lagi aktif.");
      if (pay.amount > view.remaining)
        throw new Error(
          `Jumlah pengajuan (Rp${pay.amount.toLocaleString("id-ID")}) melebihi sisa tagihan saat ini (Rp${view.remaining.toLocaleString("id-ID")}). Tolak pengajuan ini atau minta peminjam mengajukan ulang.`,
        );
      const remainingAfter = view.remaining - pay.amount;
      await runBatch(db, [
        db
          .update(schema.payments)
          .set({ status: "dikonfirmasi", decidedAt: new Date() })
          .where(eq(schema.payments.id, args.paymentId)),
        db.insert(schema.activityLog).values({
          loanId: pay.loanId,
          type: "pembayaran_dikonfirmasi",
          description:
            remainingAfter <= 0
              ? `Pembayaran Rp${pay.amount.toLocaleString("id-ID")} dari peminjam dikonfirmasi admin — pinjaman LUNAS.`
              : `Pembayaran Rp${pay.amount.toLocaleString("id-ID")} dari peminjam dikonfirmasi admin. Sisa tagihan Rp${remainingAfter.toLocaleString("id-ID")}.`,
        }),
      ]);
      ctx.invalidateQueries();
      return { loan: await loadView(ctx, pay.loanId, args.today) };
    },
  }),

  rejectPayment: defineAction({
    description:
      "Admin: menolak pengajuan pembayaran dari peminjam (mis. bukti tidak sesuai). Pengajuan ditolak tidak pernah mengurangi sisa tagihan; alasan penolakan dicatat di jejak aktivitas.",
    request: z.object({
      token: tokenStr,
      paymentId: z.number().int().positive(),
      reason: z.string().trim().max(300).default(""),
      today: dateStr,
    }),
    response: z.object({ loan: loanView }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const rows = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, args.paymentId))
        .limit(1);
      const pay = rows[0];
      if (!pay) throw new Error("Pengajuan pembayaran tidak ditemukan.");
      if (pay.status !== "menunggu")
        throw new Error("Pengajuan pembayaran ini sudah diputuskan sebelumnya.");
      await runBatch(db, [
        db
          .update(schema.payments)
          .set({ status: "ditolak", decidedAt: new Date() })
          .where(eq(schema.payments.id, args.paymentId)),
        db.insert(schema.activityLog).values({
          loanId: pay.loanId,
          type: "pembayaran_ditolak",
          description: args.reason
            ? `Pembayaran Rp${pay.amount.toLocaleString("id-ID")} dari peminjam DITOLAK admin. Alasan: ${args.reason}`
            : `Pembayaran Rp${pay.amount.toLocaleString("id-ID")} dari peminjam DITOLAK admin.`,
        }),
      ]);
      ctx.invalidateQueries();
      return { loan: await loadView(ctx, pay.loanId, args.today) };
    },
  }),

  withdrawPayment: defineAction({
    description:
      "Peminjam: membatalkan pengajuan pembayarannya sendiri yang masih menunggu konfirmasi admin. Pengajuan dihapus dari riwayat dan dicatat di jejak aktivitas.",
    request: z.object({
      token: tokenStr,
      paymentId: z.number().int().positive(),
      today: dateStr,
    }),
    response: z.object({ loan: loanView }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      const rows = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, args.paymentId))
        .limit(1);
      const pay = rows[0];
      if (!pay) throw new Error("Pengajuan pembayaran tidak ditemukan.");
      if (pay.submittedByAccountId !== me.id)
        throw new Error("Pengajuan pembayaran ini bukan milik Anda.");
      if (pay.status !== "menunggu")
        throw new Error(
          "Hanya pengajuan yang masih menunggu konfirmasi yang bisa dibatalkan.",
        );
      await runBatch(db, [
        db
          .delete(schema.payments)
          .where(eq(schema.payments.id, args.paymentId)),
        db.insert(schema.activityLog).values({
          loanId: pay.loanId,
          type: "pembayaran_dibatalkan",
          description: `Pengajuan pembayaran Rp${pay.amount.toLocaleString("id-ID")} dibatalkan oleh peminjam sebelum dikonfirmasi admin.`,
        }),
      ]);
      ctx.invalidateQueries();
      return { loan: await loadView(ctx, pay.loanId, args.today) };
    },
  }),

  deletePayment: defineAction({
    description:
      "Admin: menghapus satu catatan pembayaran (koreksi kesalahan catat).",
    request: z.object({
      token: tokenStr,
      paymentId: z.number().int().positive(),
      today: dateStr,
    }),
    response: z.object({ loan: loanView }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const rows = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, args.paymentId))
        .limit(1);
      const pay = rows[0];
      if (!pay) throw new Error("Catatan pembayaran tidak ditemukan.");
      await runBatch(db, [
        db
          .delete(schema.payments)
          .where(eq(schema.payments.id, args.paymentId)),
        db.insert(schema.activityLog).values({
          loanId: pay.loanId,
          type: "pembayaran_dihapus",
          description: `Catatan pembayaran Rp${pay.amount.toLocaleString("id-ID")} dihapus (koreksi).`,
        }),
      ]);
      ctx.invalidateQueries();
      return { loan: await loadView(ctx, pay.loanId, args.today) };
    },
  }),

  getReport: defineAction({
    description:
      "Admin: laporan pinjaman pada rentang tanggal pembuatan, lengkap untuk diekspor ke CSV.",
    request: z.object({
      token: tokenStr,
      today: dateStr,
      from: z.union([dateStr, z.literal("")]).default(""),
      to: z.union([dateStr, z.literal("")]).default(""),
    }),
    response: z.object({
      summary: z.object({
        loanCount: z.number(),
        disbursed: z.number(),
        totalDueApproved: z.number(),
        collectedInRange: z.number(),
        outstandingNow: z.number(),
        overdueNow: z.number(),
      }),
      rows: z.array(loanView),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const me = await requireAccount(ctx, args.token);
      requireAdmin(me);
      const loans = await db
        .select()
        .from(schema.loans)
        .orderBy(asc(schema.loans.createdAt));
      const confirmed = await confirmedPaymentsByLoan(ctx);
      const settings = await loadSettings(ctx);
      const inRange = (isoDate: string) =>
        (!args.from || isoDate >= args.from) &&
        (!args.to || isoDate <= args.to);
      const ranged = loans.filter((l) =>
        inRange(l.createdAt.toISOString().slice(0, 10)),
      );
      const views = ranged.map((l) =>
        toView(
          l,
          confirmed.get(l.id) ?? [],
          args.today,
          settings.lateFeePercentPerDay,
        ),
      );
      const pays = await db.select().from(schema.payments);
      // Laporan hanya menghitung uang yang benar-benar terkonfirmasi —
      // pengajuan pembayaran yang masih menunggu/ditolak tidak dihitung.
      const collectedInRange = pays
        .filter(
          (p) =>
            p.status === "dikonfirmasi" &&
            inRange(p.paidAt.toISOString().slice(0, 10)),
        )
        .reduce((s, p) => s + p.amount, 0);
      const allViews = loans.map((l) =>
        toView(
          l,
          confirmed.get(l.id) ?? [],
          args.today,
          settings.lateFeePercentPerDay,
        ),
      );
      const approved = views.filter((v) => v.status === "disetujui");
      return {
        summary: {
          loanCount: views.length,
          disbursed: approved.reduce((s, v) => s + v.principal, 0),
          totalDueApproved: approved.reduce((s, v) => s + v.totalDue, 0),
          collectedInRange,
          outstandingNow: allViews
            .filter(
              (v) =>
                v.displayStatus === "aktif" || v.displayStatus === "terlambat",
            )
            .reduce((s, v) => s + v.totalOwed, 0),
          overdueNow: allViews.filter((v) => v.displayStatus === "terlambat")
            .length,
        },
        rows: views,
      };
    },
  }),
} satisfies ActionsModule;
