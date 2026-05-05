import path from "path";
import fs from "fs";
import { getJob } from "../services/jobStore.js";
import { writeLeadsWorkbook, getExportsDir } from "../services/excelService.js";

function safeBasename(name) {
  if (!name || typeof name !== "string") return null;
  const base = path.basename(name);
  if (base.includes("..") || base.includes("/") || base.includes("\\"))
    return null;
  if (!/^[\w.-]+\.xlsx$/i.test(base)) return null;
  return base;
}

function downloadNameFromSearchQuery(searchQuery) {
  const safe =
    String(searchQuery || "")
      .toLowerCase()
      .trim()
      .replace(/[\'"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "leads";
  return `${safe}.xlsx`;
}

function safeDownloadName(name) {
  return safeBasename(name) || "export.xlsx";
}

function makeContentDisposition(filename) {
  const safe = String(filename || "export.xlsx")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 200);
  return `attachment; filename="${safe}"`;
}

/**
 * Build Excel from completed job or explicit leads payload; optional append to prior file in exports/.
 */
export async function postExport(req, res, next) {
  try {
    const { jobId, leads, searchQuery, appendFile } = req.body || {};
    let rows =
      Array.isArray(leads) && leads.length > 0 ? leads : null;
    let q = searchQuery || "";

    if (!rows && jobId) {
      const job = getJob(jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      rows = job.results || [];
      q = job.searchQuery || q;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No leads to export" });
    }

    let appendFromPath;
    if (appendFile) {
      const safe = safeBasename(appendFile);
      if (safe) {
        const p = path.join(getExportsDir(), safe);
        if (fs.existsSync(p)) appendFromPath = p;
      }
    }

    const { filename } = await writeLeadsWorkbook(rows, {
      appendFromPath,
      searchQuery: q,
    });

    const dlName = downloadNameFromSearchQuery(q);
    return res.json({
      file: filename,
      downloadName: dlName,
      downloadUrl: `/api/download?file=${encodeURIComponent(filename)}&name=${encodeURIComponent(dlName)}`,
    });
  } catch (e) {
    next(e);
  }
}

export function getDownload(req, res, next) {
  try {
    const file = safeBasename(req.query.file);
    if (!file) return res.status(400).json({ error: "Invalid file" });
    const abs = path.join(getExportsDir(), file);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    const suggested = safeDownloadName(req.query.name);
    res.setHeader("Content-Disposition", makeContentDisposition(suggested));
    return res.sendFile(abs);
  } catch (e) {
    next(e);
  }
}
