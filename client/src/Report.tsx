import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Field, STATUS_LABEL, StatusBadge, inputCls } from "./components";
import { csvEscape, downloadCsv, fmtDate, rp, todayLocal } from "./lib";

export function Report({
  token,
  onOpenLoan,
  showToast,
}: {
  token: string;
  onOpenLoan: (id: number) => void;
  showToast: (msg: string) => void;
}) {
  const today = todayLocal();
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const report = useQuery({
    queryKey: ["report", today, from, to],
    queryFn: () => api.getReport({ token, today, from, to }),
  });

  const exportCsv = () => {
    if (!report.data) return;
    const header = [
      "Nama Peminjam",
      "Nomor Penerima",
      "Keperluan",
      "Tanggal Pengajuan",
      "Tanggal Mulai",
      "Tenor (bulan)",
      "Bunga (%/bulan)",
      "Total Bunga (Rp)",
      "Cicilan per Bulan (Rp)",
      "Jatuh Tempo Akhir",
      "Cicilan Berikutnya",
      "Status",
      "Pokok (Rp)",
      "Total Tagihan (Rp)",
      "Sudah Dibayar (Rp)",
      "Sisa (Rp)",
      "Denda Keterlambatan (Rp)",
      "Total Harus Dibayar (Rp)",
      "Hari Terlambat",
    ];
    const lines = report.data.rows.map((r) =>
      [
        r.borrowerName,
        r.phone,
        r.purpose,
        r.createdAt.slice(0, 10),
        r.startDate,
        r.tenorMonths,
        String(r.interestPercent).replace(".", ","),
        r.totalInterest,
        r.monthlyPayment,
        r.dueDate,
        r.nextDueDate ?? "",
        STATUS_LABEL[r.displayStatus],
        r.principal,
        r.totalDue,
        r.paidTotal,
        r.remaining,
        r.lateFee,
        r.totalOwed,
        r.daysLate,
      ]
        .map(csvEscape)
        .join(";"),
    );
    downloadCsv(
      `laporan-bantudana-${from || "awal"}-sd-${to || "sekarang"}.csv`,
      [header.map(csvEscape).join(";"), ...lines].join("\n"),
    );
    showToast("Laporan CSV diunduh.");
  };

  const copySummary = async () => {
    if (!report.data) return;
    const s = report.data.summary;
    const text = [
      `Laporan BantuDana — ${from ? fmtDate(from) : "awal"} s/d ${to ? fmtDate(to) : "sekarang"}`,
      `Jumlah pinjaman: ${s.loanCount}`,
      `Dana disalurkan (disetujui): ${rp(s.disbursed)}`,
      `Total tagihan (disetujui): ${rp(s.totalDueApproved)}`,
      `Pembayaran diterima pada periode: ${rp(s.collectedInRange)}`,
      `Sisa tagihan saat ini: ${rp(s.outstandingNow)}`,
      `Pinjaman terlambat saat ini: ${s.overdueNow}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Ringkasan disalin.");
    } catch {
      showToast("Gagal menyalin — peramban menolak akses clipboard.");
    }
  };

  const data = report.data;
  const s = data?.summary;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dari tanggal">
          <input
            aria-label="Tanggal mulai laporan"
            type="date"
            className={inputCls}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Sampai tanggal">
          <input
            aria-label="Tanggal akhir laporan"
            type="date"
            className={inputCls}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setFrom(firstOfMonth);
            setTo(today);
          }}
          className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-sm font-semibold text-[var(--dim)]"
        >
          Bulan ini
        </button>
        <button
          type="button"
          onClick={() => {
            setFrom("");
            setTo("");
          }}
          className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-sm font-semibold text-[var(--dim)]"
        >
          Semua waktu
        </button>
      </div>

      {report.isPending && (
        <p className="py-8 text-center text-[var(--dim)]">Memuat laporan…</p>
      )}
      {report.error && (
        <p className="py-8 text-center text-[var(--danger)]">
          Gagal memuat laporan. Coba lagi.
        </p>
      )}

      {s && data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <SummaryCard label="Pinjaman pada periode" value={String(s.loanCount)} />
            <SummaryCard label="Dana disalurkan" value={rp(s.disbursed)} />
            <SummaryCard label="Total tagihan" value={rp(s.totalDueApproved)} />
            <SummaryCard
              label="Pembayaran diterima (periode)"
              value={rp(s.collectedInRange)}
            />
            <SummaryCard label="Sisa tagihan saat ini" value={rp(s.outstandingNow)} />
            <SummaryCard
              label="Terlambat saat ini"
              value={`${s.overdueNow} pinjaman`}
              danger={s.overdueNow > 0}
            />
          </div>

          <div className="no-print flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={exportCsv}
              className="flex-1 rounded-xl bg-[var(--accent)] px-5 py-3 font-bold text-white"
            >
              Unduh laporan (CSV)
            </button>
            <button
              type="button"
              onClick={copySummary}
              className="flex-1 rounded-xl border border-[var(--border)] px-5 py-3 font-bold text-[var(--text)]"
            >
              Salin ringkasan
            </button>
          </div>

          <section>
            <h3 className="mb-2 text-lg font-extrabold">Rincian pinjaman</h3>
            {data.rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--dim)]">
                Tidak ada pinjaman pada rentang tanggal ini.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                {data.rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onOpenLoan(r.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)]"
                      aria-label={`Buka detail ${r.purpose}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">
                          {r.purpose} — {r.borrowerName}
                        </span>
                        <span className="block text-sm text-[var(--dim)]">
                          Pokok {rp(r.principal)} · {r.tenorMonths} bln ·{" "}
                          {rp(r.monthlyPayment)}/bln · Dibayar {rp(r.paidTotal)}{" "}
                          · Sisa {rp(r.remaining)} · Tempo akhir{" "}
                          {fmtDate(r.dueDate)}
                        </span>
                      </span>
                      <StatusBadge status={r.displayStatus} />
                    </button>
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

function SummaryCard({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-sm text-[var(--dim)]">{label}</p>
      <p
        className={`mt-1 text-xl font-extrabold tracking-tight ${
          danger ? "text-[var(--danger)]" : "text-[var(--text)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
