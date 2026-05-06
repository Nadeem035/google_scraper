function csvEscape(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(rows) {
  const headers = [
    "Name",
    "Category",
    "Phone",
    "Email",
    "Website",
    "Address",
    "Rating",
    "Reviews",
    "Status",
    "Priority",
    "Tags",
    "Maps URL",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = [
      row.name,
      row.category,
      row.phone,
      row.email,
      row.website,
      row.address,
      row.rating,
      row.reviews,
      row.status,
      row.priority,
      Array.isArray(row.tags) ? row.tags.join(" | ") : row.tags,
      row.mapsUrl,
    ].map(csvEscape);
    lines.push(values.join(","));
  }

  return lines.join("\r\n");
}

export function buildExportFilename(searchQuery) {
  const slug = String(searchQuery || "leads")
    .toLowerCase()
    .replace(/[\'"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "leads";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${slug}-${stamp}.csv`;
}