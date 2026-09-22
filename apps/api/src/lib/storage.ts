import { z } from "zod";

const fileMetaSchema = z.object({
  id: z.string(),
  kind: z.string(),
  originalName: z.string(),
  mime: z.string(),
  size: z.number(),
  path: z.string(),
  createdAt: z.string(),
});

export type StorageFileMeta = z.infer<typeof fileMetaSchema>;

export interface StorageClient {
  upload(opts: {
    kind: "originals" | "slides" | "temporary";
    filename: string;
    mime: string;
    data: Buffer;
  }): Promise<StorageFileMeta>;
  fetchAsBuffer(id: string, kind?: string): Promise<{ data: Buffer; mime: string }>;
  stream(id: string, kind: string): Promise<Response>;
  remove(id: string): Promise<void>;
}

export function createStorageClient(baseUrl: string, token: string): StorageClient {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "x-storage-token": token,
        ...(init?.headers ?? {}),
      },
    });
  }

  return {
    async upload({ kind, filename, mime, data }) {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", new Blob([data], { type: mime }), filename);
      const res = await request("/internal/files", { method: "POST", body: form });
      if (!res.ok) {
        throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
      }
      return fileMetaSchema.parse(await res.json());
    },

    async fetchAsBuffer(id, kind = "temporary") {
      const res = await request(`/internal/files/${id}?kind=${encodeURIComponent(kind)}`);
      if (!res.ok) throw new Error(`Storage fetch failed: ${res.status}`);
      return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "application/octet-stream" };
    },

    async stream(id, kind) {
      const res = await request(`/internal/files/${id}?kind=${encodeURIComponent(kind)}`);
      if (!res.ok) throw new Error(`Storage stream failed: ${res.status}`);
      return res;
    },

    async remove(id) {
      const res = await request(`/internal/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Storage delete failed: ${res.status}`);
    },
  };
}