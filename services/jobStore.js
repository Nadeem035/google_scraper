import { randomUUID } from "crypto";

/** In-memory job registry (swap for Redis/Bull in production). */
const jobs = new Map();

export function createJob(meta = {}) {
  const id = randomUUID();
  jobs.set(id, {
    id,
    status: "queued",
    progress: 0,
    total: 0,
    found: 0,
    currentName: null,
    results: [],
    error: null,
    searchQuery: meta.searchQuery || "",
    createdAt: Date.now(),
    ...meta,
  });
  return id;
}

export function getJob(id) {
  return jobs.get(id) ? { ...jobs.get(id) } : null;
}

export function updateJob(id, patch) {
  const j = jobs.get(id);
  if (!j) return null;
  Object.assign(j, patch);
  return { ...j };
}

export function setJobResults(id, results) {
  return updateJob(id, { results, status: "completed", progress: 100, currentName: null });
}

export function deleteJob(id) {
  jobs.delete(id);
}
