import axios from "axios";

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const BLOCKED = new Set([
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

/**
 * Fetch a page and extract plausible contact emails (regex + light filtering).
 */
export async function extractEmailsFromUrl(url, { timeoutMs = 12000, proxyUrl } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return [];

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
    const text = stripHtmlToText(html);
    const found = new Set();
    for (const m of text.matchAll(EMAIL_RE)) {
      const e = m[0].toLowerCase().replace(/[),.;]+$/, "");
      const domain = e.split("@")[1] || "";
      if (BLOCKED.has(domain)) continue;
      if (e.includes("..")) continue;
      found.add(e);
    }
    return [...found].slice(0, 5);
  } catch {
    return [];
  }
}
