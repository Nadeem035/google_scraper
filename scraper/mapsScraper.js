import fs from "fs";
import puppeteer from "puppeteer";
import { getNextProxyServer } from "../utils/proxyManager.js";
import { classifyLead } from "../utils/classifyLead.js";
import { scoreLead } from "../utils/leadScore.js";
import { extractContactsFromUrl } from "../utils/contactExtractor.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Only use a browser path if the file exists. Puppeteer's executablePath() can point
 * at a cache location where `npx puppeteer browsers install` never ran or was wiped on deploy.
 */
function fileExists(p) {
  if (!p || typeof p !== "string") return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** First usable Chrome/Chromium binary, or null. */
function resolveChromeExecutable() {
  const candidates = [];

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH.trim());
  }
  try {
    const fromPkg = puppeteer.executablePath();
    if (fromPkg) candidates.push(fromPkg);
  } catch {
    /* no bundled revision registered */
  }

  if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  }

  for (const p of candidates) {
    if (fileExists(p)) return p;
  }
  return null;
}

/**
 * Prefer real binary on disk; Windows/macOS can fall back to system Chrome channel.
 * Set PUPPETEER_EXECUTABLE_PATH on the server if Chromium lives elsewhere.
 */
function buildPuppeteerLaunchOptions(proxyServer) {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1400,900",
  ];
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }

  const opts = {
    headless: true,
    args,
  };

  const resolved = resolveChromeExecutable();
  if (resolved) {
    opts.executablePath = resolved;
    return opts;
  }

  if (process.platform === "win32" || process.platform === "darwin") {
    opts.channel = "chrome";
    return opts;
  }

  return opts;
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
async function collectPlaceLinks(page, maxLinks) {
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
  }, maxLinks);
  return hrefs;
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
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(randomBetween(1500, 3000));
      const data = await scrapePlacePage(page);
      const hasMinimumFields = Boolean(data.name || data.phone || data.address);
      return {
        ...data,
        mapsUrl: data.mapsUrl || url,
        scrapeAttempts: attempt + 1,
        scrapeFailed: false,
        missingCoreFields: !hasMinimumFields,
      };
    } catch (e) {
      lastError = e;
      if (attempt === retries) break;
      await sleep(randomBetween(2000, 4000));
    }
  }
  return {
    name: "",
    category: "",
    phone: "",
    website: "",
    address: "",
    rating: "",
    reviews: "",
    mapsUrl: url,
    scrapeAttempts: retries + 1,
    scrapeFailed: true,
    scrapeError: lastError?.message || "Scrape failed",
    missingCoreFields: true,
  };
}

/**
 * Run Google Maps scrape: keyword + optional location, up to limit results.
 * @param {object} opts
 * @param {(p: { progress: number, total: number, found: number, currentName: string|null }) => void} [opts.onProgress]
 */
export async function runMapsScrape({
  query,
  location = "",
  limit = 50,
  extractEmails = true,
  excludeUrls = [],
  proxyForEmail,
  onProgress,
}) {
  const fullQuery = [query, location].filter(Boolean).join(" ").trim();
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;

  const proxy = getNextProxyServer();
  const launchOpts = buildPuppeteerLaunchOptions(proxy);
  if (
    process.platform === "linux" &&
    !launchOpts.executablePath &&
    !launchOpts.channel
  ) {
    throw new Error(
      "Chrome/Chromium not found on the server. From your app directory run: npm run install:browsers (or npm install with lifecycle scripts enabled). On a VPS you can install Google Chrome and set PUPPETEER_EXECUTABLE_PATH to its binary path."
    );
  }
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const uniqueLeads = [];
  let excludedCount = 0;
  let failedCount = 0;
  let duplicateSkippedCount = 0;
  let missingCoreFieldsCount = 0;
  let processedCount = 0;
  let candidateUrlCount = 0;
  const excludeUrlSet = new Set(
    (Array.isArray(excludeUrls) ? excludeUrls : [])
      .filter((u) => typeof u === "string")
      .map((u) => u.trim())
      .filter(Boolean)
  );
  const seenPhones = new Set();
  const seenNames = new Set();

  const normalizePhone = (p) => (p ? String(p).replace(/\D/g, "") : "");
  const normalizeName = (n) =>
    n ? String(n).toLowerCase().replace(/\s+/g, " ").trim() : "";

  const recordLead = (row) => {
    const ph = normalizePhone(row.phone);
    const nm = normalizeName(row.name);
    const diagnostics = Array.isArray(row.diagnostics) ? [...row.diagnostics] : [];
    let duplicateReason = "";

    if (ph && seenPhones.has(ph)) duplicateReason = "duplicate_phone";
    else if (!ph && nm && seenNames.has(nm)) duplicateReason = "duplicate_name";

    if (duplicateReason) {
      duplicateSkippedCount += 1;
      return; // skip duplicates entirely
    }

    if (ph) seenPhones.add(ph);
    if (nm) seenNames.add(nm);

    row.diagnostics = [...new Set(diagnostics)];
    uniqueLeads.push(row);
  };

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await humanDelay();
    await scrollFeed(page, 4);

    // Keep scrolling / collecting until we have enough URLs, or no more are loading.
    const urlSet = new Set();
    let stableRounds = 0;
    const maxCollectLinks = Math.max(180, limit * 10);
    const maxAttempts = 10;
    const stableRoundLimit = 2;
    const targetUrlPool = Math.max(120, limit * 3);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const found = await collectPlaceLinks(page, maxCollectLinks);
      for (const u of found) urlSet.add(u);

      // If we have plenty of URLs, stop scrolling early.
      if (urlSet.size >= targetUrlPool) break;

      const before = urlSet.size;
      await scrollFeed(page, 3);
      const foundAfter = await collectPlaceLinks(page, maxCollectLinks);
      for (const u of foundAfter) urlSet.add(u);

      if (urlSet.size === before) stableRounds += 1;
      else stableRounds = 0;

      // Two stable rounds usually means Maps isn't loading more results.
      if (stableRounds >= stableRoundLimit) break;
    }

    const placeUrls = [...urlSet];
    candidateUrlCount = placeUrls.length;
    const poolSize = Math.max(1, placeUrls.length);

    // Report the real pool size now that we know how many URLs Maps returned.
    onProgress?.({
      progress: 0,
      total: placeUrls.length,
      found: 0,
      currentName: null,
    });

    for (let i = 0; i < placeUrls.length; i += 1) {
      if (uniqueLeads.length >= limit) break;
      const url = placeUrls[i];
      onProgress?.({
        progress: Math.round(((i + 1) / poolSize) * 100),
        total: placeUrls.length,
        found: uniqueLeads.length,
        currentName: url,
      });

      let row = null;
      try {
        row = await scrapePlaceWithRetry(page, url, 1);
      } catch {
        row = {
          name: "",
          category: "",
          phone: "",
          website: "",
          address: "",
          rating: "",
          reviews: "",
          mapsUrl: url,
          scrapeFailed: true,
          scrapeError: "Scrape failed",
          missingCoreFields: true,
          diagnostics: ["scrape_failed"],
        };
      }

      row.searchQuery = fullQuery;
      row.mapsUrl = row.mapsUrl || url;
      if (row.mapsUrl && excludeUrlSet.has(row.mapsUrl)) {
        excludedCount += 1;
        row.isExcluded = true;
        row.excludeReason = "exclude_url_list";
        row.diagnostics = Array.isArray(row.diagnostics)
          ? [...new Set([...row.diagnostics, "exclude_url_list"])]
          : ["exclude_url_list"];
      }
      if (row.scrapeFailed) {
        failedCount += 1;
        row.diagnostics = Array.isArray(row.diagnostics)
          ? [...new Set([...row.diagnostics, "scrape_failed"])]
          : ["scrape_failed"];
      }
      if (row.missingCoreFields) {
        missingCoreFieldsCount += 1;
        row.diagnostics = Array.isArray(row.diagnostics)
          ? [...new Set([...row.diagnostics, "missing_core_fields"])]
          : ["missing_core_fields"];
      }

      row.status = row.scrapeFailed ? "Scrape Failed" : classifyLead(row);
      const { priority, tags } = scoreLead(row);
      row.priority = priority;
      row.tags = Array.isArray(tags) ? [...tags] : [];
      if (row.isDuplicate) row.tags.push(row.duplicateReason || "duplicate");
      if (row.isExcluded) row.tags.push("exclude_url_list");
      if (row.scrapeFailed) row.tags.push("scrape_failed");
      if (row.missingCoreFields) row.tags.push("missing_core_fields");
      row.tags = [...new Set(row.tags)];
      row.email = "";
      row.socials = {
        facebook: "",
        instagram: "",
        linkedin: "",
        twitter: "",
        youtube: "",
        tiktok: "",
      };

      if (extractEmails && row.website) {
        const { emails, socials } = await extractContactsFromUrl(row.website, {
          proxyUrl: proxyForEmail,
        });
        row.email = emails[0] || "";
        row.socials = { ...row.socials, ...(socials || {}) };
      }

      recordLead(row);

      processedCount += 1;
      onProgress?.({
        progress: Math.round(((i + 1) / poolSize) * 100),
        total: placeUrls.length,
        found: uniqueLeads.length,
        currentName: row.name || null,
      });

      await sleep(randomBetween(2000, 4500));
    }
  } finally {
    await browser.close();
  }

  const results = uniqueLeads;
  const returnedCount = results.length;
  return {
    results,
    stats: {
      requested: limit,
      uniqueFound: uniqueLeads.length,
      returnedCount,
      duplicateBackfillCount: 0,
      duplicateSkippedCount,
      excludedCount,
      failedCount,
      missingCoreFieldsCount,
      processedCount,
      candidateUrlCount,
      fulfilledExact: returnedCount >= limit,
    },
  };
}
