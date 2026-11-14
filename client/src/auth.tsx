// Konteks login BantuDana.
//
// Token sesi disimpan di localStorage perangkat ini dan divalidasi ke
// server setiap aplikasi dibuka (getSession). Peran (admin/user) selalu
// berasal dari server — tidak pernah dari data lokal — dan server
// memeriksanya ulang pada setiap aksi.
//
// Ketahanan buka aplikasi:
// - Akses localStorage selalu dibungkus try/catch. Di sebagian webview
//   penyimpanan bisa terblokir dan melempar error; tanpa perlindungan itu
//   aplikasi macet selamanya di layar "Memuat…".
// - Validasi sesi punya batas waktu. Jaringan ponsel yang menggantung
//   tidak boleh membuat aplikasi tidak bisa dibuka: sesi yang tidak
//   terverifikasi tepat waktu dibuang dan pengguna diarahkan ke layar
//   masuk untuk masuk ulang.

import {
createContext,
useCallback,
useContext,
useEffect,
useState,
type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

export type Account = ApiResponse<typeof api, "getSession">["account"];

const TOKEN_KEY = "bantudana.session-token.v1";
const SESSION_CHECK_TIMEOUT_MS = 12_000;

// Cadangan di memori bila localStorage tidak bisa dipakai sama sekali.
let memoryToken: string | null = null;

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function writeToken(token: string): void {
  memoryToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Penyimpanan terblokir: token tetap hidup di memori selama aplikasi
    // terbuka, pengguna hanya perlu masuk ulang di kunjungan berikutnya.
  }
}

function clearToken(): void {
  memoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Abaikan: token di memori sudah dibersihkan.
  }
}

type AuthState = {
  status: "loading" | "signedOut" | "signedIn";
  token: string | null;
  account: Account | null;
  signIn: (token: string, account: Account) => void;
  signOut: () => Promise<void>;
  /** Buang sesi lokal tanpa memanggil server — jalan keluar dari layar memuat. */
  resetSession: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = readToken();
    } catch {
      saved = null;
    }
    if (!saved) {
      setStatus("signedOut");
      return;
    }
    let cancelled = false;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Validasi sesi melewati batas waktu.")),
        SESSION_CHECK_TIMEOUT_MS,
      ),
    );
    Promise.race([api.getSession({ token: saved }), timeout])
      .then((res) => {
        if (cancelled) return;
        setToken(saved);
        setAccount(res.account);
        setStatus("signedIn");
      })
      .catch(() => {
        if (cancelled) return;
        // Token kedaluwarsa, sesi terputus, atau jaringan menggantung:
        // jangan macet di layar memuat — arahkan ke layar masuk.
        clearToken();
        setToken(null);
        setAccount(null);
        setStatus("signedOut");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback((newToken: string, acc: Account) => {
    writeToken(newToken);
    setToken(newToken);
    setAccount(acc);
    setStatus("signedIn");
  }, []);

  const resetSession = useCallback(() => {
    clearToken();
    setToken(null);
    setAccount(null);
    setStatus("signedOut");
    queryClient.clear();
  }, [queryClient]);

  const signOut = useCallback(async () => {
    if (token) {
      try {
        await api.logout({ token });
      } catch {
        // Sesi sudah tidak ada di server pun tidak masalah.
      }
    }
    resetSession();
  }, [token, resetSession]);

  return (
    <AuthContext.Provider
      value={{ status, token, account, signIn, signOut, resetSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider.");
  return ctx;
}
