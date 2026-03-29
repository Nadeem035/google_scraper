import { createJob, getJob } from "../services/jobStore.js";
import { executeScrapeJob } from "../services/scrapeService.js";

export async function postScrape(req, res, next) {
  try {
    const { query, location, limit, extractEmails, excludeUrls } = req.body || {};
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "query is required" });
    }
    const safeExclude =
      Array.isArray(excludeUrls) && excludeUrls.length
        ? excludeUrls
            .filter((u) => typeof u === "string")
            .map((u) => u.trim())
            .filter(Boolean)
            .slice(0, 800)
        : [];

    const searchQuery = [query.trim(), (location || "").trim()]
      .filter(Boolean)
      .join(" ");

    const jobId = createJob({
      searchQuery,
      status: "queued",
      progress: 0,
      total: Number(limit) || 50,
      currentName: null,
      results: [],
      error: null,
    });

    executeScrapeJob(jobId, {
      query: query.trim(),
      location: (location || "").trim(),
      limit: Number(limit) || 50,
      extractEmails,
      excludeUrls: safeExclude,
    }).catch(() => {
      /* errors recorded in job */
    });

    return res.status(202).json({ jobId, message: "Scrape started" });
  } catch (e) {
    next(e);
  }
}

export function getJobStatus(req, res, next) {
  try {
    const { jobId } = req.params;
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    return res.json(job);
  } catch (e) {
    next(e);
  }
}
