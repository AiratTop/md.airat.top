const textarea = document.getElementById("markdownInput");
const preview = document.getElementById("preview");
const resetBtn = document.getElementById("resetBtn");
const copyBtn = document.getElementById("copyBtn");
const shareBtn = document.getElementById("shareBtn");
const syncToggle = document.getElementById("syncScroll");
const darkToggle = document.getElementById("darkMode");
const splitPane = document.getElementById("splitPane");
const dragHandle = document.getElementById("dragHandle");
const shareDialog = document.getElementById("shareDialog");

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

const updatePreview = () => {
  const markdown = textarea.value;
  preview.innerHTML = renderMarkdown(markdown);
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

const storedContent = getStored(STORAGE_KEYS.content, "");
const storedSplit = getStored(STORAGE_KEYS.split, "");
const storedSync = getStored(STORAGE_KEYS.sync, "true");

initTheme(darkToggle);
syncToggle.checked = storedSync !== "false";
if (storedSplit) {
  splitPane.style.setProperty("--split-left", storedSplit);
}
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
  if (await copyText(textarea.value)) {
    showStatus("Markdown copied to clipboard");
  } else {
    textarea.select();
    document.execCommand("copy");
    showStatus("Markdown copied");
  }
});

syncToggle.addEventListener("change", () => {
  setStored(STORAGE_KEYS.sync, syncToggle.checked ? "true" : "false");
  if (syncToggle.checked) {
    syncScroll(textarea, preview);
  }
});

let isDragging = false;
const MIN_PANE_WIDTH = 240;

const updateSplit = (clientX) => {
  const rect = splitPane.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const maxLeft = rect.width - MIN_PANE_WIDTH;
  const clamped = Math.max(MIN_PANE_WIDTH, Math.min(offsetX, maxLeft));
  const percent = (clamped / rect.width) * 100;
  const value = `${percent}%`;
  splitPane.style.setProperty("--split-left", value);
  setStored(STORAGE_KEYS.split, value);
};

const stopDrag = (event) => {
  if (!isDragging) {
    return;
  }
  isDragging = false;
  dragHandle.classList.remove("is-active");
  dragHandle.releasePointerCapture(event.pointerId);
};

dragHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  isDragging = true;
  dragHandle.classList.add("is-active");
  dragHandle.setPointerCapture(event.pointerId);
  updateSplit(event.clientX);
});

dragHandle.addEventListener("pointermove", (event) => {
  if (!isDragging) {
    return;
  }
  updateSplit(event.clientX);
});

dragHandle.addEventListener("pointerup", stopDrag);
dragHandle.addEventListener("pointercancel", stopDrag);

// Sharing. The editor never uploads anything on its own; this is the one path that
// does, and only after the author confirms in the dialog what a share link means.
const MAX_SHARE_BYTES = 256 * 1024; // MAX_CONTENT_BYTES in src/limits.js
const shareConfirm = document.getElementById("shareConfirm");
const shareResult = document.getElementById("shareResult");
const shareError = document.getElementById("shareError");
const shareCreate = document.getElementById("shareCreate");
const shareUrl = document.getElementById("shareUrl");
const shareCopy = document.getElementById("shareCopy");
const shareExpiry = document.getElementById("shareExpiry");
const shareOpen = document.getElementById("shareOpen");
const shareRaw = document.getElementById("shareRaw");
const shareJson = document.getElementById("shareJson");
const shareDelete = document.getElementById("shareDelete");
let currentShare = null;

const showShareError = (message) => {
  shareError.textContent = message;
  shareError.hidden = !message;
};

// The status toast sits under the modal's backdrop, so feedback inside the dialog goes
// on the button that was pressed.
const flashLabel = (button, label) => {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = label;
  clearTimeout(button.flashTimer);
  button.flashTimer = setTimeout(() => {
    button.textContent = original;
  }, 1600);
};

shareBtn.addEventListener("click", () => {
  if (!textarea.value.trim()) {
    showStatus("Nothing to share yet");
    return;
  }
  showShareError("");
  shareConfirm.hidden = false;
  shareResult.hidden = true;
  shareDialog.showModal();
  shareCreate.focus();
});

shareCreate.addEventListener("click", async () => {
  const content = textarea.value;
  if (new TextEncoder().encode(content).length > MAX_SHARE_BYTES) {
    showShareError(`This text is too long to share: the limit is ${MAX_SHARE_BYTES / 1024} KB.`);
    return;
  }

  showShareError("");
  shareCreate.disabled = true;
  shareCreate.textContent = "Creating…";
  try {
    const response = await fetch("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showShareError(data.error || "Could not create the link. Try again.");
      return;
    }

    saveShareToken(data.id, data.deleteToken, data.expiresAt);
    currentShare = data;
    shareUrl.value = data.url;
    shareOpen.href = data.url;
    shareRaw.href = data.markdownUrl;
    shareJson.href = data.jsonUrl;
    shareExpiry.textContent = `${formatDateTime(data.expiresAt)} (${formatRemaining(data.expiresAt)})`;
    shareDelete.disabled = false;
    shareConfirm.hidden = true;
    shareResult.hidden = false;
    shareUrl.focus();
    shareUrl.select();
  } catch (error) {
    showShareError("Network error. Check your connection and try again.");
  } finally {
    shareCreate.disabled = false;
    shareCreate.textContent = "Create link";
  }
});

shareCopy.addEventListener("click", async () => {
  if (!(await copyText(shareUrl.value))) {
    shareUrl.select();
    document.execCommand("copy");
  }
  flashLabel(shareCopy, "Copied");
});

shareDelete.addEventListener("click", async () => {
  if (!currentShare || !confirm("Delete this link now? It will stop working for everyone.")) {
    return;
  }
  shareDelete.disabled = true;
  try {
    if (await deleteShare(currentShare.id)) {
      currentShare = null;
      shareDialog.close();
      showStatus("Link deleted");
      return;
    }
  } catch (error) {
    // Reported below.
  }
  shareDelete.disabled = false;
  flashLabel(shareDelete, "Could not delete");
});

shareDialog.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => shareDialog.close());
});

shareDialog.addEventListener("click", (event) => {
  if (event.target === shareDialog) {
    shareDialog.close();
  }
});
