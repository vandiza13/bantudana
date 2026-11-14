// Pengganti minimal "@hatch/space-sdk" untuk mode standalone.
//
// Di Muse, server/src/actions.ts mengimpor dari "@hatch/space-sdk":
//   import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
//
// Setelah ditelusuri, yang benar-benar dipakai BantuDana dari SDK itu hanya:
//   - `z`            -> re-export langsung dari `zod` (lihat server-contract.js: `import { z } from "zod"`)
//   - `defineAction` -> pembungkus tipis yang hanya menempelkan merek
//                       `__brand` pada { request, response, handler }
//                       (lihat createDefineAction di server-contract.js)
//   - `Ctx`          -> objek konteks; handler BantuDana HANYA memakai
//                       `ctx.db()` dan `ctx.invalidateQueries()` — tidak
//                       memakai agent, inference, tool, blobs, atau
//                       executePrivileged sama sekali (cek dengan
//                       grep "ctx\." di actions.ts).
//
// Jadi SDK TIDAK perlu di-vendor atau di-shim sebagian: file ini menggantikannya
// sepenuhnya dengan ~60 baris. Perilaku validasi Zod dan handler tidak berubah:
// server standalone memanggil definition.request.parse() -> handler(ctx, args)
// -> definition.response.parse() dengan cara yang sama seperti worker Muse.
import { z } from "zod";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

export { z };

/** Konteks minimal yang dibutuhkan handler BantuDana. */
export interface Ctx {
  slug: string;
  /** Mengembalikan instance Drizzle (sudah terhubung ke file SQLite). */
  db: <T extends Record<string, unknown>>() => LibSQLDatabase<T>;
  /** Di Muse ini memicu refetch query klien; di standalone tidak ada
   *  yang perlu dilakukan karena klien mem-refetch sendiri setelah mutasi. */
  invalidateQueries: (input?: unknown) => void;
}

export interface ActionDefinition<
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> {
  __brand: "@hatch/space-sdk/Action/v1";
  request: Req;
  response: Res;
  description?: string;
  handler: (ctx: Ctx, args: z.infer<Req>) => Promise<z.infer<Res>>;
}

export function defineAction<
  Req extends z.ZodType,
  Res extends z.ZodType,
>(spec: {
  description?: string;
  request: Req;
  response: Res;
  handler: (ctx: Ctx, args: z.infer<Req>) => Promise<z.infer<Res>>;
}): ActionDefinition<Req, Res> {
  return {
    __brand: "@hatch/space-sdk/Action/v1",
    request: spec.request,
    response: spec.response,
    ...(spec.description !== undefined
      ? { description: spec.description }
      : {}),
    handler: spec.handler,
  };
}

/** Peta `Actions` di actions.ts harus memenuhi tipe ini (dipakai sebagai
 *  `} satisfies ActionsModule;` di akhir file). */
export type ActionsModule = Record<
  string,
  ActionDefinition<z.ZodType, z.ZodType>
>;
