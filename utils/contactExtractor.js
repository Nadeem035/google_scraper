import axios from "axios";

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const BLOCKED_EMAIL_DOMAINS = new Set([
  "example.com",
  "sentry.io",
  "wixpress.com",
  "schema.org",
]);

function stripHtmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeUrl(u) {
  if (!u || typeof u !== "string") return "";
  const s = u.trim();
  if (!s) return "";
  if (s.startsWith("//")) return `https:${s}`;
  return s;
}

function canonicalSocial(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // keep query for some networks (e.g. ig, yt). Strip tracking params lightly.
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(
      (k) => u.searchParams.delete(k)
    );
    return u.toString();
  } catch {
    return "";
  }
}

function extractSocialsFromHtml(html, baseUrl) {
  const socials = {
    facebook: "",
    instagram: "",
    linkedin: "",
    twitter: "",
    youtube: "",
    tiktok: "",
  };

  const hrefs = [];
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    hrefs.push(m[1]);
  }

  const abs = hrefs
    .map(normalizeUrl)
    .map((h) => {
      try {
        return new URL(h, baseUrl).toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  for (const u of abs) {
    const lu = u.toLowerCase();
    if (!socials.facebook && /facebook\.com\//i.test(lu) && !/share|sharer/i.test(lu))
      socials.facebook = canonicalSocial(u);
    if (!socials.instagram && /instagram\.com\//i.test(lu))
      socials.instagram = canonicalSocial(u);
    if (!socials.linkedin && /linkedin\.com\//i.test(lu))
      socials.linkedin = canonicalSocial(u);
    if (
      !socials.twitter &&
      (/(twitter|x)\.com\//i.test(lu) || /t\.co\//i.test(lu))
    )
      socials.twitter = canonicalSocial(u);
    if (!socials.youtube && /(youtube\.com\/|youtu\.be\/)/i.test(lu))
      socials.youtube = canonicalSocial(u);
    if (!socials.tiktok && /tiktok\.com\//i.test(lu))
      socials.tiktok = canonicalSocial(u);
  }

  return socials;
}

function extractEmailsFromHtml(html) {
  const text = stripHtmlToText(html);
  const found = new Set();
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/[),.;]+$/, "");
    const domain = e.split("@")[1] || "";
    if (BLOCKED_EMAIL_DOMAINS.has(domain)) continue;
    if (e.includes("..")) continue;
    found.add(e);
  }
  return [...found].slice(0, 5);
}

/**
 * Fetch a website and extract emails + social profile URLs.
 */
export async function extractContactsFromUrl(
  url,
  { timeoutMs = 12000, proxyUrl } = {}
) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { emails: [], socials: {} };
  }

  const axiosConfig = {
    timeout: timeoutMs,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  };

  if (proxyUrl) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
    axiosConfig.httpAgent = new HttpsProxyAgent(proxyUrl);
  }

  try {
    const res = await axios.get(url, axiosConfig);
    const html = typeof res.data === "string" ? res.data : "";
    const emails = extractEmailsFromHtml(html);
    const socials = extractSocialsFromHtml(html, url);
    return { emails, socials };
  } catch {
    return { emails: [], socials: {} };
  }
}

