// Helper format & tanggal untuk BantuDana.
// Semua tanggal "hari ini" dihitung di perangkat pengguna (zona lokal,
// Asia/Jakarta) lalu dikirim ke server sebagai YYYY-MM-DD.

export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Tambah N bulan ke tanggal YYYY-MM-DD (sama seperti hitungan server). */
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

/** Format persen bunga, cth. 2 → "2%", 1.5 → "1,5%". */
export function pct(n: number): string {
  return `${String(n).replace(".", ",")}%`;
}

export function rp(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

export function fmtDate(dateStr: string): string {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()] ?? ""} ${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} · ${time}`;
}

export function toDatetimeLocalValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** Ubah nomor HP Indonesia menjadi format wa.me (628xx). */
export function waNumber(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("62")) digits = digits;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
