export function classifyLead(lead) {
  const hasPhone = Boolean(String(lead.phone || "").trim());
  const hasWebsite = Boolean(String(lead.website || "").trim());

  if (hasPhone && hasWebsite) return "High Value";
  if (hasPhone) return "Call Lead";
  if (hasWebsite) return "Website Lead";
  return "Low Quality";
}

export function scoreLead(lead) {
  const rating = Number.parseFloat(String(lead.rating || "").replace(",", "."));
  const priority = Number.isFinite(rating) && rating >= 4.3 ? "high" : rating >= 3.8 ? "medium" : "low";
  const tags = [];
  if (!String(lead.website || "").trim()) {
    tags.push("opportunity");
  }
  return { priority, tags };
}

export function normalizeLead(lead) {
  const status = classifyLead(lead);
  const { priority, tags } = scoreLead(lead);
  return {
    ...lead,
    status,
    priority,
    tags,
  };
}

export function dedupeLeads(leads) {
  const seen = new Set();
  const output = [];

  for (const lead of leads) {
    const key = [
      String(lead.mapsUrl || "").trim().toLowerCase(),
      String(lead.phone || "").replace(/\D/g, ""),
      String(lead.name || "").trim().toLowerCase(),
    ]
      .filter(Boolean)
      .join("|");

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(lead);
  }

  return output;
}