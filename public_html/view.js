// The shared-document page. The Worker embeds the share in #share-data — null when the
// link has expired or never existed — so the page renders without a second request.

const share = JSON.parse(document.getElementById("share-data").textContent);
const docTitle = document.getElementById("docTitle");
const docMeta = document.getElementById("docMeta");
const docControls = document.getElementById("docControls");
const docPane = document.getElementById("docPane");
const gonePane = document.getElementById("gonePane");
const preview = document.getElementById("preview");
const copyBtn = document.getElementById("copyBtn");
const rawLink = document.getElementById("rawLink");
const editBtn = document.getElementById("editBtn");
const deleteBtn = document.getElementById("deleteBtn");
const exportBtn = document.getElementById("exportBtn");
const exportMenu = document.getElementById("exportMenu");

initTheme(document.getElementById("darkMode"));

const showGone = () => {
  docTitle.textContent = "Link expired";
  docMeta.textContent = "Shared from md.airat.top";
  docControls.hidden = true;
  docPane.hidden = true;
  gonePane.hidden = false;
};

const updateExpiry = () => {
  if (Date.parse(share.expiresAt) <= Date.now()) {
    docMeta.textContent = "This link has expired and will be deleted shortly";
    return;
  }
  docMeta.textContent = `Deleted automatically ${formatRemaining(share.expiresAt)}`;
  docMeta.title = `Deleted at ${formatDateTime(share.expiresAt)}`;
};

if (!share) {
  showGone();
} else {
  // The document's own title stays in <title> and the link preview; showing it in the
  // header as well would repeat the heading the document usually opens with.
  docTitle.textContent = "Shared markdown";
  const render = () => {
    preview.innerHTML = renderMarkdown(share.content);
    renderMath(preview);
    renderDiagrams(preview);
  };
  render();
  // Diagrams are drawn in the theme's colours, so a theme change redraws them.
  new MutationObserver(render).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  rawLink.href = share.markdownUrl;
  setupExport({ button: exportBtn, menu: exportMenu, getMarkdown: () => share.content });
  deleteBtn.hidden = !readShareTokens()[share.id];
  docControls.hidden = false;
  docPane.hidden = false;
  updateExpiry();
  setInterval(updateExpiry, 30000);

  copyBtn.addEventListener("click", async () => {
    showStatus((await copyText(share.content)) ? "Markdown copied to clipboard" : "Could not copy");
  });

  // Hands the document to the editor through the editor's own storage: no id or text
  // travels in a URL.
  editBtn.addEventListener("click", () => {
    const draft = getStored(STORAGE_KEYS.content, "");
    if (
      draft.trim() &&
      draft !== share.content &&
      !confirm("Replace the text in your editor with this document? Your current draft will be overwritten.")
    ) {
      return;
    }
    if (!setStored(STORAGE_KEYS.content, share.content)) {
      showStatus("Browser storage is blocked, so the editor cannot receive this document. Use Copy and paste it instead.", 6000);
      return;
    }
    location.href = "/";
  });

  deleteBtn.addEventListener("click", async () => {
    if (!confirm("Delete this link now? It will stop working for everyone.")) {
      return;
    }
    deleteBtn.disabled = true;
    try {
      if (await deleteShare(share.id)) {
        showGone();
        showStatus("Link deleted");
        return;
      }
    } catch (error) {
      // Reported below.
    }
    deleteBtn.disabled = false;
    showStatus("Could not delete the link");
  });
}
