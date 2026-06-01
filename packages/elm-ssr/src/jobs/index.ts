// Public API for the background-job layer. Wrap your effect runner with
// `withJobs(runner, { store, handlers })` to enable `Loader.startJob` /
// `Loader.jobStatus` on the Elm side.

export { memoryJobStore, cacheJobStore, type CacheJobStoreOptions } from "./store";
export { withJobs, type JobsConfig } from "./runner";
export type { JobRecord, JobStore, JobContext, JobHandler, JobHandlers } from "./types";
