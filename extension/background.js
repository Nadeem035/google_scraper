import { buildCsv, buildExportFilename } from "./shared/export.js";
import { dedupeLeads, normalizeLead } from "./shared/lead-utils.js";
import {
  getStoredState,
  patchStoredState,
  setStoredState,
  updateSettings,
} from "./shared/storage.js";

const MAPS_URL_PREFIX = "https://www.google.com/maps";
const MAX_LIMIT = 500;
const MAX_EXTRACT_RETRIES = 2;

async function broadcastState() {
  const state = await getStoredState();
  try {
    await chrome.runtime.sendMessage({ type: "STATE_UPDATED", state });
  } catch {
    // No listening extension page is open.
  }
}

function buildMapsSearchUrl(query, location) {
  const search = [String(query || "").trim(), String(location || "").trim()]
    .filter(Boolean)
    .join(" ");
  return `${MAPS_URL_PREFIX}/search/${encodeURIComponent(search)}`;
}

function createJob(payload) {
  const searchQuery = [payload.query, payload.location].filter(Boolean).join(" ");
  return {
    id: `job_${Date.now()}`,
    status: "queued",
    progress: 0,
    total: payload.limit,
    found: 0,
    requested: payload.limit,
    currentName: null,
    searchQuery,
    results: [],
    startedAt: Date.now(),
    processedCount: 0,
    failedCount: 0,
    candidateUrlCount: 0,
  };
}

function toSafeLimit(value, fallback = 25) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

const BLOCKED_EMAIL_DOMAINS = new Set([
  "example.com",
  "wixpress.com",
  "sentry.io",
  "schema.org",
]);

function decodeHtmlEntities(input) {
  return String(input || "")
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/&#46;|&period;/gi, ".")
    .replace(/&#x40;/gi, "@")
    .replace(/&#x2e;/gi, ".")
    .replace(/&amp;/gi, "&");
}

function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase().replace(/[),.;:]+$/g, "");
  if (!email.includes("@")) return "";
  const domain = email.split("@")[1] || "";
  if (!domain || BLOCKED_EMAIL_DOMAINS.has(domain)) return "";
  if (email.includes("..")) return "";
  return email;
}

function extractEmailsFromHtml(html) {
  const decoded = decodeHtmlEntities(html);
  const found = new Set();

  const textMatches = decoded.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  for (const candidate of textMatches) {
    const normalized = normalizeEmail(candidate);
    if (normalized) found.add(normalized);
  }

  const mailtoMatches = decoded.match(/mailto:([^"'\s?#<]+)/gi) || [];
  for (const mailtoRaw of mailtoMatches) {
    const value = decodeURIComponent(mailtoRaw.replace(/^mailto:/i, ""));
    const normalized = normalizeEmail(value);
    if (normalized) found.add(normalized);
  }

  return [...found];
}

function buildContactCandidateUrls(websiteUrl) {
  try {
    const base = new URL(websiteUrl);
    const root = `${base.protocol}//${base.host}`;
    const candidates = [
      websiteUrl,
      root,
      `${root}/contact`,
      `${root}/contact-us`,
      `${root}/about`,
      `${root}/about-us`,
    ];
    return [...new Set(candidates)];
  } catch {
    return [websiteUrl];
  }
}

async function fetchHtml(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    });
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Content script request failed"));
        return;
      }
      resolve(response.result);
    });
  });
}

async function sendTabMessageWithRetry(tabId, message, retries = 6) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await sendTabMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  throw lastError || new Error("Unable to reach Maps content script");
}

async function updateActiveJob(patch) {
  const state = await getStoredState();
  const job = {
    ...(state.activeJob || {}),
    ...patch,
  };
  const nextState = await patchStoredState({ activeJob: job, lastError: "" });
  await broadcastState();
  return nextState;
}

async function fetchContactDetails(websiteUrl) {
  if (!websiteUrl || !/^https?:\/\//i.test(websiteUrl)) {
    return { email: "" };
  }

  const urls = buildContactCandidateUrls(websiteUrl).slice(0, 6);
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const emails = extractEmailsFromHtml(html);
      if (emails.length > 0) {
        return { email: emails[0] };
      }
    } catch {
      // Try next candidate URL.
    }
  }

  return { email: "" };
}

async function finalizeJob(statusPatch) {
  const state = await getStoredState();
  const completedJob = {
    ...(state.activeJob || {}),
    ...statusPatch,
    finishedAt: Date.now(),
  };
  const nextState = await patchStoredState({
    activeJob: statusPatch.status === "running" ? completedJob : null,
    scraperSession: statusPatch.status === "running" ? state.scraperSession : null,
    lastCompletedJob: statusPatch.status === "completed" ? completedJob : state.lastCompletedJob,
    lastError: statusPatch.status === "failed" ? completedJob.error || "Scrape failed" : "",
  });
  await broadcastState();
  return nextState;
}

async function cleanupScraperSession({ keepCompletedJob = true } = {}) {
  const state = await getStoredState();
  const session = state.scraperSession;
  const nextState = await patchStoredState({
    scraperSession: null,
    activeJob: keepCompletedJob ? state.activeJob : null,
  });
  await broadcastState();

  if (session?.tabId && state.settings.closeScrapeTabOnFinish) {
    try {
      await chrome.tabs.remove(session.tabId);
    } catch {
      // Ignore cleanup failures.
    }
  }
  return nextState;
}

async function completeSession(jobPatch) {
  const safeResults = Array.isArray(jobPatch.results) ? jobPatch.results : [];
  const requested = toSafeLimit(jobPatch.requested ?? jobPatch.total ?? safeResults.length, safeResults.length);
  const uniqueResults = dedupeLeads(safeResults).slice(0, requested);

  if (uniqueResults.length === 0) {
    return failSession("No extractable business details found. Try a broader query or lower limit.");
  }

  await finalizeJob({
    status: "completed",
    progress: 100,
    currentName: null,
    ...jobPatch,
    total: requested,
    requested,
    results: uniqueResults,
    found: uniqueResults.length,
    returnedCount: uniqueResults.length,
    uniqueFound: uniqueResults.length,
    duplicateBackfillCount: 0,
    fulfilledExact: uniqueResults.length >= requested,
    mapsExhausted: uniqueResults.length < requested,
  });
  await cleanupScraperSession({ keepCompletedJob: false });
  return getStoredState();
}

async function failSession(errorMessage) {
  await finalizeJob({
    status: "failed",
    error: errorMessage,
    currentName: null,
  });
  await cleanupScraperSession({ keepCompletedJob: false });
  return getStoredState();
}

async function updateScraperSession(patch) {
  const state = await getStoredState();
  const session = {
    ...(state.scraperSession || {}),
    ...patch,
  };
  return patchStoredState({ scraperSession: session });
}

function calculateProgress(currentIndex, total) {
  if (!total) return 0;
  return Math.max(1, Math.min(99, Math.round((currentIndex / total) * 100)));
}

async function advanceToNextPlace(session, results) {
  const nextIndex = session.placeIndex + 1;
  if (results.length >= session.payload.limit || nextIndex >= session.placeUrls.length) {
    return completeSession({
      results,
      fulfilledExact: results.length >= session.payload.limit,
      total: session.payload.limit,
      requested: session.payload.limit,
      processedCount: nextIndex,
      candidateUrlCount: session.placeUrls.length,
    });
  }

  await updateScraperSession({
    placeIndex: nextIndex,
    results,
    busy: false,
    stage: "extract-place",
  });
  await chrome.tabs.update(session.tabId, { url: session.placeUrls[nextIndex] });
  return getStoredState();
}

async function handleMapsPageReady(senderTabId) {
  const state = await getStoredState();
  const session = state.scraperSession;

  if (!session || senderTabId !== session.tabId || session.busy) {
    return state;
  }

  if (session.stage === "collect-links") {
    await updateScraperSession({ busy: true });
    await updateActiveJob({ status: "running", currentName: "Collecting business links" });

    const placeUrls = await sendTabMessageWithRetry(session.tabId, {
      type: "COLLECT_PLACE_LINKS",
      limit: Math.max(session.payload.limit * state.settings.candidateMultiplier, session.payload.limit),
    });

    if (!Array.isArray(placeUrls) || placeUrls.length === 0) {
      return failSession("No business results found on Google Maps");
    }

    await updateScraperSession({
      stage: "extract-place",
      placeUrls,
      placeIndex: 0,
      busy: false,
    });
    await updateActiveJob({
      status: "running",
      total: session.payload.limit,
      requested: session.payload.limit,
      candidateUrlCount: placeUrls.length,
      currentName: `Found ${placeUrls.length} candidates. Starting extraction`,
      progress: 36,
    });
    await chrome.tabs.update(session.tabId, { url: placeUrls[0] });
    return getStoredState();
  }

  if (session.stage === "extract-place") {
    await updateScraperSession({ busy: true });
    let rawLead = null;
    let extractError = null;
    for (let attempt = 0; attempt < MAX_EXTRACT_RETRIES; attempt += 1) {
      try {
        rawLead = await sendTabMessageWithRetry(session.tabId, {
          type: "EXTRACT_PLACE",
          attempt: attempt + 1,
        });
        if (rawLead && (rawLead.name || rawLead.phone || rawLead.address || rawLead.website)) {
          break;
        }
      } catch (error) {
        extractError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    const candidateLead = rawLead && (rawLead.name || rawLead.phone || rawLead.address || rawLead.website)
      ? normalizeLead({
          ...rawLead,
          ...(session.payload.extractEmails && rawLead.website
            ? await fetchContactDetails(rawLead.website)
            : { email: "" }),
        })
      : null;

    const nextResults = dedupeLeads([
      ...(session.results || []),
      ...(candidateLead ? [candidateLead] : []),
    ]).slice(0, session.payload.limit);

    await updateActiveJob({
      status: "running",
      currentName:
        candidateLead?.name ||
        (extractError ? `Skipped candidate ${session.placeIndex + 1}` : `Scanning candidate ${session.placeIndex + 1}`),
      progress: calculateProgress(session.placeIndex + 1, Math.max(session.placeUrls.length, 1)),
      results: nextResults,
      found: nextResults.length,
      returnedCount: nextResults.length,
      processedCount: session.placeIndex + 1,
      failedCount: (state.activeJob?.failedCount || 0) + (candidateLead ? 0 : 1),
      total: session.payload.limit,
      requested: session.payload.limit,
    });

    return advanceToNextPlace(session, nextResults);
  }

  return state;
}

async function handleMapsProgress(senderTabId, message) {
  const state = await getStoredState();
  const session = state.scraperSession;

  if (!session || senderTabId !== session.tabId) {
    return state;
  }

  const phase = String(message.phase || "");
  if (phase === "collect-links") {
    const roundsCompleted = Number(message.roundsCompleted || 0);
    const totalRounds = Math.max(1, Number(message.totalRounds || 1));
    const linkCount = Number(message.linkCount || 0);
    const progress = Math.max(2, Math.min(35, Math.round((roundsCompleted / totalRounds) * 35)));

    await updateActiveJob({
      status: "running",
      progress,
      currentName: `Collecting business links (${linkCount} found)`,
    });
  }

  if (phase === "extract-place") {
    await updateActiveJob({
      status: "running",
      currentName: String(message.name || "Extracting business details"),
    });
  }

  return getStoredState();
}

async function handleStartScrape(message) {
  const state = await getStoredState();
  const safeLimit = toSafeLimit(
    message.limit,
    toSafeLimit(state.settings?.defaultLimit || 25, 25)
  );

  const payload = {
    query: String(message.query || "").trim(),
    location: String(message.location || "").trim(),
    limit: safeLimit,
    extractEmails: Boolean(message.extractEmails),
  };

  if (!payload.query) {
    throw new Error("Keyword is required");
  }

  if (state.activeJob?.status === "running" || state.activeJob?.status === "queued") {
    throw new Error("A scrape is already running");
  }

  const searchTab = await chrome.tabs.create({
    url: buildMapsSearchUrl(payload.query, payload.location),
    active: false,
  });

  const job = createJob(payload);
  const nextState = await patchStoredState({
    activeJob: {
      ...job,
      status: "running",
      total: payload.limit,
      requested: payload.limit,
      currentName: "Opening Google Maps",
    },
    scraperSession: {
      tabId: searchTab.id,
      payload,
      stage: "collect-links",
      placeUrls: [],
      placeIndex: 0,
      results: [],
      busy: false,
    },
    draft: payload,
    lastCompletedJob: null,
    lastError: "",
  });
  await broadcastState();

  return nextState;
}

async function handleSaveSettings(message) {
  const nextState = await updateSettings(message.settings || {});
  await broadcastState();
  return nextState;
}

async function handleExportResults() {
  const state = await getStoredState();
  const job = state.lastCompletedJob || state.activeJob;

  if (!job || !Array.isArray(job.results) || job.results.length === 0) {
    throw new Error("No results available to export");
  }

  // Use data URL in MV3 service worker context (object URLs are not reliable here).
  const csv = `\uFEFF${buildCsv(job.results)}`;
  const downloadUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const filename = buildExportFilename(job.searchQuery || state.draft.query);

  await chrome.downloads.download({
    url: downloadUrl,
    filename,
    saveAs: true,
  });

  const nextState = await patchStoredState({ lastError: "" });
  await broadcastState();
  return nextState;
}

async function handlePrefillFromMaps(message) {
  const query = String(message.query || "").trim();
  const location = String(message.location || "").trim();
  const nextState = await patchStoredState({
    draft: {
      query,
      location,
      limit: Number(message.limit || 50),
      extractEmails: true,
    },
    lastMapsCapture: {
      query,
      location,
      mapsUrl: String(message.mapsUrl || ""),
      capturedAt: Date.now(),
    },
  });
  await broadcastState();
  return nextState;
}

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return getStoredState();
    case "SAVE_SETTINGS":
      return handleSaveSettings(message);
    case "START_SCRAPE":
      return handleStartScrape(message);
    case "REFRESH_JOB":
      return getStoredState();
    case "EXPORT_RESULTS":
      return handleExportResults();
    case "PREFILL_FROM_MAPS":
      return handlePrefillFromMaps(message);
    case "MAPS_PAGE_READY":
      return handleMapsPageReady(message.tabId);
    case "MAPS_PROGRESS":
      return handleMapsProgress(message.tabId, message);
    default:
      throw new Error("Unsupported message type");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void setStoredState({});
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const routedMessage =
    message?.type === "MAPS_PAGE_READY" || message?.type === "MAPS_PROGRESS"
      ? { ...message, tabId: sender.tab?.id }
      : message;

  handleMessage(routedMessage)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Request failed" }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await getStoredState();
    if (state.scraperSession?.tabId === tabId) {
      await failSession("The Google Maps scrape tab was closed before completion");
    }
  })();
});