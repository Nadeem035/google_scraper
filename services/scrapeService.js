import { runMapsScrape } from "../scraper/mapsScraper.js";
import { updateJob, setJobResults } from "./jobStore.js";

/**
 * Background scrape: updates job store (no database — export is the source of truth).
 */
export async function executeScrapeJob(jobId, params) {
  const { query, location, limit, extractEmails, excludeUrls } = params;
  try {
    const locationText = String(location || "").trim();
    const requestedLimit = Math.max(Number(limit) || 50, 1);
    const safeLimit = Math.min(requestedLimit, 500);
    const safeExcludeUrls = Array.isArray(excludeUrls) ? excludeUrls : [];
    updateJob(jobId, { status: "running", total: 0, requested: safeLimit, progress: 0, found: 0 });

    const firstPass = await runMapsScrape({
      query,
      location: locationText,
      limit: safeLimit,
      extractEmails: extractEmails !== false,
      excludeUrls: safeExcludeUrls,
      onProgress: ({ progress, total, found, currentName }) => {
        updateJob(jobId, { progress, total, found, currentName });
      },
    });

    const finalResults = Array.isArray(firstPass.results) ? firstPass.results : [];
    const finalStats = {
      ...(firstPass.stats || {}),
      requested: safeLimit,
      returnedCount: finalResults.length,
      mapsExhausted: finalResults.length < safeLimit,
    };

    setJobResults(jobId, finalResults, finalStats);
    updateJob(jobId, {
      status: "completed",
      progress: 100,
      currentName: null,
      found: finalStats?.returnedCount ?? finalResults.length,
      total: safeLimit,
      requested: safeLimit,
      uniqueFound: finalStats?.uniqueFound ?? finalResults.length,
      returnedCount: finalStats?.returnedCount ?? finalResults.length,
      duplicateSkippedCount: finalStats?.duplicateSkippedCount ?? 0,
      excludedCount: finalStats?.excludedCount ?? 0,
      failedCount: finalStats?.failedCount ?? 0,
      missingCoreFieldsCount: finalStats?.missingCoreFieldsCount ?? 0,
      processedCount: finalStats?.processedCount ?? 0,
      candidateUrlCount: finalStats?.candidateUrlCount ?? 0,
      mapsExhausted: Boolean(finalStats?.mapsExhausted),
    });
  } catch (err) {
    updateJob(jobId, {
      status: "failed",
      error: err?.message || "Scrape failed",
      currentName: null,
    });
  }
}
