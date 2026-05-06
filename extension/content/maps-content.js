(function () {
  const BUTTON_ID = "lead-atlas-maps-capture";
  let lastReadyUrl = "";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function textOf(element) {
    return element ? String(element.textContent || "").trim() : "";
  }

  function canonicalizeMapsUrl(url) {
    try {
      const parsed = new URL(url, location.origin);
      if (!parsed.pathname.includes("/maps/place/")) return "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function collectPlaceAnchors(root = document) {
    const anchors = [];
    const seen = new Set();
    const selectors = [
      'a[href*="/maps/place/"]',
      'a[href*="/place/"]',
      'a[aria-label][href*="google.com/maps"]',
    ];

    selectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((anchor) => {
        const href = canonicalizeMapsUrl(anchor.href);
        if (!href || seen.has(href)) return;
        seen.add(href);
        anchors.push(href);
      });
    });

    return anchors;
  }

  async function waitForElement(selector, timeoutMs = 20000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const node = document.querySelector(selector);
      if (node) return node;
      await sleep(300);
    }
    return null;
  }

  async function waitForPlaceReady(timeoutMs = 9000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const name = document.querySelector("h1");
      const phone = document.querySelector('button[data-item-id*="phone"], a[data-item-id*="phone"]');
      const address = document.querySelector('button[data-item-id="address"]');
      const website = document.querySelector('a[data-item-id="authority"], a[href^="http"][data-tooltip*="website" i]');
      if (name || phone || address || website) {
        return true;
      }
      await sleep(300);
    }
    return false;
  }

  async function collectPlaceLinks(limit) {
    const feed = await waitForElement('div[role="feed"]', 12000);
    if (!feed) {
      return collectPlaceAnchors(document).slice(0, limit);
    }

    const links = new Set();
    let stableRounds = 0;
    let previousCount = 0;
    const totalRounds = 24;

    for (let round = 0; round < totalRounds; round += 1) {
      collectPlaceAnchors(document).forEach((href) => links.add(href));
      collectPlaceAnchors(feed).forEach((href) => links.add(href));

      chrome.runtime.sendMessage({
        type: "MAPS_PROGRESS",
        phase: "collect-links",
        linkCount: links.size,
        roundsCompleted: round + 1,
        totalRounds,
      });

      if (links.size >= limit) break;

      const previousTop = feed.scrollTop;
      const jump = Math.max(feed.clientHeight * 0.9, 1000);
      feed.scrollTop = previousTop + jump;
      feed.dispatchEvent(new WheelEvent("wheel", { deltaY: jump, bubbles: true }));
      await sleep(900);

      collectPlaceAnchors(document).forEach((href) => links.add(href));
      collectPlaceAnchors(feed).forEach((href) => links.add(href));

      if (links.size === previousCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        previousCount = links.size;
      }

      if (stableRounds >= 5 && round >= 5) break;
    }

    return [...links].slice(0, limit);
  }

  function scrapePlace() {
    const name =
      textOf(document.querySelector("h1")) ||
      textOf(document.querySelector('[data-item-id="title"]'));

    let category = "";
    const categoryButton = document.querySelector('button[jsaction*="category"]');
    if (categoryButton) {
      category = textOf(categoryButton);
    }

    let phone = "";
    const phoneButton = document.querySelector('button[data-item-id*="phone"], a[data-item-id*="phone"]');
    if (phoneButton) {
      const dataItem = phoneButton.getAttribute("data-item-id") || "";
      const phoneMatch = dataItem.match(/phone:tel:([^:]+)/);
      if (phoneMatch) {
        phone = decodeURIComponent(phoneMatch[1] || "").trim();
      }
      if (!phone) {
        phone = textOf(phoneButton).replace(/[^\d+()\-\s]/g, "").trim();
      }
    }

    let website = "";
    const websiteLink = document.querySelector('a[data-item-id="authority"], a[href^="http"][data-tooltip*="website" i]');
    if (websiteLink) {
      website = websiteLink.href || "";
    }

    let address = "";
    const addressButton = document.querySelector('button[data-item-id="address"]');
    if (addressButton) {
      address = textOf(addressButton);
    }

    let rating = "";
    const ratingEl = document.querySelector('span[role="img"][aria-label*="star" i], div[aria-label*="star" i]');
    if (ratingEl) {
      const label = ratingEl.getAttribute("aria-label") || "";
      const match = label.match(/(\d+[.,]\d+)/);
      if (match) rating = match[1].replace(",", ".");
    }

    let reviews = "";
    const bodyText = document.body.innerText || "";
    const reviewsMatch = bodyText.match(/([\d,]+)\s+reviews?/i);
    if (reviewsMatch) {
      reviews = reviewsMatch[1].replace(/,/g, "");
    }

    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const titleFallback = document.querySelector('meta[property="og:title"]')?.content || "";
    const nameFallback = titleFallback.split(" - ")[0].trim();

    return {
      name: name || nameFallback,
      category,
      phone,
      website,
      address,
      rating,
      reviews,
      mapsUrl: canonicalizeMapsUrl(canonical) || canonical,
    };
  }

  function getSearchQuery() {
    const input = document.querySelector("#searchboxinput");
    if (!input) return "";
    return String(input.value || "").trim();
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Send to Lead Atlas";
    button.style.position = "fixed";
    button.style.right = "20px";
    button.style.bottom = "20px";
    button.style.zIndex = "999999";
    button.style.padding = "12px 16px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.background = "#0f766e";
    button.style.color = "#fff";
    button.style.font = '600 14px "Segoe UI", sans-serif';
    button.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.18)";
    button.style.cursor = "pointer";

    button.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "PREFILL_FROM_MAPS",
        query: getSearchQuery(),
        location: "",
        mapsUrl: location.href,
        limit: 50,
      });
    });

    document.body.appendChild(button);
  }

  function notifyMapsPageReady() {
    const currentUrl = location.href;
    if (!currentUrl.startsWith("https://www.google.com/maps/")) {
      return;
    }
    if (currentUrl === lastReadyUrl) {
      return;
    }

    lastReadyUrl = currentUrl;
    chrome.runtime.sendMessage({
      type: "MAPS_PAGE_READY",
      url: currentUrl,
    });
  }

  const observer = new MutationObserver(() => {
    ensureButton();
    notifyMapsPageReady();
  });

  ensureButton();
  notifyMapsPageReady();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "COLLECT_PLACE_LINKS") {
      collectPlaceLinks(Number(message.limit || 50))
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to collect links" }));
      return true;
    }

    if (message?.type === "EXTRACT_PLACE") {
      chrome.runtime.sendMessage({
        type: "MAPS_PROGRESS",
        phase: "extract-place",
        name: textOf(document.querySelector("h1")) || "Extracting business details",
      });

      Promise.resolve(waitForPlaceReady())
        .then(() => scrapePlace())
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to extract place" }));
      return true;
    }

    return false;
  });
})();