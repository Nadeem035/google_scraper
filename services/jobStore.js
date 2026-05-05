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
    requested: 0,
    uniqueFound: 0,
    returnedCount: 0,
    duplicateBackfillCount: 0,
    duplicateSkippedCount: 0,
    excludedCount: 0,
    failedCount: 0,
    missingCoreFieldsCount: 0,
    processedCount: 0,
    candidateUrlCount: 0,
    fulfilledExact: false,
    mapsExhausted: false,
    refillFromSeenCount: 0,
    firstPassReturnedCount: 0,
    widenedScopeAddedCount: 0,
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

export function setJobResults(id, results, stats = {}) {
  return updateJob(id, {
    results,
    found: stats.returnedCount ?? (Array.isArray(results) ? results.length : 0),
    requested: stats.requested ?? 0,
    uniqueFound: stats.uniqueFound ?? (Array.isArray(results) ? results.length : 0),
    returnedCount: stats.returnedCount ?? (Array.isArray(results) ? results.length : 0),
    duplicateBackfillCount: stats.duplicateBackfillCount ?? 0,
    duplicateSkippedCount: stats.duplicateSkippedCount ?? 0,
    excludedCount: stats.excludedCount ?? 0,
    failedCount: stats.failedCount ?? 0,
    missingCoreFieldsCount: stats.missingCoreFieldsCount ?? 0,
    processedCount: stats.processedCount ?? 0,
    candidateUrlCount: stats.candidateUrlCount ?? 0,
    fulfilledExact: Boolean(stats.fulfilledExact),
    mapsExhausted: Boolean(stats.mapsExhausted),
    refillFromSeenCount: stats.refillFromSeenCount ?? 0,
    firstPassReturnedCount: stats.firstPassReturnedCount ?? 0,
    widenedScopeAddedCount: stats.widenedScopeAddedCount ?? 0,
    status: "completed",
    progress: 100,
    currentName: null,
  });
}

export function deleteJob(id) {
  jobs.delete(id);
}
