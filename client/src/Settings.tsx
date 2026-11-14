import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useAuth } from "./auth";
import { ErrorBox, Field, SectionTitle, inputCls, primaryBtn } from "./components";
import { pct, rp } from "./lib";

type Settings = ApiResponse<typeof api, "getSettings">["settings"];

/** Pisahkan daftar angka dari teks "1, 3, 6, 12" atau "500000, 1000000". */
function parseList(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => Number(part.replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parsePercent(text: string): number {
  return Number(text.replace(",", ".")) || 0;
}

export function SettingsView({
  showToast,
}: {
  showToast: (msg: string) => void;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings({ token: token ?? "" }),
    enabled: !!token,
  });
  const s = settingsQuery.data?.settings;

  const [interest, setInterest] = useState("");
  const [lateFee, setLateFee] = useState("");
  const [defaultTenor, setDefaultTenor] = useState("");
  const [minTenor, setMinTenor] = useState("");
  const [maxTenor, setMaxTenor] = useState("");
  const [tenorOptions, setTenorOptions] = useState("");
  const [minPrincipal, setMinPrincipal] = useState("");
  const [maxPrincipal, setMaxPrincipal] = useState("");
  const [nominalOptions, setNominalOptions] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Isi form dari pengaturan tersimpan saat pertama kali termuat.
  useEffect(() => {
    if (!s || hydrated) return;
    setInterest(String(s.defaultInterestPercent).replace(".", ","));
    setLateFee(String(s.lateFeePercentPerDay).replace(".", ","));
    setDefaultTenor(String(s.defaultTenorMonths));
    setMinTenor(String(s.minTenorMonths));
    setMaxTenor(String(s.maxTenorMonths));
    setTenorOptions(s.tenorOptions.join(", "));
    setMinPrincipal(String(s.minPrincipal));
    setMaxPrincipal(String(s.maxPrincipal));
    setNominalOptions(s.nominalOptions.join(", "));
    setHydrated(true);
  }, [s, hydrated]);

  const saveMut = useMutation({
    mutationFn: async (payload: Settings) =>
      api.updateSettings({ token: token ?? "", ...payload }),
    onSuccess: (res) => {
      setError("");
      queryClient.setQueryData(["settings"], res);
      queryClient.invalidateQueries();
      showToast("Pengaturan pinjaman tersimpan.");
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const interestNum = parsePercent(interest);
    const lateFeeNum = parsePercent(lateFee);
    const defTenor = Number(defaultTenor.replace(/\D/g, "")) || 0;
    const minT = Number(minTenor.replace(/\D/g, "")) || 0;
    const maxT = Number(maxTenor.replace(/\D/g, "")) || 0;
    const minP = Number(minPrincipal.replace(/\D/g, "")) || 0;
    const maxP = Number(maxPrincipal.replace(/\D/g, "")) || 0;
    const tenorOpts = parseList(tenorOptions);
    const nominalOpts = parseList(nominalOptions);
    if (interestNum < 0 || interestNum > 20)
      return setError("Bunga default harus antara 0% dan 20% per bulan.");
    if (lateFeeNum < 0 || lateFeeNum > 5)
      return setError("Bunga keterlambatan harus antara 0% dan 5% per hari. Isi 0 untuk menonaktifkan denda.");
    if (minT < 1 || maxT > 36 || minT > maxT)
      return setError("Batas tenor tidak valid: minimum 1, maksimum 36, dan minimum tidak boleh melebihi maksimum.");
    if (defTenor < minT || defTenor > maxT)
      return setError("Tenor default harus berada di antara tenor minimum dan maksimum.");
    if (minP < 10_000 || maxP > 100_000_000 || minP >= maxP)
      return setError("Batas pokok tidak valid: minimum paling kecil Rp10.000, maksimum paling besar Rp100.000.000, dan minimum harus lebih kecil dari maksimum.");
    if (tenorOpts.length === 0)
      return setError("Pilihan tenor cepat wajib diisi, pisahkan dengan koma. Contoh: 1, 3, 6, 12.");
    if (nominalOpts.length === 0)
      return setError("Pilihan nominal cepat wajib diisi, pisahkan dengan koma. Contoh: 500000, 1000000, 2000000.");
    saveMut.mutate({
      defaultInterestPercent: interestNum,
      lateFeePercentPerDay: lateFeeNum,
      defaultTenorMonths: defTenor,
      minTenorMonths: minT,
      maxTenorMonths: maxT,
      tenorOptions: tenorOpts,
      minPrincipal: minP,
      maxPrincipal: maxP,
      nominalOptions: nominalOpts,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Pengaturan</h1>
        <p className="mt-0.5 text-sm text-[var(--dim)]">
          Atur ketentuan pinjaman di sini — berlaku untuk pengajuan baru dan
          terisi otomatis saat Anda menyetujui pinjaman. Peminjam tidak
          dapat mengubah ketentuan ini.
        </p>
      </div>

      {settingsQuery.isPending && (
        <p className="py-10 text-center text-[var(--dim)]">Memuat pengaturan…</p>
      )}
      {settingsQuery.error && (
        <p className="py-10 text-center text-[var(--danger)]">
          Gagal memuat pengaturan.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => settingsQuery.refetch()}
          >
            Coba lagi
          </button>
        </p>
      )}

      {s && (
        <>
          <section>
            <SectionTitle>Ketentuan yang berlaku sekarang</SectionTitle>
            <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--dim)]">
                  Bunga default
                </p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">
                  {pct(s.defaultInterestPercent)}/bulan
                </p>
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--dim)]">
                  Bunga keterlambatan
                </p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">
                  {pct(s.lateFeePercentPerDay)}/hari
                </p>
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--dim)]">
                  Tenor default
                </p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">
                  {s.defaultTenorMonths} bulan
                </p>
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--dim)]">
                  Batas tenor
                </p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">
                  {s.minTenorMonths}–{s.maxTenorMonths} bulan
                </p>
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-[var(--dim)]">
                  Batas pokok
                </p>
                <p className="mt-1 break-words text-lg font-extrabold tracking-tight">
                  {rp(s.minPrincipal)} – {rp(s.maxPrincipal)}
                </p>
              </div>
            </div>
          </section>

          <form
            onSubmit={submit}
            className="space-y-5 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"
          >
            <div>
              <SectionTitle>Bunga</SectionTitle>
              <div className="mt-3">
                <Field
                  label="Bunga default (% per bulan)"
                  hint="Bunga flat dari pokok awal. Nilai ini terisi otomatis sebagai bunga final saat Anda menyetujui pengajuan — masih bisa disesuaikan per pinjaman di dialog persetujuan."
                >
                  <input
                    aria-label="Bunga default persen per bulan"
                    className={inputCls}
                    value={interest}
                    onChange={(e) => setInterest(e.target.value)}
                    inputMode="decimal"
                    placeholder="cth. 2"
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field
                  label="Bunga keterlambatan (% per hari)"
                  hint="Denda untuk cicilan yang terlambat: dihitung dari sisa cicilan yang terlambat × persen ini × jumlah hari terlambat, ditambahkan ke total yang harus dibayar, dan berhenti bertambah pada tanggal cicilan itu dibayar & dikonfirmasi. Contoh: cicilan Rp466.667 terlambat 10 hari pada 0,1%/hari → denda Rp4.667. Isi 0 untuk menonaktifkan denda."
                >
                  <input
                    aria-label="Bunga keterlambatan persen per hari"
                    className={inputCls}
                    value={lateFee}
                    onChange={(e) => setLateFee(e.target.value)}
                    inputMode="decimal"
                    placeholder="cth. 0,1"
                  />
                </Field>
              </div>
            </div>

            <div>
              <SectionTitle>Tenor</SectionTitle>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Field label="Tenor default (bulan)">
                  <input
                    aria-label="Tenor default dalam bulan"
                    className={inputCls}
                    value={defaultTenor}
                    onChange={(e) => setDefaultTenor(e.target.value)}
                    inputMode="numeric"
                    placeholder="3"
                  />
                </Field>
                <Field label="Tenor minimum (bulan)">
                  <input
                    aria-label="Tenor minimum dalam bulan"
                    className={inputCls}
                    value={minTenor}
                    onChange={(e) => setMinTenor(e.target.value)}
                    inputMode="numeric"
                    placeholder="1"
                  />
                </Field>
                <Field label="Tenor maksimum (bulan)">
                  <input
                    aria-label="Tenor maksimum dalam bulan"
                    className={inputCls}
                    value={maxTenor}
                    onChange={(e) => setMaxTenor(e.target.value)}
                    inputMode="numeric"
                    placeholder="36"
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field
                  label="Pilihan tenor cepat di form peminjam"
                  hint="Pisahkan dengan koma. Contoh: 1, 3, 6, 12. Pilihan di luar batas tenor akan dibuang saat disimpan."
                >
                  <input
                    aria-label="Pilihan tenor cepat"
                    className={inputCls}
                    value={tenorOptions}
                    onChange={(e) => setTenorOptions(e.target.value)}
                    placeholder="1, 3, 6, 12"
                  />
                </Field>
              </div>
            </div>

            <div>
              <SectionTitle>Pokok pinjaman</SectionTitle>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Pokok minimum (Rp)">
                  <input
                    aria-label="Pokok minimum rupiah"
                    className={inputCls}
                    value={minPrincipal}
                    onChange={(e) => setMinPrincipal(e.target.value)}
                    inputMode="numeric"
                    placeholder="50000"
                  />
                </Field>
                <Field label="Pokok maksimum (Rp)">
                  <input
                    aria-label="Pokok maksimum rupiah"
                    className={inputCls}
                    value={maxPrincipal}
                    onChange={(e) => setMaxPrincipal(e.target.value)}
                    inputMode="numeric"
                    placeholder="100000000"
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field
                  label="Pilihan nominal cepat di form peminjam"
                  hint="Dalam rupiah penuh, pisahkan dengan koma. Contoh: 500000, 1000000, 2000000, 5000000."
                >
                  <input
                    aria-label="Pilihan nominal cepat"
                    className={inputCls}
                    value={nominalOptions}
                    onChange={(e) => setNominalOptions(e.target.value)}
                    placeholder="500000, 1000000, 2000000"
                  />
                </Field>
              </div>
            </div>

            <ErrorBox message={error} />
            <button
              type="submit"
              disabled={saveMut.isPending || !hydrated}
              className={`${primaryBtn} w-full sm:w-auto`}
            >
              {saveMut.isPending ? "Menyimpan…" : "Simpan pengaturan"}
            </button>
            <p className="text-xs text-[var(--dim)]">
              Perubahan berlaku untuk pengajuan dan persetujuan berikutnya.
              Pinjaman yang sudah disetujui tidak berubah.
            </p>
          </form>
        </>
      )}
    </div>
  );
}
