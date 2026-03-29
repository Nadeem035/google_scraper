import puppeteer from "puppeteer";
import { getNextProxyServer } from "../utils/proxyManager.js";
import { classifyLead } from "../utils/classifyLead.js";
import { dedupeLeads } from "../utils/dedupeLeads.js";
import { scoreLead } from "../utils/leadScore.js";
import { extractEmailsFromUrl } from "../utils/emailExtractor.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

async function humanDelay() {
  await sleep(randomBetween(2000, 5000));
}

/**
 * Scroll the Maps result feed to load more listings.
 */
async function scrollFeed(page, rounds = 8) {
  const feedSel = 'div[role="feed"]';
  try {
    await page.waitForSelector(feedSel, { timeout: 45000 });
  } catch {
    return;
  }
  for (let i = 0; i < rounds; i += 1) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollBy(0, 400 + Math.random() * 400);
    }, feedSel);
    await sleep(randomBetween(800, 1600));
  }
}

/**
 * Collect unique /maps/place/ URLs from the current results view.
 */
async function collectPlaceLinks(page, limit) {
  const hrefs = await page.evaluate((max) => {
    const set = new Set();
    document.querySelectorAll('a[href*="/maps/place/"]').forEach((a) => {
      try {
        const u = new URL(a.href, location.origin);
        const path = u.pathname + u.search;
        if (path.includes("/maps/place/")) set.add(u.toString().split("?")[0]);
      } catch {
        /* ignore */
      }
    });
    return [...set].slice(0, max);
  }, limit + 5);
  return hrefs.slice(0, limit);
}

/**
 * Parse one place page for business fields (DOM varies by locale/layout).
 */
async function scrapePlacePage(page) {
  return page.evaluate(() => {
    const textOf = (el) => (el ? (el.textContent || "").trim() : "");

    const name =
      textOf(document.querySelector("h1")) ||
      textOf(document.querySelector('[data-item-id="title"]')) ||
      "";

    let category = "";
    const btn = document.querySelector('button[jsaction*="category"]');
    if (btn) category = textOf(btn);
    if (!category) {
      const alt = document.querySelector(
        'span[class*="fontBodyMedium"], button[class*="fontBodyMedium"]'
      );
      if (alt && alt !== document.querySelector("h1")) category = textOf(alt);
    }

    let phone = "";
    const phoneBtn = document.querySelector(
      'button[data-item-id*="phone"], a[data-item-id*="phone"]'
    );
    if (phoneBtn) {
      const d = phoneBtn.getAttribute("data-item-id") || "";
      const m = d.match(/phone:tel:([^:]+)/);
      if (m) phone = decodeURIComponent(m[1] || "").replace(/\s/g, " ");
      if (!phone) phone = textOf(phoneBtn).replace(/[^\d+()\-\s]/g, "").trim();
    }

    let website = "";
    const webA = document.querySelector(
      'a[data-item-id="authority"], a[href^="http"][data-tooltip*="website" i]'
    );
    if (webA) {
      website = webA.href || "";
      if (website.startsWith("http")) {
        try {
          const u = new URL(website);
          if (u.hostname.includes("google.")) website = "";
        } catch {
          website = "";
        }
      }
    }
    if (!website) {
      document.querySelectorAll('a[href^="http"]').forEach((a) => {
        const h = a.href || "";
        if (
          /google\.com|gstatic|schema\.org|maps\.google/i.test(h) ||
          website
        )
          return;
        if (/^https?:\/\/(www\.)?[-a-z0-9.]+\.[a-z]{2,}/i.test(h)) website = h;
      });
    }

    let address = "";
    const addrBtn = document.querySelector('button[data-item-id="address"]');
    if (addrBtn) address = textOf(addrBtn);

    let rating = "";
    let reviews = "";
    const rateEl = document.querySelector(
      'span[role="img"][aria-label*="star" i], div[aria-label*="star" i]'
    );
    if (rateEl) {
      const label = rateEl.getAttribute("aria-label") || "";
      const rm = label.match(/(\d+[.,]\d+)\s*star/i);
      if (rm) rating = rm[1].replace(",", ".");
    }
    document.querySelectorAll("span, button").forEach((el) => {
      const t = textOf(el);
      const m = t.match(/\((\d[\d,.]*)\)/);
      if (m && /review/i.test(t)) reviews = m[1].replace(/,/g, "");
    });
    if (!reviews) {
      const m2 = document.body.innerText.match(
        /([\d,]+)\s+reviews?/i
      );
      if (m2) reviews = m2[1].replace(/,/g, "");
    }

    const canonical =
      document.querySelector('link[rel="canonical"]')?.href ||
      location.href;

    if (!phone) {
      const body = document.body.innerText || "";
      const pm = body.match(/\+?\d[\d\s().-]{8,}\d/);
      if (pm) phone = pm[0].trim();
    }

    return {
      name,
      category,
      phone,
      website,
      address,
      rating,
      reviews,
      mapsUrl: canonical,
    };
  });
}

async function scrapePlaceWithRetry(page, url, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(randomBetween(1500, 3000));
      const data = await scrapePlacePage(page);
      if (data.name || data.phone || data.address) return data;
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(randomBetween(2000, 4000));
    }
  }
  return null;
}

/**
 * Run Google Maps scrape: keyword + optional location, up to limit results.
 * @param {object} opts
 * @param {(p: { progress: number, total: number, currentName: string|null }) => void} [opts.onProgress]
 */
export async function runMapsScrape({
  query,
  location = "",
  limit = 50,
  extractEmails = true,
  proxyForEmail,
  onProgress,
}) {
  const fullQuery = [query, location].filter(Boolean).join(" ").trim();
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;

  const proxy = getNextProxyServer();
  const launchOpts = {
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1400,900",
    ],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    launchOpts.channel = "chrome";
  }
  if (proxy) {
    launchOpts.args.push(`--proxy-server=${proxy}`);
  }

  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const raw = [];

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await humanDelay();
    await scrollFeed(page, Math.min(12, 4 + Math.ceil(limit / 15)));

    let placeUrls = await collectPlaceLinks(page, limit);
    if (placeUrls.length === 0) {
      await scrollFeed(page, 10);
      placeUrls = await collectPlaceLinks(page, limit);
    }

    const total = Math.min(placeUrls.length, limit);
    for (let i = 0; i < total; i += 1) {
      const url = placeUrls[i];
      onProgress?.({
        progress: Math.round((i / Math.max(total, 1)) * 100),
        total,
        currentName: url,
      });

      let row = null;
      try {
        row = await scrapePlaceWithRetry(page, url, 1);
      } catch {
        row = null;
      }
      if (!row) {
        onProgress?.({
          progress: Math.round(((i + 1) / Math.max(total, 1)) * 100),
          total,
          currentName: null,
        });
        continue;
      }

      row.searchQuery = fullQuery;
      row.mapsUrl = row.mapsUrl || url;
      row.status = classifyLead(row);
      const { priority, tags } = scoreLead(row);
      row.priority = priority;
      row.tags = tags;
      row.email = "";

      if (extractEmails && row.website) {
        const emails = await extractEmailsFromUrl(row.website, {
          proxyUrl: proxyForEmail,
        });
        row.email = emails[0] || "";
      }

      raw.push(row);
      onProgress?.({
        progress: Math.round(((i + 1) / Math.max(total, 1)) * 100),
        total,
        currentName: row.name || null,
      });

      await sleep(randomBetween(2000, 4500));
    }
  } finally {
    await browser.close();
  }

  const deduped = dedupeLeads(raw);
  return deduped;
}
