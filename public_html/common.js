// Helpers shared by the editor (app.js) and the shared-document page (view.js).

const STORAGE_KEYS = {
  content: "md-preview-content",
  theme: "md-preview-theme",
  themeMode: "md-preview-theme-mode",
  split: "md-preview-split",
  sync: "md-preview-sync",
  shares: "md-preview-shares",
};

const getStored = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
};

// Returns whether the value was stored. Storage fails in some private modes and when
// the quota is full; callers that lose something the user cares about must say so.
const setStored = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    return false;
  }
};

// Looked up once, now: this script runs before any markdown is rendered, so a document
// with its own id="status" cannot stand in for it.
const statusEl = document.getElementById("status");

const showStatus = (message, duration = 1600) => {
  statusEl.textContent = message;
  statusEl.classList.add("is-visible");
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    statusEl.classList.remove("is-visible");
  }, duration);
};

const copyText = async (value) => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    return false;
  }
};

// Theme: follows the system until the toggle is used, then remembers the choice.
const initTheme = (darkToggle) => {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const normalizeTheme = (value) =>
    value === "dark" || value === "light" || value === "system" ? value : "system";
  const resolveTheme = (value) =>
    value === "system" ? (mediaQuery.matches ? "dark" : "light") : value;

  const applyTheme = (value, { persist = true } = {}) => {
    const resolved = resolveTheme(value);
    document.documentElement.dataset.theme = resolved;
    darkToggle.checked = resolved === "dark";
    if (persist) {
      setStored(STORAGE_KEYS.theme, value);
    }
  };

  let themeMode = getStored(STORAGE_KEYS.themeMode, "system") === "manual" ? "manual" : "system";
  let themePreference = normalizeTheme(getStored(STORAGE_KEYS.theme, "system"));
  if (themeMode !== "manual") {
    themePreference = "system";
    setStored(STORAGE_KEYS.theme, "system");
  }
  applyTheme(themePreference, { persist: false });

  darkToggle.addEventListener("change", () => {
    themeMode = "manual";
    setStored(STORAGE_KEYS.themeMode, themeMode);
    themePreference = darkToggle.checked ? "dark" : "light";
    applyTheme(themePreference);
  });

  mediaQuery.addEventListener("change", () => {
    if (themeMode === "system") {
      applyTheme("system", { persist: false });
    }
  });
};

// The shares this browser created: the delete token, so "Delete now" works from the
// share dialog and from the shared page itself, and a hash of the text, so sharing the
// same text again offers the link that already exists. Expired entries are dropped on
// read.
const readShareTokens = () => {
  let tokens = {};
  try {
    tokens = JSON.parse(getStored(STORAGE_KEYS.shares, "{}")) || {};
  } catch (error) {
    tokens = {};
  }
  const now = Date.now();
  for (const [id, entry] of Object.entries(tokens)) {
    if (!entry || Date.parse(entry.expiresAt) <= now) {
      delete tokens[id];
    }
  }
  return tokens;
};

// Returns whether it was stored; the dialog still holds the token in memory if not.
const saveShareToken = (share, contentHash) => {
  const tokens = readShareTokens();
  tokens[share.id] = {
    deleteToken: share.deleteToken,
    expiresAt: share.expiresAt,
    hash: contentHash,
    url: share.url,
    markdownUrl: share.markdownUrl,
    jsonUrl: share.jsonUrl,
    htmlUrl: share.htmlUrl,
  };
  return setStored(STORAGE_KEYS.shares, JSON.stringify(tokens));
};

// The live share of exactly this text, if this browser made one.
const findShareByHash = (contentHash) => {
  for (const [id, entry] of Object.entries(readShareTokens())) {
    if (entry.hash === contentHash && entry.url) {
      return { id, ...entry };
    }
  }
  return null;
};

// SHA-256 of the text, hex. Only ever stored in this browser.
const hashText = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const forgetShareToken = (id) => {
  const tokens = readShareTokens();
  delete tokens[id];
  setStored(STORAGE_KEYS.shares, JSON.stringify(tokens));
};

// The token can come from the caller (the dialog keeps it in memory, which works even
// when storage does not) or from storage.
const deleteShare = async (id, deleteToken = readShareTokens()[id]?.deleteToken) => {
  if (!deleteToken) {
    return false;
  }
  const response = await fetch(`/api/shares/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deleteToken }),
  });
  // 404 means it is already gone, which is what was asked for.
  if (response.ok || response.status === 404) {
    forgetShareToken(id);
    return true;
  }
  return false;
};

// "in 23 h 41 min", "in 5 min", "in less than a minute".
const formatRemaining = (expiresAt) => {
  const minutes = Math.floor((Date.parse(expiresAt) - Date.now()) / 60000);
  if (minutes < 1) {
    return "in less than a minute";
  }
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `in ${hours} h ${minutes % 60} min` : `in ${minutes} min`;
};

const formatDateTime = (value) =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
