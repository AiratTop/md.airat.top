const textarea = document.getElementById("markdownInput");
const preview = document.getElementById("preview");
const resetBtn = document.getElementById("resetBtn");
const copyBtn = document.getElementById("copyBtn");
const syncToggle = document.getElementById("syncScroll");
const darkToggle = document.getElementById("darkMode");
const statusEl = document.getElementById("status");

const STORAGE_KEYS = {
  content: "md-preview-content",
  theme: "md-preview-theme",
  themeMode: "md-preview-theme-mode",
  sync: "md-preview-sync",
};

const SAMPLE = `# Markdown Live Preview

Write on the left. See the preview on the right.

## Quick cheatsheet
- **Bold** and *italic*
- Lists, links, and code
- Tables and blockquotes

### Code block
~~~js
const greet = (name) => "Hello, " + name + "!";
console.log(greet("md.airat.top"));
~~~

> Tip: Toggle Sync Scroll to keep both panes aligned.

| Feature | Status |
| --- | --- |
| Live preview | Ready |
| Dark mode | On |
| Sync scroll | Optional |

[Project repo](https://github.com/AiratTop/md.airat.top)
`;

const getStored = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
};

const setStored = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Ignore storage errors (private mode, etc.)
  }
};

const showStatus = (message) => {
  statusEl.textContent = message;
  statusEl.classList.add("is-visible");
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    statusEl.classList.remove("is-visible");
  }, 1600);
};

const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const normalizeTheme = (value) =>
  value === "dark" || value === "light" || value === "system" ? value : "system";
const resolveTheme = (value) =>
  value === "system" ? (mediaQuery.matches ? "dark" : "light") : value;

let themeMode = "system";
let themePreference = "system";

const applyTheme = (value, { persist = true } = {}) => {
  const resolved = resolveTheme(value);
  document.documentElement.dataset.theme = resolved;
  darkToggle.checked = resolved === "dark";
  if (persist) {
    setStored(STORAGE_KEYS.theme, value);
  }
};

const updatePreview = () => {
  const markdown = textarea.value;
  preview.innerHTML = marked.parse(markdown);
  setStored(STORAGE_KEYS.content, markdown);
};

let isSyncing = false;
const syncScroll = (source, target) => {
  if (isSyncing) {
    return;
  }
  isSyncing = true;
  const sourceMax = source.scrollHeight - source.clientHeight;
  const targetMax = target.scrollHeight - target.clientHeight;
  const ratio = sourceMax > 0 ? source.scrollTop / sourceMax : 0;
  target.scrollTop = ratio * targetMax;
  requestAnimationFrame(() => {
    isSyncing = false;
  });
};

const setContent = (value) => {
  textarea.value = value;
  updatePreview();
  if (syncToggle.checked) {
    syncScroll(textarea, preview);
  }
};

marked.setOptions({
  gfm: true,
  breaks: true,
  mangle: false,
  headerIds: false,
});

const storedContent = getStored(STORAGE_KEYS.content, "");
const storedTheme = getStored(STORAGE_KEYS.theme, "system");
const storedThemeMode = getStored(STORAGE_KEYS.themeMode, "system");
const storedSync = getStored(STORAGE_KEYS.sync, "true");

themeMode = storedThemeMode === "manual" ? "manual" : "system";
themePreference = normalizeTheme(storedTheme);
if (themeMode !== "manual") {
  themePreference = "system";
  setStored(STORAGE_KEYS.theme, "system");
}

applyTheme(themePreference, { persist: false });
syncToggle.checked = storedSync !== "false";
setContent(storedContent.trim() ? storedContent : SAMPLE);

textarea.addEventListener("input", () => {
  updatePreview();
  if (syncToggle.checked) {
    syncScroll(textarea, preview);
  }
});

textarea.addEventListener("scroll", () => {
  if (syncToggle.checked) {
    syncScroll(textarea, preview);
  }
});

preview.addEventListener("scroll", () => {
  if (syncToggle.checked) {
    syncScroll(preview, textarea);
  }
});

resetBtn.addEventListener("click", () => {
  setContent(SAMPLE);
  showStatus("Reset to sample markdown");
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(textarea.value);
    showStatus("Markdown copied to clipboard");
  } catch (error) {
    textarea.select();
    document.execCommand("copy");
    showStatus("Markdown copied");
  }
});

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

syncToggle.addEventListener("change", () => {
  setStored(STORAGE_KEYS.sync, syncToggle.checked ? "true" : "false");
  if (syncToggle.checked) {
    syncScroll(textarea, preview);
  }
});
