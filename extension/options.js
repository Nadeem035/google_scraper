import { deriveProgress, escapeHtml } from "./shared/format.js";

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Request failed"));
        return;
      }
      resolve(response.result);
    });
  });
}

const els = {
  defaultLimit: document.getElementById("defaultLimit"),
  candidateMultiplier: document.getElementById("candidateMultiplier"),
  defaultExtractEmails: document.getElementById("defaultExtractEmails"),
  closeScrapeTabOnFinish: document.getElementById("closeScrapeTabOnFinish"),
  settingsForm: document.getElementById("settingsForm"),
  saveStatus: document.getElementById("saveStatus"),
  testConnection: document.getElementById("testConnection"),
  refreshStatus: document.getElementById("refreshStatus"),
  exportButton: document.getElementById("exportButton"),
  jobStatus: document.getElementById("jobStatus"),
  progressFill: document.getElementById("progressFill"),
  progressFound: document.getElementById("progressFound"),
  progressTotal: document.getElementById("progressTotal"),
  progressPct: document.getElementById("progressPct"),
  progressDetail: document.getElementById("progressDetail"),
  errorText: document.getElementById("errorText"),
  apiMetaText: document.getElementById("apiMetaText"),
  resultFilter: document.getElementById("resultFilter"),
  resultTable: document.getElementById("resultTable"),
  emptyState: document.getElementById("emptyState"),
};

let currentState = null;

function fillSettings(state) {
  els.defaultLimit.value = String(state.settings.defaultLimit || 50);
  els.candidateMultiplier.value = String(state.settings.candidateMultiplier || 6);
  els.defaultExtractEmails.checked = Boolean(state.settings.defaultExtractEmails);
  els.closeScrapeTabOnFinish.checked = Boolean(state.settings.closeScrapeTabOnFinish);
}

function filteredRows(state) {
  const rows = Array.isArray(state.lastCompletedJob?.results) ? state.lastCompletedJob.results : [];
  const query = els.resultFilter.value.trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => {
    const hay = [row.name, row.phone, row.website, row.address, row.status]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  });
}

function renderResults(state) {
  const rows = filteredRows(state);
  els.emptyState.hidden = rows.length > 0;
  els.resultTable.innerHTML = rows
    .map((row) => {
      return `<tr>
        <td>${escapeHtml(row.name || "")}</td>
        <td>${escapeHtml(row.phone || "")}</td>
        <td>${
          row.website
            ? `<a href="${escapeHtml(row.website)}" target="_blank" rel="noreferrer">${escapeHtml(row.website)}</a>`
            : ""
        }</td>
        <td>${escapeHtml(row.address || "")}</td>
        <td>${escapeHtml(row.status || "")}</td>
      </tr>`;
    })
    .join("");
}

function render(state) {
  currentState = state;
  fillSettings(state);
  const job = state.activeJob || state.lastCompletedJob;
  const progress = deriveProgress(job);

  els.jobStatus.textContent = job?.status || "idle";
  els.progressFill.style.width = `${progress.pct}%`;
  els.progressFound.textContent = String(progress.found);
  els.progressTotal.textContent = String(progress.total);
  els.progressPct.textContent = `${progress.pct}%`;
  els.progressDetail.textContent = progress.detail;
  els.errorText.hidden = !state.lastError;
  els.errorText.textContent = state.lastError || "";

  renderResults(state);
}

async function loadState() {
  const state = await sendMessage({ type: "GET_STATE" });
  render(state);
}

els.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  els.saveStatus.textContent = "Saving...";
  void sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      defaultLimit: Number(els.defaultLimit.value || 50),
      candidateMultiplier: Number(els.candidateMultiplier.value || 6),
      defaultExtractEmails: els.defaultExtractEmails.checked,
      closeScrapeTabOnFinish: els.closeScrapeTabOnFinish.checked,
    },
  })
    .then((state) => {
      render(state);
      els.saveStatus.textContent = "Saved";
      setTimeout(() => {
        els.saveStatus.textContent = "";
      }, 1500);
    })
    .catch((error) => {
      els.saveStatus.textContent = error.message;
    });
});

els.testConnection.addEventListener("click", () => {
  chrome.tabs.query({ url: "https://www.google.com/maps/*" }, (tabs) => {
    if (chrome.runtime.lastError) {
      els.errorText.hidden = false;
      els.errorText.textContent = chrome.runtime.lastError.message;
      return;
    }

    if (tabs.length > 0) {
      els.apiMetaText.textContent = `${tabs.length} Google Maps tab(s) available for scraping.`;
      els.errorText.hidden = true;
      return;
    }

    els.apiMetaText.textContent = "No Google Maps tab detected. The extension can still open one when you start a scrape.";
  });
});

els.refreshStatus.addEventListener("click", () => {
  void sendMessage({ type: "REFRESH_JOB" }).then(render).catch((error) => {
    els.errorText.hidden = false;
    els.errorText.textContent = error.message;
  });
});

els.exportButton.addEventListener("click", () => {
  void sendMessage({ type: "EXPORT_RESULTS" }).catch((error) => {
    els.errorText.hidden = false;
    els.errorText.textContent = error.message;
  });
});

els.resultFilter.addEventListener("input", () => {
  if (currentState) {
    renderResults(currentState);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "STATE_UPDATED" && message.state) {
    render(message.state);
  }
});

void loadState();