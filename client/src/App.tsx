import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./standalone-shim";
import { api } from "./api";
import { AuthProvider, useAuth, type Account } from "./auth";
import { AuthScreen } from "./AuthScreen";
import {
ErrorBox,
Field,
LoanRow,
Modal,
SectionTitle,
Toast,
inputCls,
primaryBtn,
} from "./components";
import { LoanDetail } from "./LoanDetail";
import { LoanForm } from "./LoanForm";
import { Report } from "./Report";
import { SettingsView } from "./Settings";
import { fmtDate, fmtDateTime, rp, todayLocal } from "./lib";

type View =
  | { name: "beranda" }
  | { name: "pinjaman" }
  | { name: "laporan" }
  | { name: "pengaturan" }
  | { name: "akun" }
  | { name: "detail"; id: number };

type Filter = "semua" | "menunggu" | "aktif" | "terlambat" | "lunas" | "ditolak";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "menunggu", label: "Menunggu" },
  { key: "aktif", label: "Aktif" },
  { key: "terlambat", label: "Terlambat" },
  { key: "lunas", label: "Lunas" },
  { key: "ditolak", label: "Ditolak" },
];

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { status, resetSession } = useAuth();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (status !== "loading") return;
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [status]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg)] px-6 text-center text-[var(--text)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <p className="text-sm font-semibold text-[var(--dim)]">
          Memuat BantuDana…
        </p>
        {slow && (
          <>
            <p className="max-w-xs text-sm text-[var(--dim)]">
              Memuat lebih lama dari biasanya — mungkin koneksi sedang lambat
              atau sesi sebelumnya tersangkut.
            </p>
            <button
              type="button"
              onClick={resetSession}
              className="rounded-xl bg-[var(--accent)] px-5 py-2.5 font-bold text-white hover:bg-[var(--accent-strong)]"
            >
              Lanjut ke layar masuk
            </button>
          </>
        )}
      </div>
    );
  }
  if (status === "signedOut") {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <AuthScreen />
      </div>
    );
  }
  return <Shell />;
}

function Shell() {
  const { token, account } = useAuth();
  const today = todayLocal();
  const [view, setView] = useState<View>({ name: "beranda" });
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  if (!token || !account) return null;
  const isAdmin = account.role === "admin";

  const openLoan = (id: number) => setView({ name: "detail", id });
  const goHome = () => setView({ name: "beranda" });
  // Admin tidak punya tombol/menu pengajuan sama sekali: admin tidak
  // meminjam — admin mengatur (Pengaturan), menyetujui, dan mencatat
  // pembayaran. Tombol ajukan hanya untuk peminjam.
  const createLabel = "+ Ajukan pinjaman";

  const navBtn = (target: View["name"], label: string, icon: string) => {
    const active = view.name === target;
    return (
      <button
        key={target}
        type="button"
        onClick={() => setView({ name: target } as View)}
        aria-current={active ? "page" : undefined}
        className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-xs font-bold sm:flex-none sm:flex-row sm:gap-2 sm:px-4 sm:text-sm ${
          active
            ? "text-[var(--accent-strong)]"
            : "text-[var(--dim)] hover:text-[var(--text)]"
        }`}
      >
        <span className="text-lg leading-none sm:text-base">{icon}</span>
        {label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      {/* Header desktop */}
      <header className="no-print sticky top-0 z-40 hidden border-b border-[var(--border)] bg-[var(--bg)]/95 pt-safe backdrop-blur sm:block">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-5 py-3">
          <p className="mr-3 text-lg font-extrabold tracking-tight">
            Bantu<span className="text-[var(--accent-strong)]">Dana</span>
          </p>
          <nav className="flex items-center gap-1" aria-label="Navigasi utama">
            {navBtn("beranda", "Beranda", "⌂")}
            {navBtn("pinjaman", "Pinjaman", "▤")}
            {isAdmin && navBtn("laporan", "Laporan", "▦")}
            {isAdmin && navBtn("pengaturan", "Pengaturan", "⚙")}
            {navBtn("akun", "Akun", "◉")}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-[var(--dim)] lg:block">
              {account.name} ·{" "}
              <span className="font-bold text-[var(--text)]">
                {isAdmin ? "Admin" : "Peminjam"}
              </span>
            </span>
            {!isAdmin && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="rounded-xl bg-[var(--accent)] px-5 py-2.5 font-bold text-white hover:bg-[var(--accent-strong)]"
              >
                {createLabel}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 sm:px-5 sm:pb-10">
        {view.name === "beranda" && (
          <Beranda
            today={today}
            token={token}
            account={account}
            onOpenLoan={openLoan}
            onCreate={() => setShowCreate(true)}
            onSeeAll={() => setView({ name: "pinjaman" })}
            onSettings={() => setView({ name: "pengaturan" })}
          />
        )}
        {view.name === "pinjaman" && (
          <LoanList today={today} token={token} account={account} onOpenLoan={openLoan} />
        )}
        {view.name === "laporan" && isAdmin && (
          <Report token={token} onOpenLoan={openLoan} showToast={setToast} />
        )}
        {view.name === "pengaturan" && isAdmin && (
          <SettingsView showToast={setToast} />
        )}
        {view.name === "akun" && (
          <AccountView account={account} showToast={setToast} />
        )}
        {view.name === "detail" && (
          <LoanDetail
            id={view.id}
            today={today}
            token={token}
            account={account}
            onBack={goHome}
            showToast={setToast}
          />
        )}
      </main>

      {/* Navigasi bawah (ponsel) — mobile-first */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] pb-safe sm:hidden"
        aria-label="Navigasi utama"
      >
        <div className="relative flex items-end px-2 pb-1 pt-1">
          {navBtn("beranda", "Beranda", "⌂")}
          {navBtn("pinjaman", "Pinjaman", "▤")}
          {!isAdmin && (
            <div className="flex flex-1 flex-col items-center">
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                aria-label="Ajukan pinjaman baru"
                className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-3xl font-light text-white shadow-lg ring-4 ring-[var(--bg)]"
              >
                +
              </button>
              <span className="mt-0.5 text-xs font-bold text-[var(--dim)]">
                Ajukan
              </span>
            </div>
          )}
          {isAdmin && navBtn("laporan", "Laporan", "▦")}
          {isAdmin && navBtn("pengaturan", "Pengaturan", "⚙")}
          {navBtn("akun", "Akun", "◉")}
        </div>
      </nav>

      {showCreate && !isAdmin && (
        <Modal title="Ajukan pinjaman" onClose={() => setShowCreate(false)}>
          <LoanForm
            account={account}
            onDone={(id) => {
              setShowCreate(false);
              setToast("Pengajuan terkirim — menunggu persetujuan admin.");
              openLoan(id);
            }}
            onCancel={() => setShowCreate(false)}
          />
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beranda
// ---------------------------------------------------------------------------

function Beranda({
  today,
  token,
  account,
  onOpenLoan,
  onCreate,
  onSeeAll,
  onSettings,
}: {
  today: string;
  token: string;
  account: Account;
  onOpenLoan: (id: number) => void;
  onCreate: () => void;
  onSeeAll: () => void;
  onSettings: () => void;
}) {
  const isAdmin = account.role === "admin";
  const dash = useQuery({
    queryKey: ["dashboard", account.id, today],
    queryFn: () => api.getDashboard({ token, today }),
  });
  const data = dash.data;
  const s = data?.stats;
  const isEmpty =
    s &&
    s.activeCount === 0 &&
    s.pendingCount === 0 &&
    s.totalLent === 0 &&
    s.paidOffCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Beranda</h1>
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            Halo, {account.name} · {fmtDate(today)}
          </p>
        </div>
        {!isAdmin && (
          <button
            type="button"
            onClick={onCreate}
            className="hidden rounded-xl bg-[var(--accent)] px-5 py-2.5 font-bold text-white hover:bg-[var(--accent-strong)] sm:block"
          >
            + Ajukan pinjaman
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={onSettings}
            className="hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 font-bold text-[var(--text)] hover:border-[var(--accent)] sm:block"
          >
            ⚙ Pengaturan
          </button>
        )}
      </div>

      {dash.isPending && (
        <p className="py-10 text-center text-[var(--dim)]">Memuat ringkasan…</p>
      )}
      {dash.error && (
        <p className="py-10 text-center text-[var(--danger)]">
          Gagal memuat data.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => dash.refetch()}
          >
            Coba lagi
          </button>
        </p>
      )}

      {s && isEmpty && (
        <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
          <p className="text-xl font-extrabold">
            {isAdmin
              ? "Belum ada pinjaman tercatat"
              : "Belum ada pinjaman atas nama Anda"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--dim)]">
            {isAdmin
              ? "Pengajuan dari peminjam akan muncul di sini untuk Anda setujui atau tolak. Sambil menunggu, atur dulu bunga, tenor, dan ketentuan pinjaman lainnya di menu Pengaturan."
              : "Ajukan pinjaman pertama Anda lewat tombol di bawah. Pengajuan berstatus menunggu sampai disetujui oleh admin (pemberi pinjaman)."}
          </p>
          {isAdmin ? (
            <button
              type="button"
              onClick={onSettings}
              className="mt-5 rounded-xl bg-[var(--accent)] px-6 py-3 font-bold text-white"
            >
              ⚙ Buka Pengaturan
            </button>
          ) : (
            <button
              type="button"
              onClick={onCreate}
              className="mt-5 rounded-xl bg-[var(--accent)] px-6 py-3 font-bold text-white"
            >
              + Ajukan pinjaman pertama
            </button>
          )}
        </div>
      )}

      {s && data && !isEmpty && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <p className="text-sm font-semibold text-[var(--dim)]">
                Pinjaman aktif
              </p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight">
                {s.activeCount}
              </p>
            </div>
            <div className="rounded-3xl bg-[var(--accent)] p-5 text-white">
              <p className="text-sm font-semibold text-white/85">
                Total harus dibayar
              </p>
              <p className="mt-1 break-words text-3xl font-extrabold tracking-tight">
                {rp(s.totalOutstanding)}
              </p>
              <p className="mt-1 text-xs text-white/75">
                {isAdmin
                  ? "Sisa tagihan semua pinjaman aktif"
                  : "Sisa tagihan pinjaman aktif Anda"}
                {s.lateFeeTotal > 0
                  ? ` · termasuk denda keterlambatan ${rp(s.lateFeeTotal)}`
                  : ""}
              </p>
            </div>
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <p className="text-sm font-semibold text-[var(--dim)]">
                Menunggu persetujuan
              </p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight">
                {s.pendingCount}
              </p>
            </div>
            <div
              className={`rounded-3xl border p-5 ${
                s.overdueCount > 0
                  ? "border-[var(--danger)] bg-[var(--danger-soft)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              <p
                className={`text-sm font-semibold ${
                  s.overdueCount > 0
                    ? "text-[var(--danger)]"
                    : "text-[var(--dim)]"
                }`}
              >
                Terlambat
              </p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight">
                {s.overdueCount}
              </p>
              {s.overdueCount > 0 && (
                <p className="mt-1 text-xs font-semibold text-[var(--danger)]">
                  Total {rp(s.overdueAmount)} belum dibayar (termasuk denda
                  keterlambatan)
                </p>
              )}
            </div>
          </div>

          <p className="text-sm text-[var(--dim)]">
            {isAdmin ? "Total disalurkan" : "Total dipinjam"} {rp(s.totalLent)}{" "}
            · {isAdmin ? "Sudah kembali" : "Sudah dibayar"}{" "}
            {rp(s.totalCollected)} · {s.paidOffCount} pinjaman lunas
          </p>

          {data.pending.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <SectionTitle>
                  {isAdmin
                    ? "Menunggu persetujuan"
                    : "Pengajuan menunggu keputusan"}
                </SectionTitle>
                <span className="rounded-full bg-[var(--warn-soft)] px-2.5 py-1 text-xs font-bold text-[var(--warn)]">
                  {data.pending.length} pengajuan
                </span>
              </div>
              <ul className="divide-y divide-[var(--border)] rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
                {data.pending.map((loan) => (
                  <li key={loan.id}>
                    <LoanRow loan={loan} onOpen={onOpenLoan} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.pendingPayments.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <SectionTitle>
                  {isAdmin
                    ? "Pembayaran menunggu konfirmasi"
                    : "Pembayaran menunggu konfirmasi admin"}
                </SectionTitle>
                <span className="rounded-full bg-[var(--warn-soft)] px-2.5 py-1 text-xs font-bold text-[var(--warn)]">
                  {data.pendingPayments.length} pembayaran
                </span>
              </div>
              <ul className="divide-y divide-[var(--border)] rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
                {data.pendingPayments.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onOpenLoan(p.loanId)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                      aria-label={`Buka pinjaman ${p.purpose} untuk pembayaran ${rp(p.amount)}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">
                          {p.purpose}
                          {isAdmin ? ` · ${p.borrowerName}` : ""}
                        </span>
                        <span className="block text-sm text-[var(--dim)]">
                          {fmtDateTime(p.paidAt)} ·{" "}
                          {isAdmin
                            ? "Ketuk untuk konfirmasi atau tolak"
                            : "Sisa tagihan berkurang setelah admin mengonfirmasi"}
                        </span>
                      </span>
                      <span className="shrink-0 font-extrabold text-[var(--warn)]">
                        {rp(p.amount)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle>Jatuh tempo terdekat</SectionTitle>
              <button
                type="button"
                onClick={onSeeAll}
                className="text-sm font-bold text-[var(--accent-strong)]"
              >
                Lihat semua →
              </button>
            </div>
            {data.upcoming.length === 0 ? (
              <p className="rounded-3xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--dim)]">
                Tidak ada pinjaman aktif saat ini.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)] rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
                {data.upcoming.slice(0, 5).map((loan) => (
                  <li key={loan.id}>
                    <LoanRow loan={loan} onOpen={onOpenLoan} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daftar pinjaman
// ---------------------------------------------------------------------------

function LoanList({
  today,
  token,
  account,
  onOpenLoan,
}: {
  today: string;
  token: string;
  account: Account;
  onOpenLoan: (id: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>("semua");
  const [search, setSearch] = useState("");
  const list = useQuery({
    queryKey: ["loans", account.id, today, filter, search],
    queryFn: () => api.listLoans({ token, today, filter, search }),
  });
  const loans = useMemo(() => list.data?.loans ?? [], [list.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-extrabold tracking-tight">
        {account.role === "admin" ? "Pinjaman" : "Pinjaman saya"}
      </h1>

      <input
        aria-label="Cari pinjaman"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-base outline-none focus:border-[var(--accent)]"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cari nama, keperluan, atau nomor…"
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter status">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
              filter === f.key
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--dim)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.isPending && (
        <p className="py-10 text-center text-[var(--dim)]">Memuat pinjaman…</p>
      )}
      {list.error && (
        <p className="py-10 text-center text-[var(--danger)]">
          Gagal memuat daftar.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => list.refetch()}
          >
            Coba lagi
          </button>
        </p>
      )}
      {list.data && loans.length === 0 && (
        <p className="rounded-3xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--dim)]">
          {search || filter !== "semua"
            ? "Tidak ada pinjaman yang cocok dengan filter ini."
            : account.role === "admin"
              ? "Belum ada pinjaman. Pengajuan dari peminjam akan muncul di sini."
              : "Belum ada pinjaman. Ajukan lewat tombol + di bawah."}
        </p>
      )}
      {loans.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
          {loans.map((loan) => (
            <li key={loan.id}>
              <LoanRow loan={loan} onOpen={onOpenLoan} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Akun
// ---------------------------------------------------------------------------

function AccountView({
  account,
  showToast,
}: {
  account: Account;
  showToast: (msg: string) => void;
}) {
  const { token, signOut } = useAuth();
  const isAdmin = account.role === "admin";
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const borrowers = useQuery({
    queryKey: ["borrowers", account.id],
    queryFn: () => api.listBorrowers({ token: token ?? "" }),
    enabled: isAdmin && !!token,
  });

  const changePinMut = useMutation({
    mutationFn: async () =>
      api.changePin({ token: token ?? "", oldPin, newPin }),
    onSuccess: () => {
      setOldPin("");
      setNewPin("");
      setNewPinConfirm("");
      setError("");
      showToast("PIN berhasil diganti.");
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(oldPin)) return setError("PIN lama harus 6 digit.");
    if (!/^\d{6}$/.test(newPin)) return setError("PIN baru harus 6 digit.");
    if (newPin !== newPinConfirm)
      return setError("Konfirmasi PIN baru tidak sama.");
    changePinMut.mutate();
  };

  const pinField = (
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <Field label={label}>
      <input
        aria-label={label}
        className={inputCls}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="••••••"
        inputMode="numeric"
        type="password"
        autoComplete="off"
      />
    </Field>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Akun</h1>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-xl font-extrabold text-[var(--accent-strong)]">
            {account.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold">{account.name}</p>
            <p className="text-sm text-[var(--dim)]">{account.phone}</p>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
              isAdmin
                ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "bg-[var(--surface-2)] text-[var(--dim)]"
            }`}
          >
            {isAdmin ? "Admin · Pemberi pinjaman" : "Peminjam"}
          </span>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[var(--dim)]">
          {isAdmin
            ? "Sebagai admin, Anda mengatur bunga, tenor, dan ketentuan pinjaman di menu Pengaturan, menyetujui atau menolak pengajuan, mencatat pembayaran, dan melihat seluruh laporan. Admin tidak mengajukan pinjaman."
            : "Sebagai peminjam, Anda mengajukan pinjaman, memantau statusnya, dan membayar cicilan dari halaman detail pinjaman. Pembayaran yang Anda ajukan menunggu konfirmasi admin sebelum mengurangi sisa tagihan."}
        </p>
      </div>

      {isAdmin && (
        <section>
          <SectionTitle>Peminjam terdaftar</SectionTitle>
          <div className="mt-2">
            {borrowers.isPending && (
              <p className="text-sm text-[var(--dim)]">Memuat daftar…</p>
            )}
            {borrowers.data && borrowers.data.borrowers.length === 0 && (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-5 text-center text-sm text-[var(--dim)]">
                Belum ada akun peminjam. Peminjam mendaftar sendiri lewat
                layar Daftar — akun setelah admin otomatis menjadi peminjam.
              </p>
            )}
            {borrowers.data && borrowers.data.borrowers.length > 0 && (
              <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                {borrowers.data.borrowers.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-sm font-extrabold text-[var(--dim)]">
                      {b.name.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{b.name}</span>
                      <span className="block text-sm text-[var(--dim)]">
                        {b.phone}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Ganti PIN</SectionTitle>
        <form
          onSubmit={submitPin}
          className="mt-2 space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"
        >
          {pinField("PIN lama", oldPin, setOldPin)}
          <div className="grid grid-cols-2 gap-3">
            {pinField("PIN baru (6 digit)", newPin, setNewPin)}
            {pinField("Konfirmasi PIN baru", newPinConfirm, setNewPinConfirm)}
          </div>
          <ErrorBox message={error} />
          <button
            type="submit"
            disabled={changePinMut.isPending}
            className={`${primaryBtn} w-full sm:w-auto`}
          >
            {changePinMut.isPending ? "Menyimpan…" : "Simpan PIN baru"}
          </button>
        </form>
      </section>

      <button
        type="button"
        disabled={loggingOut}
        onClick={async () => {
          setLoggingOut(true);
          await signOut();
        }}
        className="w-full rounded-xl border border-[var(--danger)] px-5 py-3 font-bold text-[var(--danger)] disabled:opacity-50"
      >
        {loggingOut ? "Keluar…" : "Keluar dari akun"}
      </button>
    </div>
  );
}
