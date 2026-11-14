import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Account } from "./auth";
import {
ConfirmDialog,
ErrorBox,
Field,
Modal,
PaymentStatusBadge,
ProgressBar,
StatusBadge,
dueHint,
inputCls,
primaryBtn,
type Loan,
} from "./components";
import { LoanForm } from "./LoanForm";
import {
fmtDate,
fmtDateTime,
pct,
rp,
toDatetimeLocalValue,
waNumber,
} from "./lib";

const METHOD_LABEL: Record<string, string> = {
  tunai: "Tunai",
  transfer: "Transfer bank",
  ewallet: "E-wallet",
  lainnya: "Lainnya",
};

export function LoanDetail({
  id,
  today,
  token,
  account,
  onBack,
  showToast,
}: {
  id: number;
  today: string;
  token: string;
  account: Account;
  onBack: () => void;
  showToast: (msg: string) => void;
}) {
  const isAdmin = account.role === "admin";
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["loan", account.id, id, today],
    queryFn: () => api.getLoan({ token, id, today }),
  });
  // Pengaturan admin: bunga default & batas tenor untuk dialog persetujuan.
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings({ token }),
    enabled: isAdmin,
  });
  const appSettings = settingsQuery.data?.settings;
  const [showPay, setShowPay] = useState(false);
  const [showSubmitPay, setShowSubmitPay] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirm, setConfirm] = useState<
    | { kind: "approve" }
    | { kind: "reject" }
    | { kind: "deleteLoan" }
    | { kind: "deletePayment"; paymentId: number; amount: number }
    | { kind: "confirmPayment"; paymentId: number; amount: number }
    | { kind: "rejectPayment"; paymentId: number; amount: number }
    | { kind: "withdrawPayment"; paymentId: number; amount: number }
    | null
  >(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectPayReason, setRejectPayReason] = useState("");
  const [actionError, setActionError] = useState("");

  const refresh = () => queryClient.invalidateQueries();
  const fail = (e: unknown) =>
    setActionError(e instanceof Error ? e.message : String(e));

  const approveMut = useMutation({
    mutationFn: async (vars: { tenorMonths: number; interestPercent: number }) =>
      api.approveLoan({ token, id, ...vars }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      showToast("Pinjaman disetujui.");
    },
    onError: fail,
  });
  const rejectMut = useMutation({
    mutationFn: async () =>
      api.rejectLoan({ token, id, reason: rejectReason.trim() }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      showToast("Pinjaman ditolak.");
    },
    onError: fail,
  });
  const deleteLoanMut = useMutation({
    mutationFn: async () => api.deleteLoan({ token, id }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      showToast(isAdmin ? "Pinjaman dihapus." : "Pengajuan dibatalkan.");
      onBack();
    },
    onError: fail,
  });
  const deletePayMut = useMutation({
    mutationFn: async (paymentId: number) =>
      api.deletePayment({ token, paymentId, today }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      showToast("Catatan pembayaran dihapus.");
    },
    onError: fail,
  });
  const confirmPayMut = useMutation({
    mutationFn: async (paymentId: number) =>
      api.confirmPayment({ token, paymentId, today }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      showToast("Pembayaran dikonfirmasi — sisa tagihan berkurang.");
    },
    onError: fail,
  });
  const rejectPayMut = useMutation({
    mutationFn: async (paymentId: number) =>
      api.rejectPayment({
        token,
        paymentId,
        reason: rejectPayReason.trim(),
        today,
      }),
    onSuccess: () => {
      setConfirm(null);
      setRejectPayReason("");
      refresh();
      showToast("Pengajuan pembayaran ditolak.");
    },
    onError: fail,
  });
  const withdrawPayMut = useMutation({
    mutationFn: async (paymentId: number) =>
      api.withdrawPayment({ token, paymentId, today }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      showToast("Pengajuan pembayaran dibatalkan.");
    },
    onError: fail,
  });

  if (detail.isPending)
    return <p className="py-10 text-center text-[var(--dim)]">Memuat detail…</p>;
  if (detail.error || !detail.data)
    return (
      <div className="py-10 text-center">
        <p className="text-[var(--danger)]">
          Gagal memuat detail pinjaman. Coba lagi.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 rounded-xl border border-[var(--border)] px-4 py-2 font-bold"
        >
          Kembali
        </button>
      </div>
    );

  const { loan, payments, activity } = detail.data;
  const pendingPayments = payments.filter((p) => p.status === "menunggu");
  const pendingTotal = pendingPayments.reduce((s, p) => s + p.amount, 0);
  const wa = waNumber(loan.phone);
  const waText = encodeURIComponent(
    loan.displayStatus === "terlambat"
      ? `Halo ${loan.borrowerName}, mengingatkan cicilan ke-${loan.currentInstallment} dari ${loan.tenorMonths} untuk pinjaman "${loan.purpose}" sebesar ${rp(loan.nextInstallmentAmount)} sudah melewati jatuh tempo ${loan.nextDueDate ? fmtDate(loan.nextDueDate) : ""} (${loan.daysLate} hari).${loan.lateFee > 0 ? ` Denda keterlambatan ${rp(loan.lateFee)} (${pct(loan.lateFeePercentPerDay)}/hari).` : ""} Total yang harus dibayar ${rp(loan.totalOwed)}. Mohon segera dibayar. Terima kasih.`
      : `Halo ${loan.borrowerName}, mengingatkan cicilan ke-${loan.currentInstallment} dari ${loan.tenorMonths} untuk pinjaman "${loan.purpose}" sebesar ${rp(loan.nextInstallmentAmount)} jatuh tempo pada ${loan.nextDueDate ? fmtDate(loan.nextDueDate) : ""}. Sisa tagihan seluruhnya ${rp(loan.remaining)}. Terima kasih.`,
  );

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="font-bold text-[var(--accent-strong)]"
        aria-label="Kembali ke daftar"
      >
        ← Kembali
      </button>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">
              {loan.purpose}
            </h2>
            <p className="mt-0.5 text-base text-[var(--dim)]">
              {loan.borrowerName} · {loan.phone}
            </p>
          </div>
          <StatusBadge status={loan.displayStatus} />
        </div>

        <div className="mt-4">
          <ProgressBar loan={loan} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[var(--dim)]">Pokok pinjaman</dt>
            <dd className="text-base font-bold">{rp(loan.principal)}</dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Tenor</dt>
            <dd className="text-base font-bold">{loan.tenorMonths} bulan</dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Bunga</dt>
            <dd className="text-base font-bold">
              {pct(loan.interestPercent)}/bulan · {rp(loan.interestPerMonth)}/bln
            </dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Total bunga</dt>
            <dd className="text-base font-bold">{rp(loan.totalInterest)}</dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Cicilan per bulan</dt>
            <dd className="text-base font-bold">{rp(loan.monthlyPayment)}</dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Total harus dibayar</dt>
            <dd className="text-base font-bold">{rp(loan.totalDue)}</dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Sudah dibayar</dt>
            <dd className="text-base font-bold text-[var(--ok)]">
              {rp(loan.paidTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Sisa tagihan</dt>
            <dd className="text-base font-extrabold">{rp(loan.remaining)}</dd>
          </div>
          {loan.lateFee > 0 && (
            <>
              <div>
                <dt className="text-[var(--dim)]">
                  Denda keterlambatan ({pct(loan.lateFeePercentPerDay)}/hari)
                </dt>
                <dd className="text-base font-extrabold text-[var(--danger)]">
                  {rp(loan.lateFee)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dim)]">
                  Total harus dibayar (termasuk denda)
                </dt>
                <dd className="text-base font-extrabold">
                  {rp(loan.totalOwed)}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-[var(--dim)]">Tanggal mulai</dt>
            <dd className="text-base font-bold">{fmtDate(loan.startDate)}</dd>
          </div>
          {loan.nextDueDate && loan.remaining > 0 && (
            <div>
              <dt className="text-[var(--dim)]">
                Cicilan berikutnya (ke-{loan.currentInstallment} dari{" "}
                {loan.tenorMonths})
              </dt>
              <dd className="text-base font-bold">
                {rp(loan.nextInstallmentAmount)} · {fmtDate(loan.nextDueDate)}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--dim)]">Jatuh tempo akhir</dt>
            <dd className="text-base font-bold">{fmtDate(loan.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-[var(--dim)]">Diajukan</dt>
            <dd className="font-semibold">{fmtDateTime(loan.createdAt)}</dd>
          </div>
          {loan.decidedAt && (
            <div>
              <dt className="text-[var(--dim)]">Diputuskan</dt>
              <dd className="font-semibold">{fmtDateTime(loan.decidedAt)}</dd>
            </div>
          )}
          {dueHint(loan) && (
            <div>
              <dt className="text-[var(--dim)]">Status waktu</dt>
              <dd
                className={`font-bold ${
                  loan.displayStatus === "terlambat"
                    ? "text-[var(--danger)]"
                    : ""
                }`}
              >
                {dueHint(loan)}
              </dd>
            </div>
          )}
        </dl>

        {loan.note && (
          <p className="mt-4 rounded-xl bg-[var(--surface-2)] px-3.5 py-2.5 text-sm text-[var(--text)]">
            Catatan: {loan.note}
          </p>
        )}
      </div>

      <ErrorBox message={actionError} />

      {/* Aksi utama sesuai status & peran */}
      {loan.status === "menunggu" && isAdmin && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setConfirm({ kind: "approve" })}
            className="flex-1 rounded-xl bg-[var(--ok)] px-5 py-3 font-bold text-white"
          >
            ✓ Setujui pinjaman
          </button>
          <button
            type="button"
            onClick={() => setConfirm({ kind: "reject" })}
            className="flex-1 rounded-xl border border-[var(--danger)] px-5 py-3 font-bold text-[var(--danger)]"
          >
            Tolak
          </button>
        </div>
      )}

      {loan.status === "menunggu" && !isAdmin && (
        <p className="rounded-2xl bg-[var(--warn-soft)] px-4 py-3 text-sm font-semibold text-[var(--warn)]">
          Pengajuan ini menunggu persetujuan admin (pemberi pinjaman). Anda
          masih bisa mengubah atau membatalkannya di bawah.
        </p>
      )}

      {loan.status === "disetujui" && loan.remaining > 0 && isAdmin && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setShowPay(true)}
            className={`${primaryBtn} flex-1 py-3 text-center`}
          >
            + Catat pembayaran
          </button>
          <a
            href={`https://wa.me/${wa}?text=${waText}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-xl border border-[var(--border)] px-5 py-3 text-center font-bold text-[var(--text)]"
          >
            Ingatkan via WhatsApp
          </a>
        </div>
      )}

      {loan.status === "disetujui" && loan.remaining > 0 && !isAdmin && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text)]">
            Cicilan berikutnya (ke-{loan.currentInstallment} dari{" "}
            {loan.tenorMonths}) sebesar{" "}
            <strong>{rp(loan.nextInstallmentAmount)}</strong> — bayar sebelum{" "}
            <strong>
              {loan.nextDueDate ? fmtDate(loan.nextDueDate) : fmtDate(loan.dueDate)}
            </strong>
            . Bayar ke rekening / e-wallet admin (atau tunai), lalu ajukan
            pembayaran lewat tombol di bawah supaya tercatat. Sisa tagihan
            berkurang setelah admin mengonfirmasi pembayaran Anda.
            {pendingPayments.length > 0 && (
              <span className="mt-1 block font-semibold text-[var(--warn)]">
                {pendingPayments.length} pembayaran sebesar {rp(pendingTotal)}{" "}
                sedang menunggu konfirmasi admin.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowSubmitPay(true)}
            className={`${primaryBtn} w-full py-3 text-center`}
          >
            Bayar cicilan ke-{loan.currentInstallment} ·{" "}
            {rp(loan.nextInstallmentAmount)}
          </button>
        </div>
      )}

      {(isAdmin || loan.status === "menunggu") && (
        <div className="flex gap-3">
          {loan.status !== "ditolak" && (
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="rounded-xl border border-[var(--border)] px-4 py-2 font-bold text-[var(--text)]"
            >
              {isAdmin ? "Ubah data" : "Ubah pengajuan"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirm({ kind: "deleteLoan" })}
            className="rounded-xl border border-[var(--border)] px-4 py-2 font-bold text-[var(--danger)]"
          >
            {isAdmin ? "Hapus pinjaman" : "Batalkan pengajuan"}
          </button>
        </div>
      )}

      {/* Jadwal cicilan */}
      <section>
        <h3 className="mb-2 text-lg font-extrabold">
          Jadwal cicilan · {loan.paidInstallments} dari {loan.tenorMonths} lunas
        </h3>
        <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          {loan.installments.map((inst) => (
            <li
              key={inst.index}
              className="flex items-center gap-3 px-4 py-3"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                  inst.status === "lunas"
                    ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                    : inst.status === "terlambat"
                      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                      : "bg-[var(--surface-2)] text-[var(--dim)]"
                }`}
              >
                {inst.index}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">
                  Cicilan ke-{inst.index} · {rp(inst.amount)}
                </span>
                <span className="block text-sm text-[var(--dim)]">
                  Jatuh tempo {fmtDate(inst.dueDate)}
                  {inst.paidAmount > 0 && inst.remainingAmount > 0
                    ? ` · terbayar ${rp(inst.paidAmount)}, sisa ${rp(inst.remainingAmount)}`
                    : ""}
                </span>
                {inst.lateFee > 0 && (
                  <span className="block text-sm font-semibold text-[var(--danger)]">
                    Denda {rp(inst.lateFee)} · terlambat {inst.lateDays} hari
                    × {pct(loan.lateFeePercentPerDay)}/hari
                    {inst.status === "lunas"
                      ? " (sudah berhenti saat cicilan dibayar)"
                      : ""}
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                  inst.status === "lunas"
                    ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                    : inst.status === "terlambat"
                      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                      : inst.status === "berjalan"
                        ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "bg-[var(--surface-2)] text-[var(--dim)]"
                }`}
              >
                {inst.status === "lunas"
                  ? "Lunas"
                  : inst.status === "terlambat"
                    ? "Terlambat"
                    : inst.status === "berjalan"
                      ? "Berjalan"
                      : "Menunggu"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Pengajuan pembayaran dari peminjam yang menunggu keputusan admin */}
      {isAdmin && pendingPayments.length > 0 && (
        <section>
          <h3 className="mb-2 text-lg font-extrabold">
            Pembayaran menunggu konfirmasi
          </h3>
          <ul className="space-y-3">
            {pendingPayments.map((p) => (
              <li
                key={p.id}
                className="rounded-2xl border border-[var(--warn)] bg-[var(--warn-soft)] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-extrabold">{rp(p.amount)}</p>
                    <p className="text-sm text-[var(--dim)]">
                      Diajukan {loan.borrowerName} · {fmtDateTime(p.paidAt)} ·{" "}
                      {METHOD_LABEL[p.method] ?? p.method}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--dim)]">
                      Sisa tagihan belum berubah — berkurang setelah Anda
                      mengonfirmasi.
                    </p>
                  </div>
                  <PaymentStatusBadge status={p.status} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setConfirm({
                        kind: "confirmPayment",
                        paymentId: p.id,
                        amount: p.amount,
                      })
                    }
                    className="flex-1 rounded-xl bg-[var(--ok)] px-4 py-2.5 font-bold text-white"
                  >
                    ✓ Konfirmasi diterima
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectPayReason("");
                      setConfirm({
                        kind: "rejectPayment",
                        paymentId: p.id,
                        amount: p.amount,
                      });
                    }}
                    className="flex-1 rounded-xl border border-[var(--danger)] bg-[var(--surface)] px-4 py-2.5 font-bold text-[var(--danger)]"
                  >
                    Tolak
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Riwayat pembayaran */}
      <section>
        <h3 className="mb-2 text-lg font-extrabold">Riwayat pembayaran</h3>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-5 text-center text-sm text-[var(--dim)]">
            Belum ada pembayaran tercatat.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-bold ${
                      p.status === "dikonfirmasi"
                        ? "text-[var(--ok)]"
                        : "text-[var(--text)]"
                    }`}
                  >
                    {rp(p.amount)}
                  </p>
                  <p className="truncate text-sm text-[var(--dim)]">
                    {fmtDateTime(p.paidAt)} · {METHOD_LABEL[p.method] ?? p.method}
                    {p.submittedByAccountId != null
                      ? " · diajukan peminjam"
                      : " · dicatat admin"}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                </div>
                <PaymentStatusBadge status={p.status} />
                {isAdmin && p.status === "dikonfirmasi" && (
                  <button
                    type="button"
                    aria-label={`Hapus pembayaran ${rp(p.amount)}`}
                    onClick={() =>
                      setConfirm({
                        kind: "deletePayment",
                        paymentId: p.id,
                        amount: p.amount,
                      })
                    }
                    className="rounded-lg px-2.5 py-1.5 text-sm font-bold text-[var(--danger)]"
                  >
                    Hapus
                  </button>
                )}
                {!isAdmin &&
                  p.status === "menunggu" &&
                  p.submittedByAccountId === account.id && (
                    <button
                      type="button"
                      aria-label={`Batalkan pengajuan pembayaran ${rp(p.amount)}`}
                      onClick={() =>
                        setConfirm({
                          kind: "withdrawPayment",
                          paymentId: p.id,
                          amount: p.amount,
                        })
                      }
                      className="rounded-lg px-2.5 py-1.5 text-sm font-bold text-[var(--danger)]"
                    >
                      Batalkan
                    </button>
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Jejak aktivitas */}
      <section>
        <h3 className="mb-2 text-lg font-extrabold">Jejak aktivitas</h3>
        <ul className="space-y-2.5">
          {activity.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
              <span>
                <span className="text-[var(--text)]">{a.description}</span>
                <span className="block text-xs text-[var(--dim)]">
                  {fmtDateTime(a.createdAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {showPay && (
        <PaymentModal
          loan={loan}
          today={today}
          token={token}
          onClose={() => setShowPay(false)}
          onDone={() => {
            setShowPay(false);
            refresh();
            showToast("Pembayaran tercatat.");
          }}
        />
      )}

      {showSubmitPay && (
        <SubmitPaymentModal
          loan={loan}
          pendingTotal={pendingTotal}
          today={today}
          token={token}
          onClose={() => setShowSubmitPay(false)}
          onDone={() => {
            setShowSubmitPay(false);
            refresh();
            showToast(
              "Pembayaran diajukan — menunggu konfirmasi admin. Sisa tagihan berkurang setelah dikonfirmasi.",
            );
          }}
        />
      )}

      {showEdit && (
        <Modal
          title={isAdmin ? "Ubah data pinjaman" : "Ubah pengajuan"}
          onClose={() => setShowEdit(false)}
        >
          <LoanForm
            initial={loan}
            account={account}
            onDone={() => {
              setShowEdit(false);
              refresh();
              showToast("Data pinjaman diperbarui.");
            }}
            onCancel={() => setShowEdit(false)}
          />
        </Modal>
      )}

      {confirm?.kind === "approve" && (
        <ApproveModal
          loan={loan}
          defaultInterestPercent={appSettings?.defaultInterestPercent}
          minTenorMonths={appSettings?.minTenorMonths ?? 1}
          maxTenorMonths={appSettings?.maxTenorMonths ?? 36}
          busy={approveMut.isPending}
          onConfirm={(tenorMonths, interestPercent) =>
            approveMut.mutate({ tenorMonths, interestPercent })
          }
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "reject" && (
        <Modal title="Tolak pinjaman?" onClose={() => setConfirm(null)}>
          <Field label="Alasan penolakan (opsional)">
            <input
              aria-label="Alasan penolakan"
              className={inputCls}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="cth. Riwayat pembayaran kurang baik"
            />
          </Field>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 font-bold"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={rejectMut.isPending}
              onClick={() => rejectMut.mutate()}
              className="flex-1 rounded-xl bg-[var(--danger)] px-4 py-2.5 font-bold text-white disabled:opacity-50"
            >
              {rejectMut.isPending ? "Memproses…" : "Ya, tolak"}
            </button>
          </div>
        </Modal>
      )}
      {confirm?.kind === "deleteLoan" && (
        <ConfirmDialog
          title={isAdmin ? "Hapus pinjaman?" : "Batalkan pengajuan?"}
          message={
            isAdmin
              ? `Pinjaman "${loan.purpose}" milik ${loan.borrowerName} beserta seluruh riwayat pembayaran dan aktivitasnya akan dihapus permanen dan tidak bisa dikembalikan.`
              : `Pengajuan "${loan.purpose}" akan dibatalkan dan dihapus permanen.`
          }
          confirmLabel={isAdmin ? "Ya, hapus permanen" : "Ya, batalkan"}
          danger
          busy={deleteLoanMut.isPending}
          onConfirm={() => deleteLoanMut.mutate()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "deletePayment" && (
        <ConfirmDialog
          title="Hapus catatan pembayaran?"
          message={`Pembayaran sebesar ${rp(confirm.amount)} akan dihapus dan sisa tagihan bertambah kembali. Gunakan hanya untuk mengoreksi kesalahan pencatatan.`}
          confirmLabel="Ya, hapus"
          danger
          busy={deletePayMut.isPending}
          onConfirm={() => deletePayMut.mutate(confirm.paymentId)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "confirmPayment" && (
        <ConfirmDialog
          title="Konfirmasi pembayaran ini?"
          message={`Pembayaran ${rp(confirm.amount)} dari ${loan.borrowerName} dinyatakan diterima. Setelah dikonfirmasi, sisa tagihan berkurang sebesar jumlah ini dan cicilan teralokasi otomatis.`}
          confirmLabel="Ya, konfirmasi"
          busy={confirmPayMut.isPending}
          onConfirm={() => confirmPayMut.mutate(confirm.paymentId)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "rejectPayment" && (
        <Modal title="Tolak pembayaran ini?" onClose={() => setConfirm(null)}>
          <p className="text-sm text-[var(--dim)]">
            Pembayaran {rp(confirm.amount)} dari {loan.borrowerName} ditolak —
            misalnya karena dana belum masuk atau bukti tidak sesuai. Sisa
            tagihan tidak berubah dan peminjam dapat mengajukan ulang.
          </p>
          <div className="mt-4">
            <Field label="Alasan penolakan (opsional)">
              <input
                aria-label="Alasan penolakan pembayaran"
                className={inputCls}
                value={rejectPayReason}
                onChange={(e) => setRejectPayReason(e.target.value)}
                placeholder="cth. Transfer belum masuk ke rekening"
              />
            </Field>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 font-bold"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={rejectPayMut.isPending}
              onClick={() => rejectPayMut.mutate(confirm.paymentId)}
              className="flex-1 rounded-xl bg-[var(--danger)] px-4 py-2.5 font-bold text-white disabled:opacity-50"
            >
              {rejectPayMut.isPending ? "Memproses…" : "Ya, tolak"}
            </button>
          </div>
        </Modal>
      )}
      {confirm?.kind === "withdrawPayment" && (
        <ConfirmDialog
          title="Batalkan pengajuan pembayaran?"
          message={`Pengajuan pembayaran ${rp(confirm.amount)} yang masih menunggu konfirmasi akan dibatalkan dan dihapus dari riwayat. Anda dapat mengajukan pembayaran baru setelahnya.`}
          confirmLabel="Ya, batalkan"
          danger
          busy={withdrawPayMut.isPending}
          onConfirm={() => withdrawPayMut.mutate(confirm.paymentId)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function ApproveModal({
  loan,
  defaultInterestPercent,
  minTenorMonths,
  maxTenorMonths,
  busy,
  onConfirm,
  onCancel,
}: {
  loan: Loan;
  defaultInterestPercent?: number;
  minTenorMonths: number;
  maxTenorMonths: number;
  busy: boolean;
  onConfirm: (tenorMonths: number, interestPercent: number) => void;
  onCancel: () => void;
}) {
  const [tenorStr, setTenorStr] = useState(String(loan.tenorMonths));
  // Bunga final terisi dari bunga default Pengaturan bila pinjaman belum
  // punya bunga; admin masih bisa menyesuaikannya untuk pinjaman ini.
  const [interestStr, setInterestStr] = useState(
    String(
      loan.interestPercent !== 0
        ? loan.interestPercent
        : (defaultInterestPercent ?? loan.interestPercent),
    ).replace(".", ","),
  );
  const [interestTouched, setInterestTouched] = useState(false);
  useEffect(() => {
    if (
      !interestTouched &&
      loan.interestPercent === 0 &&
      defaultInterestPercent != null
    ) {
      setInterestStr(String(defaultInterestPercent).replace(".", ","));
    }
  }, [defaultInterestPercent, interestTouched, loan.interestPercent]);
  const [error, setError] = useState("");
  const tenor = Number(tenorStr.replace(/\D/g, "")) || 0;
  const interest = Number(interestStr.replace(",", ".")) || 0;
  const totalInterest =
    tenor >= 1 ? Math.round((loan.principal * interest * tenor) / 100) : 0;
  const totalDue = loan.principal + totalInterest;
  const monthly = tenor > 1 ? Math.round(totalDue / tenor) : totalDue;
  const changed =
    tenor !== loan.tenorMonths || interest !== loan.interestPercent;

  return (
    <Modal title="Setujui pinjaman?" onClose={onCancel}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          if (tenor < minTenorMonths || tenor > maxTenorMonths)
            return setError(
              `Tenor final harus antara ${minTenorMonths} dan ${maxTenorMonths} bulan (Pengaturan).`,
            );
          if (interest < 0 || interest > 20)
            return setError("Bunga final harus antara 0% dan 20% per bulan.");
          onConfirm(tenor, interest);
        }}
      >
        <p className="text-sm text-[var(--dim)]">
          {loan.borrowerName} — {loan.purpose}. Peminjam mengusulkan tenor{" "}
          {loan.tenorMonths} bulan. Bunga final terisi dari bunga default di
          menu Pengaturan — sesuaikan untuk pinjaman ini bila perlu (dan
          tenor final bila perlu); total dihitung ulang oleh server.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tenor final (bulan)">
            <input
              aria-label="Tenor final dalam bulan"
              className={inputCls}
              value={tenorStr}
              onChange={(e) => setTenorStr(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Bunga final (%/bulan)">
            <input
              aria-label="Bunga final persen per bulan"
              className={inputCls}
              value={interestStr}
              onChange={(e) => {
                setInterestTouched(true);
                setInterestStr(e.target.value);
              }}
              inputMode="decimal"
            />
          </Field>
        </div>
        {tenor >= 1 && (
          <div className="rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-sm">
            <div className="flex justify-between py-0.5">
              <span className="text-[var(--dim)]">Pokok</span>
              <span className="font-bold">{rp(loan.principal)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-[var(--dim)]">Total bunga</span>
              <span className="font-bold">{rp(totalInterest)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-[var(--dim)]">Cicilan per bulan</span>
              <span className="font-bold">{rp(monthly)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-2">
              <span className="font-bold">Total harus dibayar</span>
              <span className="font-extrabold text-[var(--accent-strong)]">
                {rp(totalDue)}
              </span>
            </div>
            {changed && (
              <p className="mt-2 text-xs font-semibold text-[var(--warn)]">
                Syarat final berbeda dari data pengajuan saat ini — pastikan
                peminjam sudah menyepakatinya.
              </p>
            )}
          </div>
        )}
        <ErrorBox message={error} />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 font-bold"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-xl bg-[var(--ok)] px-4 py-2.5 font-bold text-white disabled:opacity-50"
          >
            {busy ? "Memproses…" : "Ya, setujui"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Form bayar cicilan untuk PEMINJAM: mengajukan pembayaran untuk cicilan
 * berikutnya. Pengajuan masuk status "Menunggu konfirmasi" — sisa tagihan
 * baru berkurang setelah admin mengonfirmasi (lihat confirmPayment).
 */
function SubmitPaymentModal({
  loan,
  pendingTotal,
  today,
  token,
  onClose,
  onDone,
}: {
  loan: Loan;
  pendingTotal: number;
  today: string;
  token: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const available = Math.max(0, loan.remaining - pendingTotal);
  const defaultAmount = Math.min(loan.nextInstallmentAmount, available);
  const [amountStr, setAmountStr] = useState(String(defaultAmount));
  const [method, setMethod] = useState<"tunai" | "transfer" | "ewallet" | "lainnya">("transfer");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(toDatetimeLocalValue(new Date()));
  const [error, setError] = useState("");
  const amount = Number(amountStr.replace(/\D/g, "")) || 0;

  const mut = useMutation({
    mutationFn: async () =>
      api.submitPayment({
        token,
        loanId: loan.id,
        amount,
        method,
        note: note.trim(),
        paidAt: new Date(when).toISOString(),
        today,
      }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal title="Bayar cicilan" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          if (amount <= 0) return setError("Jumlah pembayaran wajib diisi.");
          if (amount > available)
            return setError(
              pendingTotal > 0
                ? `Jumlah melebihi sisa yang bisa diajukan (${rp(available)}) — Rp${pendingTotal.toLocaleString("id-ID")} sedang menunggu konfirmasi admin.`
                : `Jumlah melebihi sisa tagihan (${rp(loan.remaining)}).`,
            );
          mut.mutate();
        }}
      >
        <p className="rounded-xl bg-[var(--surface-2)] px-3.5 py-2.5 text-sm">
          Cicilan ke-{loan.currentInstallment} dari {loan.tenorMonths}:{" "}
          <strong>{rp(loan.nextInstallmentAmount)}</strong>
          {loan.nextDueDate ? ` · tempo ${fmtDate(loan.nextDueDate)}` : ""} ·
          Sisa seluruh tagihan <strong>{rp(loan.remaining)}</strong>
        </p>
        <p className="rounded-xl bg-[var(--warn-soft)] px-3.5 py-2.5 text-sm font-semibold text-[var(--warn)]">
          Bayar dulu ke admin (transfer / e-wallet / tunai), lalu ajukan di
          sini. Statusnya "Menunggu konfirmasi" — sisa tagihan berkurang
          setelah admin mengonfirmasi pembayaran Anda.
        </p>
        <Field label="Jumlah yang sudah dibayar (Rp)">
          <input
            aria-label="Jumlah pembayaran cicilan"
            className={inputCls}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            inputMode="numeric"
            placeholder="cth. 500000"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAmountStr(String(defaultAmount))}
            className="rounded-full bg-[var(--accent-soft)] px-3.5 py-1.5 text-sm font-bold text-[var(--accent-strong)]"
          >
            Bayar cicilan ini ({rp(defaultAmount)})
          </button>
          <button
            type="button"
            onClick={() => setAmountStr(String(available))}
            className="rounded-full bg-[var(--accent-soft)] px-3.5 py-1.5 text-sm font-bold text-[var(--accent-strong)]"
          >
            Bayar lunas ({rp(available)})
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Metode bayar">
            <select
              aria-label="Metode pembayaran cicilan"
              className={inputCls}
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
            >
              <option value="transfer">Transfer bank</option>
              <option value="ewallet">E-wallet</option>
              <option value="tunai">Tunai</option>
              <option value="lainnya">Lainnya</option>
            </select>
          </Field>
          <Field label="Tanggal & jam bayar">
            <input
              aria-label="Tanggal dan jam pembayaran cicilan"
              type="datetime-local"
              className={inputCls}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Catatan (opsional)"
          hint="cth. nama bank pengirim atau nomor referensi transfer — membantu admin mencocokkan."
        >
          <input
            aria-label="Catatan pembayaran cicilan"
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="cth. Transfer BCA a.n. Sari"
          />
        </Field>
        <ErrorBox message={error} />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-5 py-2.5 font-bold"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={mut.isPending}
            className={`${primaryBtn} flex-1`}
          >
            {mut.isPending ? "Mengajukan…" : "Ajukan pembayaran"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({
  loan,
  today,
  token,
  onClose,
  onDone,
}: {
  loan: Loan;
  today: string;
  token: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amountStr, setAmountStr] = useState(
    String(loan.nextInstallmentAmount || loan.remaining),
  );
  const [method, setMethod] = useState<"tunai" | "transfer" | "ewallet" | "lainnya">("tunai");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(toDatetimeLocalValue(new Date()));
  const [error, setError] = useState("");
  const amount = Number(amountStr.replace(/\D/g, "")) || 0;

  const mut = useMutation({
    mutationFn: async () =>
      api.recordPayment({
        token,
        loanId: loan.id,
        amount,
        method,
        note: note.trim(),
        paidAt: new Date(when).toISOString(),
        today,
      }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal title="Catat pembayaran" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          if (amount <= 0) return setError("Jumlah pembayaran wajib diisi.");
          if (amount > loan.remaining)
            return setError(
              `Jumlah melebihi sisa tagihan (${rp(loan.remaining)}).`,
            );
          mut.mutate();
        }}
      >
        <p className="rounded-xl bg-[var(--surface-2)] px-3.5 py-2.5 text-sm">
          Cicilan ke-{loan.currentInstallment} dari {loan.tenorMonths}{" "}
          {loan.borrowerName}:{" "}
          <strong>{rp(loan.nextInstallmentAmount)}</strong>
          {loan.nextDueDate ? ` · tempo ${fmtDate(loan.nextDueDate)}` : ""} ·
          Sisa seluruh tagihan <strong>{rp(loan.remaining)}</strong>
        </p>
        <Field label="Jumlah pembayaran (Rp)">
          <input
            aria-label="Jumlah pembayaran"
            className={inputCls}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            inputMode="numeric"
            placeholder="cth. 500000"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAmountStr(String(loan.nextInstallmentAmount))}
            className="rounded-full bg-[var(--accent-soft)] px-3.5 py-1.5 text-sm font-bold text-[var(--accent-strong)]"
          >
            Bayar cicilan ini ({rp(loan.nextInstallmentAmount)})
          </button>
          <button
            type="button"
            onClick={() => setAmountStr(String(loan.remaining))}
            className="rounded-full bg-[var(--accent-soft)] px-3.5 py-1.5 text-sm font-bold text-[var(--accent-strong)]"
          >
            Bayar lunas ({rp(loan.remaining)})
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Metode">
            <select
              aria-label="Metode pembayaran"
              className={inputCls}
              value={method}
              onChange={(e) =>
                setMethod(e.target.value as typeof method)
              }
            >
              <option value="tunai">Tunai</option>
              <option value="transfer">Transfer bank</option>
              <option value="ewallet">E-wallet</option>
              <option value="lainnya">Lainnya</option>
            </select>
          </Field>
          <Field label="Tanggal & jam bayar">
            <input
              aria-label="Tanggal dan jam pembayaran"
              type="datetime-local"
              className={inputCls}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Catatan (opsional)">
          <input
            aria-label="Catatan pembayaran"
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="cth. Cicilan ke-1"
          />
        </Field>
        <ErrorBox message={error} />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-5 py-2.5 font-bold"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={mut.isPending}
            className={`${primaryBtn} flex-1`}
          >
            {mut.isPending ? "Menyimpan…" : "Simpan pembayaran"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
