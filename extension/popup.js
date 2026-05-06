import { deriveProgress, formatTimestamp } from "./shared/format.js";

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
  query: document.getElementById("query"),
  location: document.getElementById("location"),
  limit: document.getElementById("limit"),
  extractEmails: document.getElementById("extractEmails"),
  startForm: document.getElementById("startForm"),
  startButton: document.getElementById("startButton"),
  openOptions: document.getElementById("openOptions"),
  openSidePanel: document.getElementById("openSidePanel"),
  refreshStatus: document.getElementById("refreshStatus"),
  jobStatus: document.getElementById("jobStatus"),
  progressFill: document.getElementById("progressFill"),
  progressFound: document.getElementById("progressFound"),
  progressTotal: document.getElementById("progressTotal"),
  progressPct: document.getElementById("progressPct"),
  progressDetail: document.getElementById("progressDetail"),
  errorText: document.getElementById("errorText"),
  mapsCapture: document.getElementById("mapsCapture"),
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

  els.query.value = state.draft?.query || "";
  els.location.value = state.draft?.location || "";
  els.limit.value = String(state.draft?.limit || state.settings.defaultLimit || 50);
  els.extractEmails.checked = Boolean(state.draft?.extractEmails);

  if (state.lastMapsCapture?.query) {
    const capturedAt = formatTimestamp(state.lastMapsCapture.capturedAt);
    els.mapsCapture.textContent = `${state.lastMapsCapture.query}${
      state.lastMapsCapture.location ? ` · ${state.lastMapsCapture.location}` : ""
    }${capturedAt ? ` · ${capturedAt}` : ""}`;
  }
}

async function loadState() {
  const state = await sendMessage({ type: "GET_STATE" });
  render(state);
}

async function onSubmit(event) {
  event.preventDefault();
  els.startButton.disabled = true;

  try {
    const nextState = await sendMessage({
      type: "START_SCRAPE",
      query: els.query.value,
      location: els.location.value,
      limit: Number(els.limit.value || 50),
      extractEmails: els.extractEmails.checked,
    });
    render(nextState);
  } catch (error) {
    els.errorText.hidden = false;
    els.errorText.textContent = error.message;
  } finally {
    els.startButton.disabled = false;
  }
}

async function openSidePanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId != null && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
}

els.startForm.addEventListener("submit", onSubmit);
els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.refreshStatus.addEventListener("click", () => {
  void sendMessage({ type: "REFRESH_JOB" }).then(render).catch((error) => {
    els.errorText.hidden = false;
    els.errorText.textContent = error.message;
  });
});
els.openSidePanel.addEventListener("click", () => {
  void openSidePanel();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "STATE_UPDATED" && message.state) {
    render(message.state);
  }
});

void loadState();