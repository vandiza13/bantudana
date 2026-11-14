// Smoke test ujung-ke-ujung untuk BantuDana versi Vercel.
// Jalankan:  npm run smoke -- [baseUrl]
// Default baseUrl: http://localhost:3102 (lihat scripts/serve-local.ts)
// Server harus sudah berjalan dengan database KOSONG (atau database uji).
// Skrip ini membuat akun demo, pinjaman, persetujuan, dan pembayaran —
// JANGAN dijalankan terhadap database produksi yang sudah berisi data
// asli. Sebagai pengaman, base URL selain localhost ditolak kecuali
// env SMOKE_ALLOW_REMOTE=1 diisi.
//
// Alur yang diuji (bentuk request/response persis mengikuti
// server/src/actions.ts — bukan tebakan):
//   healthz -> getAuthStatus -> register Admin -> register User ->
//   login Admin -> login User -> getSettings -> createLoan (User, hanya
//   mengembalikan {id}) -> getLoan (cek bunga/total/cicilan) ->
//   approveLoan (Admin) -> getDashboard -> submitPayment (User, menunggu)
//   -> getLoan (cari payment menunggu + sisa belum berkurang)
//   -> confirmPayment (Admin) -> getLoan (sisa berkurang, cicilan lunas)
//   -> pinjaman ke-2 (mulai 2026-10-04) -> approve -> getLoan
//      today=2026-11-14 (cicilan 1 terlambat 10 hari -> denda Rp4.667).
const BASE = process.argv[2] ?? "http://localhost:3102";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${BASE}/`)) {
  if (process.env["SMOKE_ALLOW_REMOTE"] !== "1") {
    console.error(
      `SMOKE DITOLAK: base URL ${BASE} bukan localhost.\n` +
        "Smoke test ini membuat akun/pinjaman demo dan hanya boleh jalan\n" +
        "melawan server lokal / database uji. Bila memang sengaja mengetes\n" +
        "deployment jarak jauh yang masih kosong, jalankan dengan:\n" +
        "  SMOKE_ALLOW_REMOTE=1 npm run smoke -- <url>",
    );
    process.exit(1);
  }
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(action: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args }),
  });
  const body = (await res.json()) as { data?: unknown; error?: string };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data;
}

const today = new Date().toISOString().slice(0, 10);
console.log(`[smoke] base=${BASE} today=${today}`);

type LoanView = {
  id: number;
  interestPercent: number;
  totalInterest: number;
  totalDue: number;
  monthlyPayment: number;
  remaining: number;
  lateFee: number;
  totalOwed: number;
  displayStatus: string;
  daysLate: number;
  status: string;
};
type PaymentView = { id: number; status: string; amount: number };

// 1. Healthcheck
try {
  const res = await fetch(`${BASE}/healthz`);
  const body = (await res.json()) as { ok?: boolean };
  check("GET /healthz -> { ok: true }", res.ok && body.ok === true);
} catch (e) {
  check("GET /healthz -> { ok: true }", false, String(e));
}

// 2. Auth status di DB kosong
let adminToken = "";
let userToken = "";
let loanId = 0;
try {
  const st = (await call("getAuthStatus", {})) as { adminExists: boolean; accountCount: number };
  check("getAuthStatus (awal, kosong)", st.adminExists === false && st.accountCount === 0, JSON.stringify(st));
} catch (e) {
  check("getAuthStatus (awal, kosong)", false, String(e));
}

// 3. Register Admin (akun pertama -> admin)
try {
  const r = (await call("register", { name: "Gibran Yudistira", phone: "081234567890", pin: "123456" })) as {
    account: { id: number; role: string };
    token: string;
  };
  adminToken = r.token;
  check("register Admin Gibran (id 1, role admin)", r.account.id === 1 && r.account.role === "admin", JSON.stringify(r.account));
} catch (e) {
  check("register Admin Gibran (id 1, role admin)", false, String(e));
}

// 4. Register User (akun kedua -> user)
try {
  const r = (await call("register", { name: "Sari Wulandari", phone: "081234567891", pin: "123456" })) as {
    account: { id: number; role: string };
    token: string;
  };
  userToken = r.token;
  check("register User Sari (id 2, role user)", r.account.id === 2 && r.account.role === "user", JSON.stringify(r.account));
} catch (e) {
  check("register User Sari (id 2, role user)", false, String(e));
}

// 5. Login keduanya
try {
  const a = (await call("login", { phone: "081234567890", pin: "123456" })) as { account: { role: string } };
  const u = (await call("login", { phone: "081234567891", pin: "123456" })) as { account: { role: string } };
  check("login Admin + login User", a.account.role === "admin" && u.account.role === "user");
} catch (e) {
  check("login Admin + login User", false, String(e));
}

// 6. Settings default (respons: { settings: {...} })
try {
  const r = (await call("getSettings", { token: adminToken })) as {
    settings: { defaultInterestPercent: number; lateFeePercentPerDay: number };
  };
  check(
    "getSettings default bunga 2%/bln & denda 0,1%/hari",
    r.settings.defaultInterestPercent === 2 && r.settings.lateFeePercentPerDay === 0.1,
    JSON.stringify(r.settings),
  );
} catch (e) {
  check("getSettings default bunga 2%/bln & denda 0,1%/hari", false, String(e));
}

// 7. Admin tidak boleh mengajukan pinjaman (harus ditolak server)
try {
  await call("createLoan", {
    token: adminToken,
    borrowerName: "Gibran Yudistira",
    phone: "081234567890",
    purpose: "Tes admin pinjam",
    principal: 1000000,
    tenorMonths: 3,
    interestPercent: 0,
    note: "",
  });
  check("createLoan oleh Admin DITOLAK server", false, "tidak ditolak!");
} catch {
  check("createLoan oleh Admin DITOLAK server", true);
}

// 8. User ajukan Rp2.500.000 tenor 6 (bunga kiriman 9% harus diabaikan -> 2%)
//    createLoan hanya mengembalikan { id }; angka dicek lewat getLoan.
try {
  const created = (await call("createLoan", {
    token: userToken,
    borrowerName: "Sari Wulandari",
    phone: "081234567891",
    purpose: "Modal usaha (smoke test)",
    principal: 2500000,
    tenorMonths: 6,
    interestPercent: 9,
    note: "",
  })) as { id: number };
  loanId = created.id;
  const detail = (await call("getLoan", { token: userToken, id: loanId, today })) as { loan: LoanView };
  const l = detail.loan;
  check(
    "createLoan User Rp2,5jt/6bln -> bunga 2%, total bunga Rp300rb, total Rp2,8jt, cicilan Rp466.667",
    l.interestPercent === 2 && l.totalInterest === 300000 && l.totalDue === 2800000 && l.monthlyPayment === 466667,
    JSON.stringify({ interestPercent: l.interestPercent, totalInterest: l.totalInterest, totalDue: l.totalDue, monthlyPayment: l.monthlyPayment }),
  );
} catch (e) {
  check("createLoan User Rp2,5jt/6bln", false, String(e));
}

// 9. Admin ACC (request: { token, id, tenorMonths?, interestPercent? })
try {
  await call("approveLoan", { token: adminToken, id: loanId, interestPercent: 2, tenorMonths: 6 });
  const detail = (await call("getLoan", { token: adminToken, id: loanId, today })) as { loan: LoanView };
  check("approveLoan oleh Admin -> status disetujui", detail.loan.status === "disetujui", `status=${detail.loan.status}`);
} catch (e) {
  check("approveLoan oleh Admin", false, String(e));
}

// 10. Dashboard Admin: 1 pinjaman aktif, 0 menunggu
try {
  const d = (await call("getDashboard", { token: adminToken, today })) as {
    stats: { activeCount: number; pendingCount: number };
  };
  check(
    "getDashboard Admin: activeCount 1, pendingCount 0",
    d.stats.activeCount === 1 && d.stats.pendingCount === 0,
    JSON.stringify(d.stats),
  );
} catch (e) {
  check("getDashboard Admin", false, String(e));
}

// 11. User ajukan pembayaran cicilan Rp466.667 -> menunggu; sisa belum berkurang
let pendingPaymentId = 0;
try {
  await call("submitPayment", {
    token: userToken,
    loanId,
    amount: 466667,
    method: "transfer",
    note: "Smoke test",
    today,
  });
  const detail = (await call("getLoan", { token: adminToken, id: loanId, today })) as {
    loan: LoanView;
    payments: PaymentView[];
  };
  const pending = detail.payments.find((p) => p.status === "menunggu");
  pendingPaymentId = pending?.id ?? 0;
  check(
    "submitPayment User -> ada pembayaran menunggu Rp466.667, sisa tetap Rp2.800.000",
    pending?.amount === 466667 && detail.loan.remaining === 2800000,
    `pending=${JSON.stringify(pending)} remaining=${detail.loan.remaining}`,
  );
} catch (e) {
  check("submitPayment User", false, String(e));
}

// 12. Admin konfirmasi -> sisa berkurang jadi Rp2.333.333
try {
  if (!pendingPaymentId) throw new Error("tidak ada payment menunggu dari langkah 11");
  await call("confirmPayment", { token: adminToken, paymentId: pendingPaymentId, today });
  const detail = (await call("getLoan", { token: adminToken, id: loanId, today })) as {
    loan: LoanView;
    payments: PaymentView[];
  };
  const done = detail.payments.find((p) => p.id === pendingPaymentId);
  check(
    "confirmPayment Admin -> sisa Rp2.333.333, pembayaran terkonfirmasi",
    detail.loan.remaining === 2333333 && done?.status === "dikonfirmasi",
    `remaining=${detail.loan.remaining} status=${done?.status}`,
  );
} catch (e) {
  check("confirmPayment Admin", false, String(e));
}

// 13. Denda keterlambatan: pinjaman ke-2 mulai 2026-10-04, dicek 2026-11-14
//     (cicilan 1 Rp466.667 jatuh tempo 2026-11-04 -> terlambat 10 hari,
//      denda = 466.667 x 0,1% x 10 = Rp4.667, totalOwed = Rp2.804.667).
try {
  const created = (await call("createLoan", {
    token: userToken,
    borrowerName: "Sari Wulandari",
    phone: "081234567891",
    purpose: "Modal usaha (uji denda)",
    principal: 2500000,
    tenorMonths: 6,
    interestPercent: 9,
    startDate: "2026-10-04",
    note: "",
  })) as { id: number };
  await call("approveLoan", { token: adminToken, id: created.id, interestPercent: 2, tenorMonths: 6 });
  const detail = (await call("getLoan", { token: adminToken, id: created.id, today: "2026-11-14" })) as {
    loan: LoanView;
  };
  const l = detail.loan;
  check(
    "Denda keterlambatan: cicilan 1 terlambat 10 hari -> denda Rp4.667, totalOwed Rp2.804.667, status terlambat",
    l.lateFee === 4667 && l.totalOwed === 2804667 && l.displayStatus === "terlambat" && l.daysLate === 10,
    JSON.stringify({ lateFee: l.lateFee, totalOwed: l.totalOwed, displayStatus: l.displayStatus, daysLate: l.daysLate }),
  );
} catch (e) {
  check("Denda keterlambatan (uji 10 hari)", false, String(e));
}

console.log(`\n[smoke] ${passed} lolos, ${failed} gagal`);
if (failed > 0) process.exit(1);
