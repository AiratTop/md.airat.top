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

// Task-list items render as a symbol rather than an <input>: DOMPurify removes every
// input (a document has no business shipping form fields), and with it the only thing
// that told "- [x]" from "- [ ]".
marked.use({
  renderer: {
    checkbox({ checked }) {
      return checked
        ? '<span class="task-box is-done" role="img" aria-label="Done">☑</span>'
        : '<span class="task-box" role="img" aria-label="Not done">☐</span>';
    },
  },
});

const USER_ID_PREFIX = "user-content-";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A" || !node.hasAttribute("href")) {
    return;
  }
  const href = node.getAttribute("href");
  if (href.startsWith("#")) {
    // Ids in the document are prefixed (see below); in-page links follow them, and stay
    // in the same tab.
    if (href.length > 1 && !href.startsWith(`#${USER_ID_PREFIX}`)) {
      node.setAttribute("href", `#${USER_ID_PREFIX}${href.slice(1)}`);
    }
    return;
  }
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer nofollow ugc");
});

// SANITIZE_NAMED_PROPS prefixes every id and name in the document with "user-content-".
// Without it, a document containing <a id="shareCreate"> is found by the page's own
// getElementById("shareCreate") — it comes first in the DOM — and a click on it
// published the draft with no dialog. The pages also look their controls up before any
// markdown is rendered, and inside their own containers; this closes the class of bug
// rather than the one instance.
const renderMarkdown = (markdown) =>
  DOMPurify.sanitize(marked.parse(markdown), {
    USE_PROFILE: { html: true },
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option"],
    FORBID_ATTR: ["style"],
  });
