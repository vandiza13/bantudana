import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth, type Account } from "./auth";
import { ErrorBox, Field, inputCls, primaryBtn, type Loan } from "./components";
import { addMonths, fmtDate, pct, rp, todayLocal } from "./lib";

// Cadangan selama Pengaturan belum termuat — sama dengan nilai bawaan server.
const FALLBACK_NOMINAL = [
  500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000, 4_000_000,
  5_000_000,
];
const FALLBACK_TENOR = [1, 3, 6, 12];
const FALLBACK_INTEREST = 2; // bunga default %/bulan dari Pengaturan

/** Hitungan flat %/bulan — cerminan rumus server untuk pratinjau form. */
function previewTerms(principal: number, interestPercent: number, tenor: number) {
  const interestPerMonth = Math.round((principal * interestPercent) / 100);
  const totalInterest = Math.round((principal * interestPercent * tenor) / 100);
  const totalDue = principal + totalInterest;
  const monthlyPayment = tenor > 1 ? Math.round(totalDue / tenor) : totalDue;
  return { interestPerMonth, totalInterest, totalDue, monthlyPayment };
}

/**
 * Form pinjaman. Dua pemakaian:
 * - Pengajuan baru: HANYA peminjam (user). Admin tidak punya form ini —
 *   admin tidak meminjam; admin mengatur ketentuan di menu Pengaturan.
 * - Ubah data: admin (pinjaman siapa pun) atau peminjam (pengajuannya
 *   sendiri yang masih menunggu).
 * Form ini TIDAK punya kolom bunga untuk siapa pun: bunga diatur admin
 * di menu Pengaturan dan ditetapkan final saat persetujuan. Tapi bunga
 * default dari Pengaturan DITAMPILKAN TERBUKA di form ini (bukan
 * "ditentukan admin"): peminjam melihat persennya dan pratinjau total
 * tagihan & cicilan dihitung dengan bunga itu. Pilihan nominal/tenor
 * serta batasnya juga mengikuti Pengaturan admin.
 */
export function LoanForm({
  initial,
  account,
  onDone,
  onCancel,
}: {
  initial?: Loan;
  account: Account;
  onDone: (id: number) => void;
  onCancel: () => void;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = account.role === "admin";
  const today = todayLocal();
  const startDate = initial?.startDate ?? today;

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings({ token: token ?? "" }),
    enabled: !!token,
  });
  const settings = settingsQuery.data?.settings;
  const nominalOptions = settings?.nominalOptions ?? FALLBACK_NOMINAL;
  const tenorOptions = settings?.tenorOptions ?? FALLBACK_TENOR;
  const minPrincipal = settings?.minPrincipal ?? 50_000;
  const maxPrincipal = settings?.maxPrincipal ?? 100_000_000;
  const minTenor = settings?.minTenorMonths ?? 1;
  const maxTenor = settings?.maxTenorMonths ?? 36;
  const defaultInterest =
    settings?.defaultInterestPercent ?? FALLBACK_INTEREST;
  const lateFeePerDay = settings?.lateFeePercentPerDay ?? 0.1;

  const [borrowerName, setBorrowerName] = useState(
    initial?.borrowerName ?? account.name,
  );
  const [phone, setPhone] = useState(initial?.phone ?? account.phone);
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [principal, setPrincipal] = useState<number | null>(
    initial?.principal ?? null,
  );
  const [customNominal, setCustomNominal] = useState("");
  // null = belum memilih → memakai tenor default dari Pengaturan.
  const [tenorPick, setTenorPick] = useState<number | null>(
    initial?.tenorMonths ?? null,
  );
  const [customTenor, setCustomTenor] = useState("");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");

  const effectivePrincipal = useMemo(() => {
    if (principal != null) return principal;
    const n = Number(customNominal.replace(/\D/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [principal, customNominal]);

  const effectiveTenor = useMemo(() => {
    const custom = Number(customTenor.replace(/\D/g, ""));
    if (customTenor.trim() && Number.isFinite(custom)) return custom;
    return tenorPick ?? settings?.defaultTenorMonths ?? 3;
  }, [customTenor, tenorPick, settings]);

  // Bunga tidak pernah DIISI dari form ini (hanya admin yang mengatur,
  // lewat Pengaturan/persetujuan), tapi nilainya selalu DITAMPILKAN
  // terbuka dan dipakai untuk pratinjau hitungan:
  // - pengajuan baru & pengajuan menunggu yang bunganya belum
  //   ditetapkan (tersimpan 0): bunga default dari Pengaturan admin;
  // - pinjaman yang sudah punya bunga final: bunga tersimpan itu.
  const storedInterest = initial?.interestPercent ?? 0;
  const usesDefaultInterest =
    !initial || (initial.status === "menunggu" && storedInterest === 0);
  const effectiveInterest = usesDefaultInterest
    ? defaultInterest
    : storedInterest;
  const terms = previewTerms(
    effectivePrincipal,
    effectiveInterest,
    effectiveTenor || 1,
  );
  const finalDue = effectiveTenor >= 1 ? addMonths(startDate, effectiveTenor) : "";

  // Jadwal ringkas untuk pratinjau: semua cicilan bila ≤ 6, selain itu
  // tampilkan 3 pertama + terakhir supaya form tetap ringkas.
  const schedulePreview = useMemo(() => {
    if (effectivePrincipal <= 0 || effectiveTenor < 1) return [];
    const rows: { index: number; dueDate: string; amount: number }[] = [];
    let allocated = 0;
    for (let i = 1; i <= effectiveTenor; i++) {
      const amount =
        i < effectiveTenor ? terms.monthlyPayment : terms.totalDue - allocated;
      allocated += amount;
      rows.push({ index: i, dueDate: addMonths(startDate, i), amount });
    }
    if (rows.length <= 6) return rows;
    return [...rows.slice(0, 3), ...rows.slice(-1)];
  }, [effectivePrincipal, effectiveTenor, terms, startDate]);
  const scheduleTruncated = effectiveTenor > 6;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        token: token ?? "",
        borrowerName: borrowerName.trim(),
        phone: phone.trim(),
        purpose: purpose.trim(),
        principal: effectivePrincipal,
        tenorMonths: effectiveTenor,
        // Bunga tidak diatur dari form — server mengabaikan nilai kiriman
        // ini: pengajuan baru memakai bunga default Pengaturan admin,
        // ubah data mempertahankan bunga tersimpan.
        interestPercent: effectiveInterest,
        note: note.trim(),
      };
      if (initial) {
        await api.updateLoan({ id: initial.id, ...payload });
        return initial.id;
      }
      const res = await api.createLoan({ ...payload, startDate });
      return res.id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries();
      onDone(id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = () => {
    setError("");
    if (isAdmin && borrowerName.trim().length < 2)
      return setError("Nama peminjam minimal 2 karakter.");
    if (isAdmin && phone.replace(/\D/g, "").length < 8)
      return setError("Nomor penerima minimal 8 digit angka.");
    if (purpose.trim().length < 2)
      return setError("Keperluan pinjaman wajib diisi.");
    if (effectivePrincipal < minPrincipal || effectivePrincipal > maxPrincipal)
      return setError(
        `Nominal pinjaman harus antara ${rp(minPrincipal)} dan ${rp(maxPrincipal)}.`,
      );
    if (effectiveTenor < minTenor || effectiveTenor > maxTenor)
      return setError(
        `Tenor harus antara ${minTenor} dan ${maxTenor} bulan.`,
      );
    mutation.mutate();
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!initial && (
        <div className="rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm">
          Pengajuan atas nama{" "}
          <strong>
            {account.name} · {account.phone}
          </strong>
          . Nama dan nomor mengikuti akun Anda dan tidak bisa diubah di sini.
        </div>
      )}

      {initial && isAdmin && (
        <>
          <Field label="Nama peminjam">
            <input
              aria-label="Nama peminjam"
              className={inputCls}
              value={borrowerName}
              onChange={(e) => setBorrowerName(e.target.value)}
              placeholder="cth. Budi Santoso"
              autoComplete="name"
            />
          </Field>

          <Field
            label="Nomor penerima (HP / WhatsApp)"
            hint="Dipakai untuk tombol pengingat WhatsApp di halaman detail."
          >
            <input
              aria-label="Nomor penerima"
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="cth. 0812 3456 7890"
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
        </>
      )}

      <Field label="Keperluan pinjaman">
        <input
          aria-label="Keperluan pinjaman"
          className={inputCls}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="cth. Perbaikan motor"
        />
      </Field>

      <Field
        label="Nominal pinjaman (pokok)"
        hint={`Antara ${rp(minPrincipal)} dan ${rp(maxPrincipal)} — diatur admin di Pengaturan.`}
      >
        <div className="flex flex-wrap gap-2">
          {nominalOptions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setPrincipal(n);
                setCustomNominal("");
              }}
              aria-pressed={principal === n}
              className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                principal === n
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)]"
              }`}
            >
              {rp(n)}
            </button>
          ))}
        </div>
        <input
          aria-label="Nominal lain (rupiah)"
          className={`${inputCls} mt-3`}
          value={customNominal}
          onChange={(e) => {
            setCustomNominal(e.target.value);
            setPrincipal(null);
          }}
          placeholder="atau ketik nominal lain, cth. 750000"
          inputMode="numeric"
        />
      </Field>

      <Field
        label="Tenor (bulan)"
        hint={`Antara ${minTenor} dan ${maxTenor} bulan — diatur admin di Pengaturan.`}
      >
        <div className="flex flex-wrap gap-2">
          {tenorOptions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTenorPick(t);
                setCustomTenor("");
              }}
              aria-pressed={!customTenor && effectiveTenor === t}
              className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                !customTenor && effectiveTenor === t
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)]"
              }`}
            >
              {t} bulan
            </button>
          ))}
        </div>
        <input
          aria-label="Tenor lain (bulan)"
          className={`${inputCls} mt-3`}
          value={customTenor}
          onChange={(e) => setCustomTenor(e.target.value)}
          placeholder={`atau ketik tenor lain, ${minTenor}–${maxTenor} bulan`}
          inputMode="numeric"
        />
      </Field>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-bold">Bunga</p>
          <p className="text-xl font-extrabold text-[var(--accent-strong)]">
            {pct(effectiveInterest)}/bulan
          </p>
        </div>
        <p className="mt-1 text-sm text-[var(--dim)]">
          {usesDefaultInterest ? (
            <>
              Bunga ini diatur oleh admin (pemberi pinjaman) di menu
              Pengaturan dan tampil terbuka di sini — Anda tidak dapat
              mengubahnya. Total tagihan dan cicilan di bawah dihitung
              dengan bunga ini; admin dapat menyesuaikannya untuk
              pinjaman ini saat menyetujui pengajuan.
            </>
          ) : (
            <>
              Bunga yang ditetapkan admin untuk pinjaman ini — diatur
              lewat menu Pengaturan dan persetujuan admin; tidak dapat
              diubah dari form ini.
            </>
          )}
        </p>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Bunga keterlambatan <strong>{pct(lateFeePerDay)}/hari</strong>{" "}
          dari cicilan yang terlambat — juga diatur admin di menu
          Pengaturan. Denda berhenti bertambah pada tanggal cicilan
          dibayar dan dikonfirmasi admin.
        </p>
      </div>

      <p className="text-sm text-[var(--dim)]">
        Tanggal mulai: <strong className="text-[var(--text)]">{fmtDate(startDate)}</strong>
        {initial
          ? " (tanggal pengajuan asal, tidak berubah)"
          : " (hari ini)"}
        {finalDue && (
          <>
            {" "}· Jatuh tempo akhir:{" "}
            <strong className="text-[var(--text)]">{fmtDate(finalDue)}</strong>
          </>
        )}
      </p>

      <Field label="Catatan (opsional)">
        <textarea
          aria-label="Catatan"
          className={inputCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="cth. Jaminan BPKB motor, bayar tiap tanggal 15"
        />
      </Field>

      {effectivePrincipal > 0 && effectiveTenor >= 1 && (
        <div className="rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-sm">
          <div className="flex justify-between py-0.5">
            <span className="text-[var(--dim)]">Pokok pinjaman</span>
            <span className="font-bold">{rp(effectivePrincipal)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-[var(--dim)]">Tenor</span>
            <span className="font-bold">{effectiveTenor} bulan</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-[var(--dim)]">
              Bunga {pct(effectiveInterest)}/bulan × {effectiveTenor} bulan
            </span>
            <span className="font-bold">{rp(terms.totalInterest)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-[var(--dim)]">Cicilan per bulan</span>
            <span className="font-bold">{rp(terms.monthlyPayment)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-2">
            <span className="font-bold">Total harus dibayar</span>
            <span className="text-base font-extrabold text-[var(--accent-strong)]">
              {rp(terms.totalDue)}
            </span>
          </div>
          {schedulePreview.length > 0 && (
            <div className="mt-3 border-t border-[var(--border)] pt-2">
              <p className="mb-1 font-bold">Jadwal cicilan</p>
              <ul className="space-y-0.5">
                {schedulePreview.map((r) => (
                  <li key={r.index} className="flex justify-between">
                    <span className="text-[var(--dim)]">
                      Cicilan {r.index} · {fmtDate(r.dueDate)}
                    </span>
                    <span className="font-semibold">{rp(r.amount)}</span>
                  </li>
                ))}
              </ul>
              {scheduleTruncated && (
                <p className="mt-1 text-xs text-[var(--dim)]">
                  … cicilan di antaranya sebesar {rp(terms.monthlyPayment)}/bulan;
                  jadwal lengkap ada di halaman detail.
                </p>
              )}
            </div>
          )}
          {usesDefaultInterest && (
            <p className="mt-2 text-xs text-[var(--dim)]">
              Hitungan memakai bunga {pct(effectiveInterest)}/bulan dari
              Pengaturan admin yang tampil di atas. Admin dapat
              menyesuaikan bunga final untuk pinjaman ini saat
              menyetujui pengajuan.
            </p>
          )}
        </div>
      )}

      <ErrorBox message={error} />

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[var(--border)] px-5 py-2.5 font-bold text-[var(--text)]"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className={`${primaryBtn} flex-1`}
        >
          {mutation.isPending
            ? "Menyimpan…"
            : initial
              ? "Simpan perubahan"
              : "Kirim pengajuan"}
        </button>
      </div>
      {!initial && (
        <p className="text-center text-xs text-[var(--dim)]">
          Pengajuan berstatus <strong>Menunggu</strong> — dana dianggap
          cair setelah disetujui oleh admin (pemberi pinjaman).
        </p>
      )}
    </form>
  );
}
