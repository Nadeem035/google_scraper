import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportsDir = path.join(__dirname, "..", "exports");

function ensureExportsDir() {
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
}

function slugifyFilePart(value) {
  return (
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[\'"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "leads"
  );
}

export function buildExportFilename(searchQuery) {
  const base = slugifyFilePart(searchQuery);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${base}-${stamp}.xlsx`;
}

/**
 * Build leads.xlsx with multiple sheets:
 * - All Data
 * - No Phone
 * - No Website
 * - No Phone & Website
 * - No Facebook
 * - No Instagram
 */
export async function writeLeadsWorkbook(rows, { appendFromPath, searchQuery } = {}) {
  ensureExportsDir();
  const workbook = new ExcelJS.Workbook();
  const columns = [
    { header: "Sr No", key: "sr", width: 8 },
    { header: "Search Query", key: "searchQuery", width: 36 },
    { header: "Name", key: "name", width: 28 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Website", key: "website", width: 32 },
    { header: "Address", key: "address", width: 40 },
    { header: "Rating", key: "rating", width: 10 },
    { header: "Reviews", key: "reviews", width: 10 },
    { header: "Status", key: "status", width: 14 },
    { header: "Email", key: "email", width: 28 },
    { header: "Facebook", key: "facebook", width: 34 },
    { header: "Instagram", key: "instagram", width: 34 },
    { header: "LinkedIn", key: "linkedin", width: 34 },
    { header: "Twitter/X", key: "twitter", width: 34 },
    { header: "YouTube", key: "youtube", width: 34 },
    { header: "TikTok", key: "tiktok", width: 34 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Tags", key: "tags", width: 24 },
  ];

  if (appendFromPath && fs.existsSync(appendFromPath)) {
    await workbook.xlsx.readFile(appendFromPath);
  }

  function ensureSheet(name) {
    const s = workbook.getWorksheet(name) || workbook.addWorksheet(name);
    if (!s.columns || s.columns.length < 5) {
      s.columns = columns;
    } else {
      // Ensure new columns exist when appending old files
      if (s.columns.length < columns.length) s.columns = columns;
    }
    return s;
  }

  function nextSr(s) {
    let start = 1;
    if (s.rowCount > 1) {
      let maxSr = 0;
      s.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const v = row.getCell(1).value;
        const n = typeof v === "number" ? v : parseInt(String(v), 10);
        if (!Number.isNaN(n)) maxSr = Math.max(maxSr, n);
      });
      start = maxSr + 1;
    }
    return start;
  }

  const allSheet = ensureSheet("All Data");
  const noPhoneSheet = ensureSheet("No Phone");
  const noWebsiteSheet = ensureSheet("No Website");
  const noPhoneWebsiteSheet = ensureSheet("No Phone & Website");
  const noFacebookSheet = ensureSheet("No Facebook");
  const noInstagramSheet = ensureSheet("No Instagram");

  const sr = {
    all: nextSr(allSheet),
    noPhone: nextSr(noPhoneSheet),
    noWebsite: nextSr(noWebsiteSheet),
    noPhoneWebsite: nextSr(noPhoneWebsiteSheet),
    noFacebook: nextSr(noFacebookSheet),
    noInstagram: nextSr(noInstagramSheet),
  };

  const has = (v) => Boolean(String(v || "").trim());

  function rowToExcel(r, srNo) {
    const socials = r.socials || {};
    return {
      sr: srNo,
      searchQuery: r.searchQuery ?? searchQuery ?? "",
      name: r.name ?? "",
      phone: r.phone ?? "",
      website: r.website ?? "",
      address: r.address ?? "",
      rating: r.rating ?? "",
      reviews: r.reviews ?? "",
      status: r.status ?? "",
      email: r.email ?? "",
      facebook: socials.facebook ?? "",
      instagram: socials.instagram ?? "",
      linkedin: socials.linkedin ?? "",
      twitter: socials.twitter ?? "",
      youtube: socials.youtube ?? "",
      tiktok: socials.tiktok ?? "",
      priority: r.priority ?? "",
      tags: Array.isArray(r.tags) ? r.tags.join(", ") : r.tags ?? "",
    };
  }

  rows.forEach((r) => {
    allSheet.addRow(rowToExcel(r, sr.all++));

    const phone = has(r.phone);
    const website = has(r.website);
    const fb = has(r.socials?.facebook);
    const ig = has(r.socials?.instagram);

    if (!phone) noPhoneSheet.addRow(rowToExcel(r, sr.noPhone++));
    if (!website) noWebsiteSheet.addRow(rowToExcel(r, sr.noWebsite++));
    if (!phone && !website)
      noPhoneWebsiteSheet.addRow(rowToExcel(r, sr.noPhoneWebsite++));
    if (!fb) noFacebookSheet.addRow(rowToExcel(r, sr.noFacebook++));
    if (!ig) noInstagramSheet.addRow(rowToExcel(r, sr.noInstagram++));
  });

  const filename = buildExportFilename(searchQuery);
  const outPath = path.join(exportsDir, filename);
  await workbook.xlsx.writeFile(outPath);
  return { filename, absolutePath: outPath };
}

export function getExportsDir() {
  return exportsDir;
}
