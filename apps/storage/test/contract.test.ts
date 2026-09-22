import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
process.env.SKIP_STORAGE_MAIN = "1";
const { buildStorageApp } = await import("../src/server.js");

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function multipartBody(kind: string, filename: string, mime: string, content: Buffer, boundary: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test("storage disk backend preserves the HTTP file contract", async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ke-storage-test-"));
  const token = "test-storage-token-abcdef";
  const app = await buildStorageApp({
    NODE_ENV: "test",
    PORT: 0,
    DATA_DIR: dataDir,
    STORAGE_TOKEN: token,
    S3_BUCKET: "unused",
  });

  const boundary = "ke-boundary-123";
  const content = Buffer.from(PNG, "base64");

  try {
    // Auth is required.
    const denied = await app.inject({
      method: "POST",
      url: "/internal/files",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody("slides", "slide-1.webp", "image/webp", content, boundary),
    });
    assert.equal(denied.statusCode, 401);

    // Upload a slide.
    const upload = await app.inject({
      method: "POST",
      url: "/internal/files",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "x-storage-token": token },
      payload: multipartBody("slides", "slide-1.webp", "image/webp", content, boundary),
    });
    assert.equal(upload.statusCode, 201);
    const meta = upload.json<{ id: string; kind: string; mime: string; size: number; path: string }>();
    assert.equal(meta.kind, "slides");
    assert.equal(meta.mime, "image/webp");
    assert.equal(meta.size, content.length);
    assert.ok(meta.path.startsWith("slides/"));

// Download is idempotent, tagged private, and byte-exact.
    for (const kind of [undefined, "slides"]) {
      const qs = kind ? `?kind=${kind}` : "";
      const get = await app.inject({
        method: "GET",
        url: `/internal/files/${meta.id}${qs}`,
        headers: { "x-storage-token": token },
      });
      assert.equal(get.statusCode, 200);
      assert.equal(get.headers["content-type"], "image/webp");
      assert.equal(get.headers["cache-control"], "private, no-store");
      assert.equal(get.rawPayload.length, content.length);
      assert.deepEqual(Buffer.from(get.rawPayload), content);
    }

    // A kind the file does not belong to is not found.
    const wrongKind = await app.inject({
      method: "GET",
      url: `/internal/files/${meta.id}?kind=originals`,
      headers: { "x-storage-token": token },
    });
    assert.equal(wrongKind.statusCode, 404);

    // Unknown id → 404.
    const missing = await app.inject({
      method: "GET",
      url: "/internal/files/does-not-exist?kind=slides",
      headers: { "x-storage-token": token },
    });
    assert.equal(missing.statusCode, 404);

    // Delete, then the file is gone.
    const del = await app.inject({
      method: "DELETE",
      url: `/internal/files/${meta.id}`,
      headers: { "x-storage-token": token },
    });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json(), { deleted: true });

    const gone = await app.inject({
      method: "GET",
      url: `/internal/files/${meta.id}?kind=slides`,
      headers: { "x-storage-token": token },
    });
    assert.equal(gone.statusCode, 404);

    // Rejected kind is refused.
    const bad = await app.inject({
      method: "POST",
      url: "/internal/files",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "x-storage-token": token },
      payload: multipartBody("other", "x.bin", "application/octet-stream", Buffer.from("x"), boundary),
    });
    assert.equal(bad.statusCode, 400);
  } finally {
    await app.close();
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
});