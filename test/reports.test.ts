import { describe, expect, it } from "bun:test";
import { jobStore, worker } from "../examples/basic/runtime";
import type { JobRecord } from "elm-ssr/jobs";

// End-to-end through the example worker:
//   1. POST /reports with month=… starts a background `generateReport` job
//      (Loader.startJob); action redirects to /reports?id=<JobId>.
//   2. GET /reports?id=… runs Loader.jobStatus and renders the right view
//      for queued / running / done.
// The handler in runtime.ts takes ~1.2s with three progress checkpoints, so
// the test polls the store directly to drive the state machine.

const startReportJob = async (month: string): Promise<string> => {
  const response = await worker.fetch(
    new Request("https://example.com/reports", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `month=${encodeURIComponent(month)}`
    })
  );
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).toMatch(/^\/reports\?id=/);
  return new URL(location!, "https://example.com").searchParams.get("id")!;
};

const renderStatus = async (id: string): Promise<string> => {
  const response = await worker.fetch(new Request(`https://example.com/reports?id=${id}`));
  expect(response.status).toBe(200);
  return response.text();
};

const waitForStatus = async (id: string, target: JobRecord["status"], timeoutMs = 5000): Promise<JobRecord> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const record = await jobStore.get(id);
    if (record?.status === target) return record;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Job ${id} did not reach ${target} in ${timeoutMs}ms`);
};

describe("/reports — Loader.startJob + Loader.jobStatus end-to-end", () => {
  it("GET /reports without an id shows the submit form", async () => {
    const response = await worker.fetch(new Request("https://example.com/reports"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Generate a monthly report");
    expect(html).toContain('name="month"');
  });

  it("POST /reports starts a job and redirects to /reports?id=<JobId>", async () => {
    const id = await startReportJob("2026-05");

    // Record exists in the store immediately; status will progress to done.
    const queuedOrRunning = await jobStore.get(id);
    expect(queuedOrRunning).not.toBeNull();
    expect(queuedOrRunning?.kind).toBe("generateReport");
    expect(queuedOrRunning?.payload).toEqual({ month: "2026-05" });

    await waitForStatus(id, "done", 5000);
  });

  it("GET /reports?id=... renders the done view after the handler resolves", async () => {
    const id = await startReportJob("2026-06");
    await waitForStatus(id, "done");

    const html = await renderStatus(id);
    expect(html).toContain("Report ready");
    expect(html).toContain("2026-06"); // payload echoed back as `month`
    expect(html).toContain("PL"); // a country from the fake report
  });

  it("GET /reports?id=... renders progress while the handler is still running", async () => {
    const id = await startReportJob("2026-07");

    // The handler sleeps 400ms before the first reportProgress; sleep a bit
    // so we catch it in the middle (queued/running, not done).
    await new Promise((r) => setTimeout(r, 500));
    const midRecord = await jobStore.get(id);
    expect(["running", "queued"]).toContain(midRecord?.status);

    const html = await renderStatus(id);
    // While running, the heading is "Running…" or "Queued"; either way, the
    // "Report ready" header should NOT be present yet.
    expect(html).not.toContain("Report ready");
    expect(html).toMatch(/Running|Queued/);

    await waitForStatus(id, "done", 5000);
  });

  it("GET /reports?id=unknown renders the missing-job view", async () => {
    const html = await renderStatus("nope-not-a-real-id");
    expect(html).toContain("Unknown job");
  });
});
