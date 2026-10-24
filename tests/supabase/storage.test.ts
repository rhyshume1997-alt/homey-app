import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { BUCKET, buildWorld, serviceClient, type World } from "./helpers";

const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`);

async function objectExists(path: string): Promise<boolean> {
  const { data } = await serviceClient().storage.from(BUCKET).download(path);
  return data !== null;
}

describe("documents bucket isolation", () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  });

  it("A can use its own prefix (positive control)", async () => {
    const own = w.a.client.storage.from(BUCKET);
    const path = `${w.a.householdId}/${randomUUID()}/mine.pdf`;
    const up = await own.upload(path, pdf("mine"), { contentType: "application/pdf" });
    expect(up.error).toBeNull();
    const dl = await own.download(w.a.seed.storagePath);
    expect(dl.error).toBeNull();
    const listed = await own.list(w.a.householdId);
    expect(listed.error).toBeNull();
    expect((listed.data ?? []).length).toBeGreaterThan(0);
  });

  it("A cannot list B's prefix", async () => {
    const store = w.a.client.storage.from(BUCKET);
    for (const prefix of [w.b.householdId, `${w.b.householdId}/${w.b.seed.documentId}`]) {
      const res = await store.list(prefix);
      expect(res.data ?? []).toHaveLength(0);
    }
    const root = await store.list("");
    const names = (root.data ?? []).map((o) => o.name);
    expect(names).not.toContain(w.b.householdId);
  });

  it("A cannot download B's object", async () => {
    const res = await w.a.client.storage.from(BUCKET).download(w.b.seed.storagePath);
    expect(res.error).not.toBeNull();
    expect(res.data).toBeNull();
  });

  it("A cannot upload into B's prefix, including overwrite by upsert", async () => {
    const store = w.a.client.storage.from(BUCKET);
    const fresh = `${w.b.householdId}/${randomUUID()}/evil.pdf`;
    expect((await store.upload(fresh, pdf("evil"), { contentType: "application/pdf" })).error).not.toBeNull();
    expect(await objectExists(fresh)).toBe(false);

    const over = await store.upload(w.b.seed.storagePath, pdf("overwritten"), { contentType: "application/pdf", upsert: true });
    expect(over.error).not.toBeNull();
    const { data } = await serviceClient().storage.from(BUCKET).download(w.b.seed.storagePath);
    expect(await data?.text()).toBe(`%PDF-1.4 seed ${w.b.householdId}`);
  });

  it("A cannot delete B's object", async () => {
    const res = await w.a.client.storage.from(BUCKET).remove([w.b.seed.storagePath]);
    expect(res.data ?? []).toHaveLength(0);
    expect(await objectExists(w.b.seed.storagePath)).toBe(true);
  });

  it("A cannot create a signed URL for B's object (single or batch)", async () => {
    const store = w.a.client.storage.from(BUCKET);
    const one = await store.createSignedUrl(w.b.seed.storagePath, 60);
    expect(one.error).not.toBeNull();
    expect(one.data?.signedUrl).toBeUndefined();

    const many = await store.createSignedUrls([w.b.seed.storagePath], 60);
    const entries = many.data ?? [];
    expect(entries.every((e) => !e.signedUrl)).toBe(true);
  });

  it("a signed URL created by B works for B", async () => {
    const { data, error } = await w.b.client.storage.from(BUCKET).createSignedUrl(w.b.seed.storagePath, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
    const res = await fetch(data!.signedUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`%PDF-1.4 seed ${w.b.householdId}`);
  });
});
