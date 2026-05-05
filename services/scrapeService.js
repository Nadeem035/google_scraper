import { runMapsScrape } from "../scraper/mapsScraper.js";
import { updateJob, setJobResults } from "./jobStore.js";

/**
 * Background scrape: updates job store (no database — export is the source of truth).
 */
export async function executeScrapeJob(jobId, params) {
  const { query, location, limit, extractEmails, excludeUrls } = params;
  try {
    const locationText = String(location || "").trim();
    const fullSearchQuery = [String(query || "").trim(), locationText]
      .filter(Boolean)
      .join(" ");
    const requestedLimit = Math.max(Number(limit) || 50, 1);
    const safeLimit = Math.min(requestedLimit, 500);
    const safeExcludeUrls = Array.isArray(excludeUrls) ? excludeUrls : [];
    updateJob(jobId, { status: "running", total: safeLimit, requested: safeLimit, progress: 0, found: 0 });

    const firstPass = await runMapsScrape({
      query,
      location: locationText,
      limit: safeLimit,
      extractEmails: extractEmails !== false,
      excludeUrls: safeExcludeUrls,
      allowDuplicateBackfill: true,
      completenessMode: "max",
      onProgress: ({ progress, total, found, currentName }) => {
        updateJob(jobId, { progress, total, found, currentName });
      },
    });

    let finalResults = Array.isArray(firstPass.results) ? [...firstPass.results] : [];
    let finalStats = {
      ...(firstPass.stats || {}),
      requested: safeLimit,
      returnedCount: finalResults.length,
      mapsExhausted: finalResults.length < safeLimit,
    };

    // If exclusions make the first pass too short, run a refill pass without exclusions.
    if (finalResults.length < safeLimit && safeExcludeUrls.length > 0) {
      updateJob(jobId, {
        status: "running",
        currentName: "Refilling from previously seen results",
      });

      const refillPass = await runMapsScrape({
        query,
        location,
        limit: safeLimit,
        extractEmails: extractEmails !== false,
        excludeUrls: [],
        allowDuplicateBackfill: true,
        completenessMode: "max",
        onProgress: ({ currentName }) => {
          const found = Math.min(safeLimit, finalResults.length);
          updateJob(jobId, {
            progress: Math.round((found / Math.max(safeLimit, 1)) * 100),
            total: safeLimit,
            found,
            currentName,
          });
        },
      });

      const refillRows = Array.isArray(refillPass.results) ? refillPass.results : [];
      for (const row of refillRows) {
        if (finalResults.length >= safeLimit) break;
        finalResults.push({
          ...row,
          refillSource: "seen_reuse",
        });
      }

      // Mark as mapsExhausted if candidate pool didn't grow in the refill pass either.
      const totalAfterRefill = finalResults.length;
      finalStats = {
        ...finalStats,
        returnedCount: totalAfterRefill,
        fulfilledExact: totalAfterRefill >= safeLimit,
        mapsExhausted: totalAfterRefill < safeLimit,
        refillFromSeenCount: Math.max(0, totalAfterRefill - (firstPass.results?.length || 0)),
        firstPassReturnedCount: firstPass.results?.length || 0,
      };
    }

    // If location-scoped results are still short, widen to query-only mode.
    if (finalResults.length < safeLimit && locationText) {
      updateJob(jobId, {
        status: "running",
        currentName: "Widening search scope (query without location)",
      });

      const widenedPass = await runMapsScrape({
        query,
        location: "",
        limit: safeLimit,
        extractEmails: extractEmails !== false,
        excludeUrls: [],
        allowDuplicateBackfill: true,
        completenessMode: "max",
        onProgress: ({ currentName }) => {
          const found = Math.min(safeLimit, finalResults.length);
          updateJob(jobId, {
            progress: Math.round((found / Math.max(safeLimit, 1)) * 100),
            total: safeLimit,
            found,
            currentName,
          });
        },
      });

      const beforeWiden = finalResults.length;
      const widenedRows = Array.isArray(widenedPass.results) ? widenedPass.results : [];
      for (const row of widenedRows) {
        if (finalResults.length >= safeLimit) break;
        finalResults.push({
          ...row,
          searchQuery: fullSearchQuery,
          widenedScope: true,
        });
      }

      const widenedAddedCount = Math.max(0, finalResults.length - beforeWiden);
      finalStats = {
        ...finalStats,
        returnedCount: finalResults.length,
        fulfilledExact: finalResults.length >= safeLimit,
        mapsExhausted: finalResults.length < safeLimit,
        widenedScopeAddedCount: widenedAddedCount,
      };
    }

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
      duplicateBackfillCount: finalStats?.duplicateBackfillCount ?? 0,
      duplicateSkippedCount: finalStats?.duplicateSkippedCount ?? 0,
      excludedCount: finalStats?.excludedCount ?? 0,
      failedCount: finalStats?.failedCount ?? 0,
      missingCoreFieldsCount: finalStats?.missingCoreFieldsCount ?? 0,
      processedCount: finalStats?.processedCount ?? 0,
      candidateUrlCount: finalStats?.candidateUrlCount ?? 0,
      fulfilledExact: Boolean(finalStats?.fulfilledExact),
      mapsExhausted: Boolean(finalStats?.mapsExhausted),
      refillFromSeenCount: finalStats?.refillFromSeenCount ?? 0,
      firstPassReturnedCount: finalStats?.firstPassReturnedCount ?? 0,
      widenedScopeAddedCount: finalStats?.widenedScopeAddedCount ?? 0,
    });
  } catch (err) {
    updateJob(jobId, {
      status: "failed",
      error: err?.message || "Scrape failed",
      currentName: null,
    });
  }
}
