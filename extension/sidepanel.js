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
  refreshButton: document.getElementById("refreshButton"),
  openOptions: document.getElementById("openOptions"),
  exportButton: document.getElementById("exportButton"),
  jobStatus: document.getElementById("jobStatus"),
  progressFill: document.getElementById("progressFill"),
  progressFound: document.getElementById("progressFound"),
  progressTotal: document.getElementById("progressTotal"),
  progressPct: document.getElementById("progressPct"),
  progressDetail: document.getElementById("progressDetail"),
  errorText: document.getElementById("errorText"),
  resultList: document.getElementById("resultList"),
  emptyState: document.getElementById("emptyState"),
};

function render(state) {
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

  const rows = Array.isArray(state.lastCompletedJob?.results)
    ? state.lastCompletedJob.results.slice(0, 8)
    : [];
  els.emptyState.hidden = rows.length > 0;
  els.resultList.innerHTML = rows
    .map((row) => {
      return `<li>
        <div class="lead-name">${escapeHtml(row.name || "Unnamed business")}</div>
        <div class="lead-meta">${escapeHtml(row.phone || row.website || row.address || "No contact details")}</div>
      </li>`;
    })
    .join("");
}

els.refreshButton.addEventListener("click", () => {
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

els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "STATE_UPDATED" && message.state) {
    render(message.state);
  }
});

void sendMessage({ type: "GET_STATE" }).then(render).catch((error) => {
  els.errorText.hidden = false;
  els.errorText.textContent = error.message;
});