import { runMapsScrape } from "../scraper/mapsScraper.js";
import { updateJob, setJobResults } from "./jobStore.js";

/**
 * Background scrape: updates job store (no database — export is the source of truth).
 */
export async function executeScrapeJob(jobId, params) {
  const { query, location, limit, extractEmails } = params;
  try {
    updateJob(jobId, { status: "running", total: limit, progress: 0, found: 0 });

    const results = await runMapsScrape({
      query,
      location,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 120),
      extractEmails: extractEmails !== false,
      onProgress: ({ progress, total, found, currentName }) => {
        updateJob(jobId, { progress, total, found, currentName });
      },
    });

    setJobResults(jobId, results);
    updateJob(jobId, { status: "completed", progress: 100, currentName: null });
  } catch (err) {
    updateJob(jobId, {
      status: "failed",
      error: err?.message || "Scrape failed",
      currentName: null,
    });
  }
}
