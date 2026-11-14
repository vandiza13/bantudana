// Layar masuk / daftar BantuDana — mobile-first.
//
// Aturan peran (dijelaskan terbuka di layar ini):
// - Belum ada akun sama sekali → pendaftar pertama menjadi ADMIN
//   (Gibran, pemberi pinjaman yang menyetujui pinjaman).
// - Sudah ada admin → pendaftar baru menjadi USER (peminjam).

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";
import { ErrorBox, Field, inputCls, primaryBtn } from "./components";

export function AuthScreen() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"masuk" | "daftar">("masuk");
  const status = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.getAuthStatus({}),
  });
  const firstSetup = status.data != null && !status.data.adminExists;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState("");

  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));

  const loginMut = useMutation({
    mutationFn: async () => api.login({ phone: phone.trim(), pin }),
    onSuccess: (res) => signIn(res.token, res.account),
    onError: fail,
  });
  const registerMut = useMutation({
    mutationFn: async () =>
      api.register({ name: name.trim(), phone: phone.trim(), pin }),
    onSuccess: (res) => signIn(res.token, res.account),
    onError: fail,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (phone.replace(/\D/g, "").length < 8)
      return setError("Nomor HP minimal 8 digit angka.");
    if (!/^\d{6}$/.test(pin))
      return setError("PIN harus tepat 6 digit angka.");
    if (mode === "daftar") {
      if (name.trim().length < 2)
        return setError("Nama lengkap minimal 2 karakter.");
      if (pin !== pinConfirm)
        return setError("Konfirmasi PIN tidak sama. Periksa kembali.");
      registerMut.mutate();
    } else {
      loginMut.mutate();
    }
  };

  const busy = loginMut.isPending || registerMut.isPending;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-10 pt-10 sm:pt-16">
      <div className="text-center">
        <p className="text-4xl font-extrabold tracking-tight">
          Bantu<span className="text-[var(--accent-strong)]">Dana</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Pinjaman dana dengan persetujuan langsung dari pemberi pinjaman.
          Peminjam mengajukan, admin menyetujui.
        </p>
      </div>

      {status.isError && (
        <div className="mt-6 rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm">
          <p className="font-bold text-[var(--danger)]">
            Koneksi ke server bermasalah
          </p>
          <p className="mt-1 text-[var(--text)]">
            Aplikasi belum terhubung ke server. Periksa koneksi internet Anda,{" "}
            lalu coba lagi.{" "}
            <button
              type="button"
              className="font-bold underline"
              onClick={() => status.refetch()}
            >
              Coba lagi
            </button>
          </p>
        </div>
      )}

      {firstSetup && (
        <div className="mt-6 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
          <p className="font-bold text-[var(--accent-strong)]">
            Penyiapan pertama — akun Admin
          </p>
          <p className="mt-1 text-[var(--text)]">
            Belum ada akun di aplikasi ini. Akun pertama yang dibuat menjadi{" "}
            <strong>Admin (Gibran, pemberi pinjaman)</strong> — buat akun ini
            dulu sebelum peminjam mendaftar.
          </p>
        </div>
      )}

      <div
        className="mt-7 grid grid-cols-2 gap-1 rounded-2xl bg-[var(--surface-2)] p-1"
        role="tablist"
        aria-label="Pilih masuk atau daftar"
      >
        {(
          [
            { key: "masuk", label: "Masuk" },
            { key: "daftar", label: "Daftar" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={mode === t.key}
            onClick={() => {
              setMode(t.key);
              setError("");
            }}
            className={`rounded-xl py-2.5 text-sm font-bold transition-colors ${
              mode === t.key
                ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
                : "text-[var(--dim)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "daftar" && (
          <Field label="Nama lengkap">
            <input
              aria-label="Nama lengkap"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cth. Gibran Yudistira"
              autoComplete="name"
            />
          </Field>
        )}
        <Field label="Nomor HP (WhatsApp)">
          <input
            aria-label="Nomor HP"
            className={inputCls}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="cth. 0812 3456 7890"
            inputMode="tel"
            autoComplete="tel"
          />
        </Field>
        <Field
          label="PIN (6 digit)"
          hint={
            mode === "daftar"
              ? "Ingat baik-baik PIN ini — dipakai setiap kali masuk."
              : undefined
          }
        >
          <input
            aria-label="PIN 6 digit"
            className={inputCls}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            inputMode="numeric"
            type="password"
            autoComplete={mode === "daftar" ? "new-password" : "current-password"}
          />
        </Field>
        {mode === "daftar" && (
          <Field label="Konfirmasi PIN">
            <input
              aria-label="Konfirmasi PIN"
              className={inputCls}
              value={pinConfirm}
              onChange={(e) =>
                setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="••••••"
              inputMode="numeric"
              type="password"
              autoComplete="new-password"
            />
          </Field>
        )}

        <ErrorBox message={error} />

        <button
          type="submit"
          disabled={busy || status.isPending}
          className={`${primaryBtn} w-full py-3 text-base`}
        >
          {busy
            ? "Memproses…"
            : mode === "masuk"
              ? "Masuk"
              : firstSetup
                ? "Buat akun Admin"
                : "Daftar sebagai peminjam"}
        </button>
      </form>

      {mode === "daftar" && !firstSetup && (
        <p className="mt-4 text-center text-xs leading-relaxed text-[var(--dim)]">
          Akun baru berperan sebagai <strong>peminjam</strong>: Anda bisa
          mengajukan pinjaman dan memantau statusnya. Persetujuan selalu oleh
          admin (pemberi pinjaman).
        </p>
      )}
      {mode === "masuk" && (
        <p className="mt-4 text-center text-xs leading-relaxed text-[var(--dim)]">
          Belum punya akun? Pilih tab <strong>Daftar</strong> di atas.
        </p>
      )}
    </div>
  );
}
