// Markdown → safe HTML, shared by the editor and the shared-document page.
//
// marked does not sanitise, and since sharing exists the markdown on either page can be
// somebody else's: a shared document, or one opened from a share into the editor.
// Everything marked produces goes through DOMPurify before it reaches the DOM.
// Style is stripped as well as script, so a document cannot restyle the page around it
// into something that looks like part of the site.

marked.setOptions({
  gfm: true,
  breaks: true,
  mangle: false,
  headerIds: false,
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow ugc");
  }
});

const renderMarkdown = (markdown) =>
  DOMPurify.sanitize(marked.parse(markdown), {
    USE_PROFILE: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option"],
    FORBID_ATTR: ["style"],
  });
