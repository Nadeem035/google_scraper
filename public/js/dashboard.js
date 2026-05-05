/**
 * Lead Atlas — same-origin API, local search history, table filters.
 */
(function () {
  "use strict";

  const HISTORY_KEY = "leadAtlas.searchHistory";
  const SEEN_KEY = "leadAtlas.seenMapsUrlsByQuery";
  const MAX_HISTORY = 50;
  const MAX_SEEN_PER_QUERY = 800;

  const state = {
    leads: [],
    jobId: null,
    pollTimer: null,
    sortKey: "rating",
    sortDir: "desc",
    busy: false,
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    keyword: $("keyword"),
    location: $("location"),
    limit: $("limit"),
    appendExport: $("appendExport"),
    extractEmails: $("extractEmails"),
    btnStart: $("btnStart"),
    btnStartSpinner: $("btnStartSpinner"),
    btnExport: $("btnExport"),
    tableFilter: $("tableFilter"),
    filterPriority: $("filterPriority"),
    filterStatus: $("filterStatus"),
    filterContact: $("filterContact"),
    btnClearFilters: $("btnClearFilters"),
    tableBody: $("tableBody"),
    dataTable: $("dataTable"),
    emptyState: $("emptyState"),
    resultsMeta: $("resultsMeta"),
    progressFill: $("progressFill"),
    progressTrack: $("progressTrack"),
    progressDetail: $("progressDetail"),
    jobStatus: $("jobStatus"),
    jobError: $("jobError"),
    toast: $("toast"),
    historyList: $("historyList"),
    historyEmpty: $("historyEmpty"),
    sortBar: $("sortBar"),
    progressFound: $("progressFound"),
    progressTotal: $("progressTotal"),
    progressPct: $("progressPct"),
    fullscreenLoader: $("fullscreenLoader"),
    fullscreenLoaderText: $("fullscreenLoaderText"),
  };

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function leadPriority(l) {
    const p = (l.priority || "medium").toLowerCase();
    if (p === "high" || p === "low" || p === "medium") return p;
    return "medium";
  }

  function badgeClass(status) {
    switch (status) {
      case "High Value":
        return "badge badge--high";
      case "Call Lead":
        return "badge badge--call";
      case "Website Lead":
        return "badge badge--web";
      case "Low Quality":
        return "badge badge--low";
      default:
        return "badge";
    }
  }

  function prioBadgeHtml(l) {
    const p = leadPriority(l);
    const labels = { high: "High priority", medium: "Medium", low: "Low" };
    return `<span class="prio-badge prio-badge--${p}" title="Lead score">${labels[p]}</span>`;
  }

  function parseRating(r) {
    const n = parseFloat(String(r).replace(",", "."));
    return Number.isNaN(n) ? 0 : n;
  }

  function parseReviews(r) {
    const n = parseInt(String(r).replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  }

  function passesContactFilter(l, mode) {
    const phone = Boolean((l.phone || "").trim());
    const email = Boolean((l.email || "").trim());
    const web = Boolean((l.website || "").trim());
    switch (mode) {
      case "has_phone":
        return phone;
      case "has_email":
        return email;
      case "has_website":
        return web;
      case "no_website":
        return !web;
      case "phone_and_web":
        return phone && web;
      default:
        return true;
    }
  }

  function getFilteredSorted() {
    let rows = [...state.leads];

    const pri = (els.filterPriority && els.filterPriority.value) || "";
    if (pri) rows = rows.filter((l) => leadPriority(l) === pri);

    const st = (els.filterStatus && els.filterStatus.value) || "";
    if (st) rows = rows.filter((l) => (l.status || "") === st);

    const ct = (els.filterContact && els.filterContact.value) || "";
    if (ct) rows = rows.filter((l) => passesContactFilter(l, ct));

    const q = (els.tableFilter.value || "").trim().toLowerCase();
    if (q) {
      rows = rows.filter((l) => {
        const hay = [
          l.name,
          l.phone,
          l.website,
          l.address,
          l.status,
          l.email,
          l.priority,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const dir = state.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (state.sortKey === "rating")
        return (parseRating(a.rating) - parseRating(b.rating)) * dir;
      if (state.sortKey === "reviews")
        return (parseReviews(a.reviews) - parseReviews(b.reviews)) * dir;
      if (state.sortKey === "status")
        return String(a.status || "").localeCompare(String(b.status || "")) * dir;
      return String(a.name || "").localeCompare(String(b.name || "")) * dir;
    });
    return rows;
  }

  function renderTable() {
    const rows = getFilteredSorted();
    const hasAny = state.leads.length > 0;

    els.dataTable.hidden = !hasAny;
    els.emptyState.hidden = hasAny;
    if (!hasAny) {
      els.tableBody.innerHTML = "";
      els.resultsMeta.textContent =
        "No rows yet. Run a search to populate the table.";
      els.btnExport.disabled = true;
      return;
    }

    const activeFilters =
      (els.filterPriority.value ? 1 : 0) +
      (els.filterStatus.value ? 1 : 0) +
      (els.filterContact.value ? 1 : 0) +
      (els.tableFilter.value.trim() ? 1 : 0);
    els.resultsMeta.textContent = `${rows.length} of ${state.leads.length} contacts shown${
      activeFilters ? ` · ${activeFilters} filter${activeFilters > 1 ? "s" : ""} active` : ""
    }`;

    els.btnExport.disabled = false;

    if (rows.length === 0) {
      els.tableBody.innerHTML =
        '<tr><td colspan="8" class="empty-filter">No rows match your filters. Try clearing or broadening criteria.</td></tr>';
      return;
    }

    els.tableBody.innerHTML = rows
      .map((row) => {
        const meta = [];
        if (row.tags && row.tags.includes("opportunity"))
          meta.push(
            '<span class="meta-chip meta-chip--opp" title="No website listed">Opportunity</span>'
          );

        const phone = escapeHtml(row.phone || "");
        const email = row.email
          ? `<div class="contact-email"><span class="contact-email__text">${escapeHtml(row.email)}</span><button type="button" class="btn btn--mini copy-btn" data-copy="${escapeHtml(row.email)}">Copy</button></div>`
          : "";

        const web = row.website
          ? `<a class="link-web" href="${escapeHtml(row.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.website)}</a>`
          : '<span class="cell-muted">—</span>';

        const maps = row.mapsUrl
          ? `<a class="link-maps" href="${escapeHtml(row.mapsUrl)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>`
          : "—";

        return `<tr>
          <td class="name-cell col-name">
            <div class="name-cell__title">${escapeHtml(row.name || "—")}</div>
            <div class="name-cell__badges">${prioBadgeHtml(row)}${meta.join("")}</div>
          </td>
          <td class="col-contact">
            <div class="contact-line">${phone || '<span class="cell-muted">—</span>'} ${
            row.phone
              ? `<button type="button" class="btn btn--mini copy-btn" data-copy="${escapeHtml(row.phone)}">Copy</button>`
              : ""
          }</div>
            ${email}
          </td>
          <td class="col-web">${web}</td>
          <td class="col-address"><span class="address-text">${escapeHtml(row.address || "—")}</span></td>
          <td class="col-num"><span class="num-em">${escapeHtml(row.rating || "—")}</span></td>
          <td class="col-num">${escapeHtml(row.reviews || "—")}</td>
          <td class="col-status"><span class="${badgeClass(row.status)}">${escapeHtml(row.status || "")}</span></td>
          <td class="col-maps">${maps}</td>
        </tr>`;
      })
      .join("");

    els.tableBody.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-copy");
        if (t) void copyText(t);
      });
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Could not copy", true);
    }
  }

  function showToast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    els.toast.style.color = isError ? "var(--danger)" : "var(--success)";
    els.toast.style.background = isError ? "var(--danger-soft)" : "#ecfdf5";
    els.toast.style.borderColor = isError ? "#fecaca" : "#a7f3d0";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      els.toast.hidden = true;
    }, 2200);
  }

  function setProgress(pct, detail) {
    const v = Math.min(100, Math.max(0, pct));
    els.progressFill.style.width = `${v}%`;
    els.progressTrack.setAttribute("aria-valuenow", String(Math.round(v)));
    if (detail != null) els.progressDetail.textContent = detail;
    if (els.progressPct) els.progressPct.textContent = `${Math.round(v)}%`;
  }

  function setProgressMeta(found, total) {
    if (els.progressFound) els.progressFound.textContent = String(found ?? 0);
    if (els.progressTotal) els.progressTotal.textContent = String(total ?? 0);
  }

  function setFullScreenLoader(show, text) {
    if (!els.fullscreenLoader) return;
    els.fullscreenLoader.hidden = !show;
    if (els.fullscreenLoaderText) {
      if (text != null) {
        els.fullscreenLoaderText.textContent = String(text);
      } else if (show) {
        els.fullscreenLoaderText.textContent = "Working…";
      }
    }
    document.documentElement.style.overflow = show ? "hidden" : "";
    document.body.style.overflow = show ? "hidden" : "";
  }

  function setStatusPill(text, variant) {
    els.jobStatus.textContent = text;
    els.jobStatus.className = "status-pill";
    if (variant === "run") els.jobStatus.classList.add("status-pill--run");
    if (variant === "ok") els.jobStatus.classList.add("status-pill--ok");
    if (variant === "err") els.jobStatus.classList.add("status-pill--err");
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function makeQueryKey(query, location) {
    return `${String(query || "").trim().toLowerCase()}||${String(location || "")
      .trim()
      .toLowerCase()}`;
  }

  function readSeenMap() {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function writeSeenMap(obj) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(obj || {}));
    } catch {
      /* ignore */
    }
  }

  function getExcludeUrlsFor(query, location) {
    const key = makeQueryKey(query, location);
    const map = readSeenMap();
    const arr = map[key];
    return Array.isArray(arr) ? arr.slice(0, MAX_SEEN_PER_QUERY) : [];
  }

  function recordSeenUrls(query, location, leads) {
    const key = makeQueryKey(query, location);
    const map = readSeenMap();
    const prev = Array.isArray(map[key]) ? map[key] : [];
    const set = new Set(prev);
    (Array.isArray(leads) ? leads : []).forEach((l) => {
      const u = l && typeof l.mapsUrl === "string" ? l.mapsUrl.trim() : "";
      if (u) set.add(u);
    });
    map[key] = [...set].slice(0, MAX_SEEN_PER_QUERY);
    writeSeenMap(map);
  }

  function writeHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  }

  function pushHistoryEntry({ query, location, resultCount }) {
    const items = readHistory();
    const entry = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      query: query || "",
      location: location || "",
      resultCount: resultCount || 0,
      createdAt: new Date().toISOString(),
    };
    const next = [
      entry,
      ...items.filter(
        (h) =>
          h.query !== entry.query ||
          (h.location || "") !== (entry.location || "")
      ),
    ].slice(0, MAX_HISTORY);
    writeHistory(next);
    renderHistory();
  }

  function renderHistory() {
    const items = readHistory();
    els.historyEmpty.hidden = items.length > 0;
    els.historyList.innerHTML = items
      .map(
        (h) => `<li class="history-item">
          <div>
            <p class="history-item__title">${escapeHtml(h.query)}${
          h.location
            ? ` <span class="muted">${escapeHtml(h.location)}</span>`
            : ""
        }</p>
            <p class="history-item__meta">${new Date(h.createdAt).toLocaleString()} · ${h.resultCount} leads</p>
          </div>
          <div class="history-actions">
            <button type="button" class="icon-btn rerun-btn" data-query="${escapeHtml(h.query)}" data-location="${escapeHtml(
          h.location || ""
        )}" title="Re-run">↻</button>
            <button type="button" class="icon-btn icon-btn--danger del-btn" data-id="${escapeHtml(
          h.id
        )}" title="Remove">×</button>
          </div>
        </li>`
      )
      .join("");

    els.historyList.querySelectorAll(".rerun-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        els.keyword.value = btn.getAttribute("data-query") || "";
        els.location.value = btn.getAttribute("data-location") || "";
        document.getElementById("search-panel")?.scrollIntoView({ behavior: "smooth" });
      });
    });
    els.historyList.querySelectorAll(".del-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        const next = readHistory().filter((h) => h.id !== id);
        writeHistory(next);
        renderHistory();
      });
    });
  }

  async function pollJob() {
    if (!state.jobId) return;
    try {
      const res = await fetch(`/api/jobs/${state.jobId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Job not found");
      const j = await res.json();

      const returnedCount = j.returnedCount ?? j.found ?? (j.results ? j.results.length : 0);
      const totalRequested = j.total ?? j.requested ?? 0;

      setProgressMeta(returnedCount, totalRequested);
      setProgress(j.progress || 0, j.currentName ? `Current: ${j.currentName}` : "Working…");
      if (j.status === "queued" || j.status === "running") {
        const found = returnedCount;
        const total = totalRequested;
        setFullScreenLoader(true, `${found}/${total} collected${j.currentName ? ` · ${String(j.currentName)}` : ""}`);
      }

      if (j.status === "queued" || j.status === "running") {
        setStatusPill(j.status, "run");
      } else if (j.status === "completed") {
        const target = totalRequested || returnedCount;
        const isExact =
          typeof j.fulfilledExact === "boolean"
            ? j.fulfilledExact
            : returnedCount >= target;
        const mapsExhausted = Boolean(j.mapsExhausted);

        if (isExact) {
          setStatusPill("completed", "ok");
        } else if (mapsExhausted) {
          setStatusPill("search complete", "ok");
        } else {
          setStatusPill("search complete", "ok");
        }

        let detailMsg = isExact
          ? `Found all ${returnedCount} leads.`
          : `Found ${returnedCount} leads. Google Maps has no more results for this search.`;
        setProgress(100, detailMsg);
        state.leads = j.results || [];
        renderTable();
        recordSeenUrls(els.keyword.value.trim(), els.location.value.trim(), state.leads);
        stopPoll();
        state.busy = false;
        els.btnStart.disabled = false;
        els.btnStartSpinner.hidden = true;
        setFullScreenLoader(false);
        pushHistoryEntry({
          query: els.keyword.value.trim(),
          location: els.location.value.trim(),
          resultCount: state.leads.length,
        });
      } else if (j.status === "failed") {
        setStatusPill("failed", "err");
        setProgress(0, "");
        els.jobError.hidden = false;
        els.jobError.textContent = j.error || "Scrape failed";
        stopPoll();
        state.busy = false;
        els.btnStart.disabled = false;
        els.btnStartSpinner.hidden = true;
        setFullScreenLoader(false);
      }
    } catch {
      setStatusPill("error", "err");
      stopPoll();
      state.busy = false;
      els.btnStart.disabled = false;
      els.btnStartSpinner.hidden = true;
      setFullScreenLoader(false);
    }
  }

  function startPoll() {
    stopPoll();
    void pollJob();
    state.pollTimer = setInterval(pollJob, 1200);
  }

  async function onStart() {
    const query = (els.keyword.value || "").trim();
    if (!query || state.busy) return;
    const location = (els.location.value || "").trim();
    const excludeUrls = getExcludeUrlsFor(query, location);

    state.busy = true;
    els.btnStart.disabled = true;
    els.btnStartSpinner.hidden = false;
    els.jobError.hidden = true;
    els.jobError.textContent = "";
    state.leads = [];
    renderTable();
    setStatusPill("starting", "run");
    setProgress(0, "Submitting job…");
    setProgressMeta(0, Number(els.limit.value) || 50);
    setFullScreenLoader(true, "Submitting job…");

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          location,
          limit: Number(els.limit.value) || 50,
          extractEmails: els.extractEmails.checked,
          excludeUrls,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);

      state.jobId = data.jobId;
      setStatusPill("queued", "run");
      setProgress(0, "Queued…");
      startPoll();
    } catch (e) {
      setStatusPill("failed", "err");
      els.jobError.hidden = false;
      els.jobError.textContent = e.message || "Failed to start";
      state.busy = false;
      els.btnStart.disabled = false;
      els.btnStartSpinner.hidden = true;
      setFullScreenLoader(false);
    }
  }

  async function onExport() {
    if (!state.leads.length) return;
    const appendFile =
      els.appendExport.checked && window.__APP__?.lastExportFile
        ? window.__APP__.lastExportFile
        : undefined;

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: state.jobId || undefined,
          leads: state.leads,
          searchQuery: [els.keyword.value, els.location.value].filter(Boolean).join(" ").trim(),
          appendFile,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Export failed");

      window.__APP__ = window.__APP__ || {};
      window.__APP__.lastExportFile = data.file;
      const dlName = data.downloadName || "export.xlsx";
      const dlUrl = `/api/download?file=${encodeURIComponent(data.file)}&name=${encodeURIComponent(dlName)}`;
      const link = document.createElement("a");
      link.href = dlUrl;
      link.download = dlName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Download started");
    } catch (e) {
      showToast(e.message || "Export failed", true);
    }
  }

  function updateSortChips() {
    els.sortBar.querySelectorAll(".chip").forEach((chip) => {
      const k = chip.getAttribute("data-sort");
      chip.classList.toggle("chip--active", k === state.sortKey);
      chip.textContent =
        k === state.sortKey
          ? `${k.charAt(0).toUpperCase() + k.slice(1)} ${state.sortDir === "asc" ? "↑" : "↓"}`
          : k.charAt(0).toUpperCase() + k.slice(1);
    });
  }

  function clearFilters() {
    els.filterPriority.value = "";
    els.filterStatus.value = "";
    els.filterContact.value = "";
    els.tableFilter.value = "";
    renderTable();
  }

  els.btnStart.addEventListener("click", onStart);
  els.btnExport.addEventListener("click", onExport);
  els.tableFilter.addEventListener("input", renderTable);
  els.filterPriority.addEventListener("change", renderTable);
  els.filterStatus.addEventListener("change", renderTable);
  els.filterContact.addEventListener("change", renderTable);
  els.btnClearFilters.addEventListener("click", clearFilters);

  els.sortBar.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const k = chip.getAttribute("data-sort");
      if (!k) return;
      if (state.sortKey === k) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = k;
        state.sortDir = k === "name" ? "asc" : "desc";
      }
      updateSortChips();
      renderTable();
    });
  });

  updateSortChips();
  renderTable();
  renderHistory();
})();
