export function deriveProgress(job) {
  if (!job) {
    return {
      pct: 0,
      found: 0,
      total: 0,
      detail: "Ready when you are.",
    };
  }

  const total = Number(job.total || job.requested || 0);
  const found = Number(job.returnedCount || job.found || 0);
  const pct = total > 0 ? Math.min(100, Math.round((found / total) * 100)) : Number(job.progress || 0);

  let detail = job.currentName
    ? total > 0
      ? `${found}/${total} collected · Current: ${job.currentName}`
      : `Current: ${job.currentName}`
    : total > 0
      ? `${found}/${total} collected`
      : "Working…";

  if (job.status === "completed") {
    detail = `${job.returnedCount || found} leads ready`;
  }

  if (job.status === "failed") {
    detail = job.error || "Job failed";
  }

  return {
    pct,
    found,
    total,
    detail,
  };
}

export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTimestamp(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}