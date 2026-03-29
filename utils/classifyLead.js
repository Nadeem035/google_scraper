/**
 * Maps contact completeness to a lead status bucket.
 */
export function classifyLead(lead) {
  const phone = lead.phone?.trim();
  const website = lead.website?.trim();
  if (phone && website) return "High Value";
  if (phone) return "Call Lead";
  if (website) return "Website Lead";
  return "Low Quality";
}
