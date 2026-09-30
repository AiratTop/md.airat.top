// Every control is looked up here, before any markdown is rendered, and the dialog's
// controls inside the dialog itself: an element in the document that shares an id with
// one of them must never be the one that gets the handler.
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
const exportBtn = document.getElementById("exportBtn");
const exportMenu = document.getElementById("exportMenu");
const inDialog = (id) => shareDialog.querySelector(`#${id}`);
const shareConfirm = inDialog("shareConfirm");
const shareResult = inDialog("shareResult");
const shareError = inDialog("shareError");
const shareCreate = inDialog("shareCreate");
const shareUrl = inDialog("shareUrl");
const shareCopy = inDialog("shareCopy");
const shareExpiry = inDialog("shareExpiry");
const shareOpen = inDialog("shareOpen");
const shareRaw = inDialog("shareRaw");
const shareJson = inDialog("shareJson");
const shareHtml = inDialog("shareHtml");
const shareDelete = inDialog("shareDelete");
const shareNew = inDialog("shareNew");
const shareReused = inDialog("shareReused");
const shareTokenNote = inDialog("shareTokenNote");
const shareResultHeading = inDialog("shareResultHeading");

// The tour shown on a first visit and by Reset lives in sample.md, where it is plain
// markdown to edit rather than a string full of escaped backticks.
let sampleText = null;
const loadSample = async () => {
  if (sampleText === null) {
    const response = await fetch("/sample.md");
    if (!response.ok) {
      throw new Error(`sample.md: ${response.status}`);
    }
    sampleText = await response.text();
  }
  return sampleText;
};

let storageWarned = false;
let diagramTimer = null;
let edited = false; // typed into since the page loaded

const updatePreview = () => {
  const markdown = textarea.value;
  // Saved first: a document the renderer chokes on must not cost the author their draft.
  if (!setStored(STORAGE_KEYS.content, markdown) && !storageWarned) {
    storageWarned = true;
    showStatus("Browser storage is full or blocked: this draft will not survive a reload", 6000);
  }
  preview.innerHTML = renderMarkdown(markdown);
  renderMath(preview);
  // Diagrams are drawn once typing pauses: mid-edit, a diagram rarely parses.
  clearTimeout(diagramTimer);
  diagramTimer = setTimeout(() => renderDiagrams(preview), 300);
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

// null means nothing was ever saved; an empty string is a draft the user emptied.
const storedContent = getStored(STORAGE_KEYS.content, null);
const storedSplit = getStored(STORAGE_KEYS.split, "");
const storedSync = getStored(STORAGE_KEYS.sync, "true");

initTheme(darkToggle);
// Diagrams are drawn in the theme's colours, so a theme change redraws them.
new MutationObserver(() => updatePreview()).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
syncToggle.checked = storedSync !== "false";

if (storedContent === null) {
  // The tour arrives over the network, and the editor is usable before it does: it goes
  // in only if nobody has typed in the meantime, or it would replace what they wrote.
  const starter = (text) => {
    if (!edited) setContent(text);
  };
  loadSample()
    .then(starter)
    .catch(() => starter("# Markdown Live Preview\n\nWrite on the left, see it on the right."));
} else {
  setContent(storedContent);
}

textarea.addEventListener("input", () => {
  edited = true;
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

resetBtn.addEventListener("click", async () => {
  const draft = textarea.value;
  if (draft.trim() && draft !== sampleText && !confirm("Replace your text with the sample? Your current text will be lost.")) {
    return;
  }
  try {
    setContent(await loadSample());
  } catch (error) {
    showStatus("Could not load the sample. Check your connection.");
    return;
  }
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

// The divider between the panes: dragged with a pointer, or focused and moved with the
// arrow keys (Shift for bigger steps), Home and End. aria-valuenow is the editor's share
// of the width, in percent.
let isDragging = false;
const MIN_PANE_WIDTH = 240;
const KEY_STEP_PERCENT = 2;

const setSplit = (percent, { store = true } = {}) => {
  const width = splitPane.getBoundingClientRect().width;
  const min = width > 2 * MIN_PANE_WIDTH ? (MIN_PANE_WIDTH / width) * 100 : 50;
  const clamped = Math.max(min, Math.min(percent, 100 - min));
  const value = `${clamped}%`;
  splitPane.style.setProperty("--split-left", value);
  dragHandle.setAttribute("aria-valuenow", String(Math.round(clamped)));
  if (store) setStored(STORAGE_KEYS.split, value);
};

const currentSplit = () => parseFloat(splitPane.style.getPropertyValue("--split-left")) || 50;

const updateSplit = (clientX) => {
  const rect = splitPane.getBoundingClientRect();
  setSplit(((clientX - rect.left) / rect.width) * 100);
};

setSplit(parseFloat(storedSplit) || 50, { store: false });

dragHandle.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? KEY_STEP_PERCENT * 5 : KEY_STEP_PERCENT;
  const target = {
    ArrowLeft: currentSplit() - step,
    ArrowRight: currentSplit() + step,
    Home: 0,
    End: 100,
  }[event.key];
  if (target === undefined) {
    return;
  }
  event.preventDefault();
  setSplit(target);
});

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

const showConfirm = () => {
  showShareError("");
  shareConfirm.hidden = false;
  shareResult.hidden = true;
  shareCreate.focus();
};

const showResult = (share, { reused = false, tokenStored = true } = {}) => {
  currentShare = share;
  shareUrl.value = share.url;
  shareOpen.href = share.url;
  shareRaw.href = share.markdownUrl;
  shareJson.href = share.jsonUrl;
  // Links remembered before .html existed have no htmlUrl; it follows from the page's.
  shareHtml.href = share.htmlUrl ?? `${share.url}.html`;
  shareExpiry.textContent = `${formatDateTime(share.expiresAt)} (${formatRemaining(share.expiresAt)})`;
  shareResultHeading.textContent = reused ? "Already shared" : "Link created";
  shareReused.hidden = !reused;
  shareNew.hidden = !reused;
  shareTokenNote.hidden = tokenStored;
  shareDelete.disabled = false;
  shareConfirm.hidden = true;
  shareResult.hidden = false;
  shareUrl.focus();
  shareUrl.select();
};

// A live link this browser already made for exactly this text. Checked against the
// server as well, because it may have been deleted from another tab.
const findExistingShare = async (content) => {
  const existing = findShareByHash(await hashText(content));
  if (!existing) {
    return null;
  }
  try {
    const response = await fetch(`/${existing.id}.md`, { method: "HEAD" });
    if (response.ok) {
      return existing;
    }
    if (response.status === 404) {
      forgetShareToken(existing.id);
    }
  } catch (error) {
    // Offline: fall through to a fresh share, which will report the network error.
  }
  return null;
};

shareBtn.addEventListener("click", async () => {
  const content = textarea.value;
  if (!content.trim()) {
    showStatus("Nothing to share yet");
    return;
  }
  const existing = await findExistingShare(content).catch(() => null);
  shareDialog.showModal();
  if (existing) {
    showResult(existing, { reused: true });
  } else {
    showConfirm();
  }
});

shareNew.addEventListener("click", showConfirm);

shareCreate.addEventListener("click", async () => {
  // Only ever from the confirm step of an open dialog.
  if (!shareDialog.open || shareConfirm.hidden) {
    return;
  }
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
    const tokenStored = saveShareToken(data, await hashText(content));
    showResult(data, { tokenStored });
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
    // The token from memory: it is there even when storage refused to keep it.
    if (await deleteShare(currentShare.id, currentShare.deleteToken)) {
      forgetShareToken(currentShare.id);
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

setupExport({ button: exportBtn, menu: exportMenu, getMarkdown: () => textarea.value });
