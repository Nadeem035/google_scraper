import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportsDir = path.join(__dirname, "..", "exports");

function ensureExportsDir() {
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
}

/**
 * Build leads.xlsx with Sr No, Search Query, Name, Phone, Website, Address, Rating, Reviews, Status, Email, Priority, Tags.
 */
export async function writeLeadsWorkbook(rows, { appendFromPath, searchQuery } = {}) {
  ensureExportsDir();
  const workbook = new ExcelJS.Workbook();
  let sheet;

  if (appendFromPath && fs.existsSync(appendFromPath)) {
    await workbook.xlsx.readFile(appendFromPath);
    sheet = workbook.getWorksheet("Leads") || workbook.addWorksheet("Leads");
  } else {
    sheet = workbook.addWorksheet("Leads");
    sheet.columns = [
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
      { header: "Priority", key: "priority", width: 12 },
      { header: "Tags", key: "tags", width: 24 },
    ];
  }

  let startSr = 1;
  if (sheet.rowCount > 1) {
    let maxSr = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const v = row.getCell(1).value;
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      if (!Number.isNaN(n)) maxSr = Math.max(maxSr, n);
    });
    startSr = maxSr + 1;
  }

  rows.forEach((r, i) => {
    sheet.addRow({
      sr: startSr + i,
      searchQuery: r.searchQuery ?? searchQuery ?? "",
      name: r.name ?? "",
      phone: r.phone ?? "",
      website: r.website ?? "",
      address: r.address ?? "",
      rating: r.rating ?? "",
      reviews: r.reviews ?? "",
      status: r.status ?? "",
      email: r.email ?? "",
      priority: r.priority ?? "",
      tags: Array.isArray(r.tags) ? r.tags.join(", ") : r.tags ?? "",
    });
  });

  const filename = `leads-${Date.now()}.xlsx`;
  const outPath = path.join(exportsDir, filename);
  await workbook.xlsx.writeFile(outPath);
  return { filename, absolutePath: outPath };
}

export function getExportsDir() {
  return exportsDir;
}
