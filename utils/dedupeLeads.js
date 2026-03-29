/**
 * Remove duplicates by normalized phone (digits) or fallback normalized name.
 */
function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/\D/g, "");
}

function normalizeName(n) {
  if (!n) return "";
  return String(n).toLowerCase().replace(/\s+/g, " ").trim();
}

export function dedupeLeads(leads) {
  const seenPhones = new Set();
  const seenNames = new Set();
  const out = [];
  for (const lead of leads) {
    const ph = normalizePhone(lead.phone);
    const nm = normalizeName(lead.name);
    if (ph && seenPhones.has(ph)) continue;
    if (!ph && nm && seenNames.has(nm)) continue;
    if (ph) seenPhones.add(ph);
    if (nm) seenNames.add(nm);
    out.push(lead);
  }
  return out;
}
