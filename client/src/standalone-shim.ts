// Pengganti minimal "@hatch/space-sdk/client" untuk mode standalone.
//
// Klien BantuDana hanya memakai tiga hal dari SDK klien:
//   1. `createActionClient` (api.ts) — POST `{ action, args, actionCallId }`
//      ke `./actions`, mengharapkan `{ data }` / `{ error }`.
//      Versi ini melakukan protokol yang SAMA persis, tanpa bagian khusus
//      Muse (viewer_assertion / auth-refresh / pesan "space unavailable").
//   2. `spaceQueryClient` (main.tsx) — singleton TanStack QueryClient.
//      Dibuat ulang dengan default yang sama: staleTime 30 detik, tanpa
//      refetch saat window focus, retry terbatas untuk error sementara.
//   3. `SafeAreaTopScrim` (App.tsx) — di Muse ia menutup celah notch
//      atas. Di standalone tidak ada chrome hosting, jadi komponen ini
//      tidak merender apa pun; safe-area ditangani standalone.css.
//   Plus tipe `ApiRequest` / `ApiResponse` yang dipakai auth.tsx.
import { MutationCache, QueryClient } from "@tanstack/react-query";
import type { z } from "zod";

/** Error aksi — bentuknya disederhanakan dari SpaceActionError SDK. */
export class SpaceActionError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = message) {
    super(message);
    this.name = "SpaceActionError";
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_ENDPOINT = "./actions";

function resolveEndpoint(relative: string): string {
  const href = globalThis.location?.href;
  if (typeof href !== "string" || href.length === 0) return relative;
  const base = new URL(href);
  base.hash = "";
  base.search = "";
  return new URL(relative, base).toString();
}

type ActionDef = { request: z.ZodType; response: z.ZodType };
type ActionClient<T extends Record<string, ActionDef>> = {
  [K in keyof T]: (
    args: z.infer<T[K]["request"]>,
  ) => Promise<z.infer<T[K]["response"]>>;
};

export function createActionClient<
  T extends Record<string, ActionDef>,
>(options: { endpoint?: string } = {}): ActionClient<T> {
  const endpoint = options.endpoint ?? resolveEndpoint(DEFAULT_ENDPOINT);
  return new Proxy({} as ActionClient<T>, {
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      if (name === "then" || name === "catch" || name === "finally") {
        return undefined;
      }
      return async (args: unknown) => {
        const actionCallId = `standalone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: name, args: args ?? {}, actionCallId }),
        });
        const body: unknown = await res.json().catch(() => ({}));
        const err =
          body && typeof body === "object" && "error" in body
            ? (body as { error?: unknown }).error
            : null;
        if (!res.ok || err) {
          const msg = err
            ? String(err)
            : `action ${name} failed (${res.status})`;
          throw new SpaceActionError(msg, res.status, msg);
        }
        return (body as { data?: unknown }).data;
      };
    },
  });
}

/** Sama seperti spaceQueryClient SDK: satu QueryClient untuk seluruh app. */
export const spaceQueryClient = new QueryClient({
  mutationCache: new MutationCache(),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** No-op di standalone (lihat penjelasan di atas). */
export function SafeAreaTopScrim(_props: { backgroundColor?: string }): null {
  return null;
}

export type ApiRequest<
  TClient,
  K extends keyof TClient,
> = TClient[K] extends (...args: infer A) => unknown ? A[0] : never;

export type ApiResponse<
  TClient,
  K extends keyof TClient,
> = TClient[K] extends (...args: never[]) => infer R
  ? Awaited<R>
  : never;
