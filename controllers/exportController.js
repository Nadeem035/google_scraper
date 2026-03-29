import path from "path";
import fs from "fs";
import { getJob } from "../services/jobStore.js";
import { writeLeadsWorkbook, getExportsDir } from "../services/excelService.js";

function safeBasename(name) {
  if (!name || typeof name !== "string") return null;
  const base = path.basename(name);
  if (base.includes("..") || base.includes("/") || base.includes("\\"))
    return null;
  if (!/^leads-[\w.-]+\.xlsx$/i.test(base)) return null;
  return base;
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

    return res.json({
      file: filename,
      downloadUrl: `/api/download?file=${encodeURIComponent(filename)}`,
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
    return res.download(abs, "leads.xlsx");
  } catch (e) {
    next(e);
  }
}
