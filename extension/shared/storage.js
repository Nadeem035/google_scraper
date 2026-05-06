export const DEFAULT_SETTINGS = {
  defaultLimit: 25,
  defaultExtractEmails: true,
  candidateMultiplier: 6,
  closeScrapeTabOnFinish: true,
};

export const DEFAULT_STATE = {
  settings: DEFAULT_SETTINGS,
  draft: {
    query: "",
    location: "",
    limit: DEFAULT_SETTINGS.defaultLimit,
    extractEmails: DEFAULT_SETTINGS.defaultExtractEmails,
  },
  activeJob: null,
  scraperSession: null,
  lastCompletedJob: null,
  lastError: "",
  lastMapsCapture: null,
};

const STORAGE_KEY = "leadAtlas.extension.state";

function mergeState(stored) {
  const state = stored || {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(state.settings || {}),
  };

  return {
    ...DEFAULT_STATE,
    ...state,
    settings,
    draft: {
      ...DEFAULT_STATE.draft,
      ...(state.draft || {}),
      limit: Number(state?.draft?.limit || settings.defaultLimit || DEFAULT_SETTINGS.defaultLimit),
      extractEmails:
        typeof state?.draft?.extractEmails === "boolean"
          ? state.draft.extractEmails
          : settings.defaultExtractEmails,
    },
  };
}

export async function getStoredState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return mergeState(stored[STORAGE_KEY]);
}

export async function setStoredState(nextState) {
  const merged = mergeState(nextState);
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  return merged;
}

export async function patchStoredState(patch) {
  const current = await getStoredState();
  const nextState = mergeState({
    ...current,
    ...patch,
    settings: {
      ...current.settings,
      ...(patch.settings || {}),
    },
    draft: {
      ...current.draft,
      ...(patch.draft || {}),
    },
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: nextState });
  return nextState;
}

export async function getSettings() {
  const state = await getStoredState();
  return state.settings;
}

export async function updateSettings(settingsPatch) {
  const state = await getStoredState();
  const nextSettings = {
    ...state.settings,
    ...settingsPatch,
    defaultLimit: Math.max(1, Math.min(500, Number(settingsPatch.defaultLimit || state.settings.defaultLimit || DEFAULT_SETTINGS.defaultLimit))),
    candidateMultiplier: Math.max(2, Math.min(12, Number(settingsPatch.candidateMultiplier || state.settings.candidateMultiplier || DEFAULT_SETTINGS.candidateMultiplier))),
  };
  return patchStoredState({ settings: nextSettings });
}