import { useEffect, type ReactNode } from "react";
import type { ApiResponse } from "./api";
import type { api } from "./api";
import { fmtDate, rp } from "./lib";

export type Loan = ApiResponse<typeof api, "getLoan">["loan"];
export type Payment = ApiResponse<typeof api, "getLoan">["payments"][number];
export type PendingPayment =
  ApiResponse<typeof api, "getDashboard">["pendingPayments"][number];

export const PAYMENT_STATUS_LABEL: Record<Payment["status"], string> = {
  menunggu: "Menunggu konfirmasi",
  dikonfirmasi: "Dikonfirmasi",
  ditolak: "Ditolak",
};

export function PaymentStatusBadge({ status }: { status: Payment["status"] }) {
  if (status === "dikonfirmasi") return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold ${
        status === "menunggu"
          ? "bg-[var(--warn-soft)] text-[var(--warn)]"
          : "bg-[var(--danger-soft)] text-[var(--danger)]"
      }`}
    >
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}

export const STATUS_LABEL: Record<Loan["displayStatus"], string> = {
  menunggu: "Menunggu",
  aktif: "Aktif",
  terlambat: "Terlambat",
  lunas: "Lunas",
  ditolak: "Ditolak",
};

export function StatusBadge({ status }: { status: Loan["displayStatus"] }) {
  const styles: Record<Loan["displayStatus"], string> = {
    menunggu:
      "bg-[var(--warn-soft)] text-[var(--warn)]",
    aktif: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
    terlambat: "bg-[var(--danger-soft)] text-[var(--danger)]",
    lunas: "bg-[var(--ok-soft)] text-[var(--ok)]",
    ditolak: "bg-[var(--surface-2)] text-[var(--dim)]",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold ${styles[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function dueHint(loan: Loan): string {
  if (loan.displayStatus === "terlambat")
    return `Cicilan ke-${loan.currentInstallment} terlambat ${loan.daysLate} hari`;
  if (loan.displayStatus === "aktif") {
    if (loan.dueInDays === 0)
      return `Cicilan ke-${loan.currentInstallment} jatuh tempo hari ini`;
    if (loan.dueInDays === 1)
      return `Cicilan ke-${loan.currentInstallment} jatuh tempo besok`;
    return `Cicilan ke-${loan.currentInstallment} jatuh tempo ${loan.dueInDays} hari lagi`;
  }
  if (loan.displayStatus === "lunas") return "Sudah lunas";
  return "";
}

export function LoanRow({
  loan,
  onOpen,
}: {
  loan: Loan;
  onOpen: (id: number) => void;
}) {
  const showRemaining =
    loan.displayStatus === "aktif" || loan.displayStatus === "terlambat";
  return (
    <button
      type="button"
      onClick={() => onOpen(loan.id)}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
      aria-label={`Detail pinjaman ${loan.purpose} oleh ${loan.borrowerName}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-base font-extrabold text-[var(--accent-strong)]">
        {loan.borrowerName.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold text-[var(--text)]">
          {loan.purpose}
        </span>
        <span className="block truncate text-sm text-[var(--dim)]">
          {loan.borrowerName} · {loan.tenorMonths} bln · {rp(loan.monthlyPayment)}/bln
        </span>
        {showRemaining && loan.nextDueDate && (
          <span className="block text-sm font-semibold text-[var(--text)]">
            Cicilan ke-{loan.currentInstallment} dari {loan.tenorMonths} ·{" "}
            {fmtDate(loan.nextDueDate)} · Sisa {rp(loan.remaining)}
          </span>
        )}
        {loan.displayStatus === "terlambat" && (
          <span className="block text-sm font-semibold text-[var(--danger)]">
            Terlambat {loan.daysLate} hari
          </span>
        )}
        {loan.lateFee > 0 && (
          <span className="block text-sm font-semibold text-[var(--danger)]">
            Denda keterlambatan {rp(loan.lateFee)} · Total{" "}
            {rp(loan.totalOwed)}
          </span>
        )}
      </span>
      <StatusBadge status={loan.displayStatus} />
    </button>
  );
}

export function ProgressBar({ loan }: { loan: Loan }) {
  const pct =
    loan.totalDue > 0
      ? Math.min(100, Math.round((loan.paidTotal / loan.totalDue) * 100))
      : 0;
  return (
    <div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progres pembayaran"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-sm text-[var(--dim)]">
        Terbayar {rp(loan.paidTotal)} dari {rp(loan.totalDue)} ({pct}%)
      </p>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 pb-safe sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-[var(--text)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-lg text-[var(--dim)]"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-base text-[var(--text)]">{message}</p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 font-bold text-[var(--text)]"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`flex-1 rounded-xl px-4 py-2.5 font-bold text-white disabled:opacity-50 ${
            danger ? "bg-[var(--danger)]" : "bg-[var(--accent)]"
          }`}
        >
          {busy ? "Memproses…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="no-print fixed inset-x-0 bottom-24 z-[60] mx-auto w-fit max-w-[92vw] rounded-full bg-[var(--text)] px-5 py-2.5 text-sm font-semibold text-[var(--bg)] shadow-lg sm:bottom-8"
      role="status"
    >
      {message}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p
      className="rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger)]"
      role="alert"
    >
      {message}
    </p>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-bold text-[var(--text)]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--dim)]">{hint}</span>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-base text-[var(--text)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";

export const primaryBtn =
  "rounded-xl bg-[var(--accent)] px-5 py-2.5 font-bold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-lg font-extrabold tracking-tight text-[var(--text)]">
      {children}
    </h2>
  );
}
