import { createExampleWorker, renderPath } from "../examples/basic/runtime.ts";

const worker = createExampleWorker(() => {});

const quantile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
};

const formatMs = (value) => `${value.toFixed(2)} ms`;
const formatOps = (value) => `${value.toFixed(1)} ops/s`;

const runCase = async (label, iterations, task) => {
  const samples = [];

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await task();
    samples.push(performance.now() - startedAt);
  }

  const total = samples.reduce((sum, sample) => sum + sample, 0);
  const avg = total / samples.length;
  const p95 = quantile(samples, 0.95);

  return {
    label,
    iterations,
    avg,
    p95,
    throughput: 1000 / avg
  };
};

const cases = [
  await runCase("renderPath(/)", 75, async () => {
    await renderPath("/");
  }),
  await runCase("renderPath(/counter)", 75, async () => {
    await renderPath("/counter");
  }),
  await runCase("worker.fetch(/api/health)", 150, async () => {
    const response = await worker.fetch(new Request("https://bench.local/api/health"));
    await response.text();
  }),
  await runCase("worker.fetch(/counter)", 75, async () => {
    const response = await worker.fetch(new Request("https://bench.local/counter"));
    await response.text();
  })
];

console.log("Elm SSR benchmark");
console.log("==================");

for (const result of cases) {
  console.log(
    `${result.label}\n  iterations: ${result.iterations}\n  avg: ${formatMs(result.avg)}\n  p95: ${formatMs(result.p95)}\n  throughput: ${formatOps(result.throughput)}`
  );
}
