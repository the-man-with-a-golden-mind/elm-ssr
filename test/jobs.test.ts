import { describe, expect, it } from "bun:test";
import {
  cacheJobStore,
  memoryJobStore,
  withJobs,
  type JobHandlers,
  type JobRecord,
  type JobStore
} from "elm-ssr/jobs";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: poll a store until `record.status === target` (or timeout).
const waitForStatus = async (
  store: JobStore,
  id: string,
  target: JobRecord["status"],
  timeoutMs = 1000
): Promise<JobRecord> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const record = await store.get(id);
    if (record?.status === target) return record;
    await tick(5);
  }
  throw new Error(`Job ${id} did not reach status ${target} within ${timeoutMs}ms`);
};

const startJob = async (
  runner: ReturnType<typeof withJobs>,
  kind: string,
  payload: unknown,
  context: Parameters<typeof runner>[1] = {}
) => {
  const result = await runner({ kind: "startJob", payload: { kind, payload } }, context);
  if (!result.ok) throw new Error(result.error ?? "startJob failed");
  return result.value as string;
};

const passthrough = async () => ({ ok: false as const, error: "not-handled" });

// === memoryJobStore ===

describe("memoryJobStore", () => {
  it("get/set/delete round-trips a record", async () => {
    const store = memoryJobStore();
    const record: JobRecord = { id: "j-1", kind: "demo", payload: null, status: "queued" };
    await store.set("j-1", record);
    expect(await store.get("j-1")).toEqual(record);
    await store.delete("j-1");
    expect(await store.get("j-1")).toBeNull();
  });

  it("evicts expired records on read", async () => {
    const store = memoryJobStore();
    await store.set("old", { id: "old", kind: "x", payload: null, status: "queued", expiresAt: Date.now() - 1 });
    expect(await store.get("old")).toBeNull();
  });
});

describe("cacheJobStore", () => {
  const makeBackend = () => {
    const map = new Map<string, unknown>();
    return {
      backend: {
        get: async (k: string) => map.get(k) ?? null,
        put: async (k: string, v: unknown) => {
          map.set(k, v);
        }
      },
      map
    };
  };

  it("prefixes keys to avoid colliding with other cache use", async () => {
    const { backend, map } = makeBackend();
    const store = cacheJobStore(backend, { keyPrefix: "app:jobs:" });
    await store.set("j-1", { id: "j-1", kind: "x", payload: null, status: "queued" });
    expect([...map.keys()]).toEqual(["app:jobs:j-1"]);
  });
});

// === withJobs runner ===

describe("withJobs", () => {
  it("startJob returns a fresh id and persists a record we can read back", async () => {
    const store = memoryJobStore();
    const release = Promise.withResolvers<void>();
    const handlers: JobHandlers = {
      noop: async () => {
        await release.promise;
        return "ok";
      }
    };
    const runner = withJobs(passthrough, { store, handlers });

    const id = await startJob(runner, "noop", { x: 1 });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(10);

    // The handler is blocked, so the record is queued or running (depends on
    // microtask interleaving) — never done. Either way: same id/kind/payload.
    const record = await store.get(id);
    expect(record).toMatchObject({ id, kind: "noop", payload: { x: 1 } });
    expect(["queued", "running"]).toContain(record?.status);
    expect(record?.expiresAt).toBeGreaterThan(Date.now());

    release.resolve();
    await waitForStatus(store, id, "done");
  });

  it("runs the handler in the background; record becomes done with the result", async () => {
    const store = memoryJobStore();
    const handlers: JobHandlers = {
      add: async (payload) => {
        const { a, b } = payload as { a: number; b: number };
        return a + b;
      }
    };
    const runner = withJobs(passthrough, { store, handlers });

    const id = await startJob(runner, "add", { a: 2, b: 3 });
    const finished = await waitForStatus(store, id, "done");

    expect(finished.result).toBe(5);
    expect(finished.startedAt).toBeGreaterThan(0);
    expect(finished.finishedAt).toBeGreaterThanOrEqual(finished.startedAt as number);
    expect(finished.error).toBeUndefined();
  });

  it("captures handler progress via reportProgress", async () => {
    const store = memoryJobStore();
    const releaseHandler = Promise.withResolvers<void>();
    const handlers: JobHandlers = {
      slow: async (_payload, ctx) => {
        await ctx.reportProgress({ phase: "first", step: 1 });
        await tick(10);
        await ctx.reportProgress({ phase: "second", step: 2 });
        await releaseHandler.promise;
        return "ok";
      }
    };
    const runner = withJobs(passthrough, { store, handlers });

    const id = await startJob(runner, "slow", null);

    // Wait until at least the second progress lands.
    let snapshot: JobRecord | null = null;
    const start = Date.now();
    while (Date.now() - start < 1000) {
      snapshot = await store.get(id);
      if ((snapshot?.progress as { step?: number } | undefined)?.step === 2) break;
      await tick(5);
    }
    expect(snapshot?.status).toBe("running");
    expect(snapshot?.progress).toEqual({ phase: "second", step: 2 });

    releaseHandler.resolve();
    const done = await waitForStatus(store, id, "done");
    expect(done.result).toBe("ok");
  });

  it("marks failed when the handler throws", async () => {
    const store = memoryJobStore();
    const handlers: JobHandlers = {
      boom: async () => {
        throw new Error("kaboom");
      }
    };
    const runner = withJobs(passthrough, { store, handlers });

    const originalError = console.error;
    console.error = () => {};
    try {
      const id = await startJob(runner, "boom", null);
      const failed = await waitForStatus(store, id, "failed");
      expect(failed.error).toContain("kaboom");
    } finally {
      console.error = originalError;
    }
  });

  it("marks failed immediately when the kind has no handler", async () => {
    const store = memoryJobStore();
    const runner = withJobs(passthrough, { store, handlers: {} });

    const id = await startJob(runner, "unknown", null);
    const failed = await waitForStatus(store, id, "failed");
    expect(failed.error).toContain("No handler registered");
  });

  it("startJob without a kind fails fast (does not create a record)", async () => {
    const store = memoryJobStore();
    const runner = withJobs(passthrough, { store, handlers: {} });

    const result = await runner({ kind: "startJob", payload: { payload: {} } }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("kind");
  });

  it("jobStatus returns the current record (or null for unknown id)", async () => {
    const store = memoryJobStore();
    const runner = withJobs(passthrough, { store, handlers: { noop: async () => "ok" } });

    const id = await startJob(runner, "noop", null);
    await waitForStatus(store, id, "done");

    const result = await runner({ kind: "jobStatus", payload: { jobId: id } }, {});
    expect(result.ok).toBe(true);
    expect((result.value as JobRecord).status).toBe("done");
    expect((result.value as JobRecord).result).toBe("ok");

    const missing = await runner({ kind: "jobStatus", payload: { jobId: "no-such-id" } }, {});
    expect(missing).toEqual({ ok: true, value: null });
  });

  it("non-job effects pass through to the wrapped runner unchanged", async () => {
    const store = memoryJobStore();
    let forwarded = false;
    const inner: typeof passthrough = async () => {
      forwarded = true;
      return { ok: true, value: "forwarded" };
    };
    const runner = withJobs(inner, { store, handlers: {} });

    const result = await runner({ kind: "other", payload: {} }, {});
    expect(forwarded).toBe(true);
    expect(result.value).toBe("forwarded");
  });

  it("uses ctx.waitUntil when provided (Cloudflare path)", async () => {
    const store = memoryJobStore();
    const handlers: JobHandlers = { quick: async () => "done" };
    const runner = withJobs(passthrough, { store, handlers });

    const tracked: Promise<unknown>[] = [];
    const waitUntil = (promise: Promise<unknown>) => {
      tracked.push(promise);
    };
    await startJob(runner, "quick", null, { waitUntil });

    expect(tracked.length).toBe(1);
    await Promise.all(tracked);
  });
});
