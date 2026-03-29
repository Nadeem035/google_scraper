/**
 * Priority: rating > 4.0 → high; no website → opportunity tag.
 */
export function scoreLead(lead) {
  const rating = parseFloat(lead.rating);
  const hasWebsite = Boolean(lead.website?.trim());
  const tags = [];
  let priority = "medium";

  if (!Number.isNaN(rating) && rating > 4.0) priority = "high";
  else if (!Number.isNaN(rating) && rating < 3.5) priority = "low";

  if (!hasWebsite) tags.push("opportunity");

  return { priority, tags };
}
