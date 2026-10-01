// Export: the document as Markdown, as a standalone HTML file, or as PDF through the
// browser's own print dialog. Everything happens in this browser; nothing is uploaded.
//
// Exports are always light. A document is exported to be read or printed, and diagrams
// are drawn into their SVG in one theme, so a single predictable look beats a choice.
// The export copy is rendered into #exportArea with light diagrams, whatever the page's
// theme; the HTML file and the print both use it.

const exportArea = document.getElementById("exportArea");

// Filename from the document's title: front-matter title, else the first heading.
const documentTitle = (container) => {
  const frontMatter = container.querySelector("table.front-matter");
  if (frontMatter) {
    const keys = [...frontMatter.querySelectorAll("th")].map((th) => th.textContent.trim().toLowerCase());
    const index = keys.indexOf("title");
    const cell = index >= 0 ? frontMatter.querySelectorAll("td")[index] : null;
    if (cell && cell.textContent.trim()) return cell.textContent.trim();
  }
  const heading = container.querySelector("h1, h2, h3");
  return heading ? heading.textContent.trim() : "";
};

// "quarterly-notes_2026-10-01_14-32-05.md": the title as letters, digits and hyphens
// (nothing any file system forbids), then the local date and time to the second, so
// exporting twice does not overwrite the first file.
const fileName = (title, extension, now = new Date()) => {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const pad = (value) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${slug || "document"}_${stamp}.${extension}`;
};

const download = (name, type, content) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Renders the markdown into #exportArea, light, with math and diagrams finished.
const renderForExport = async (markdown) => {
  exportArea.innerHTML = renderMarkdown(markdown);
  await Promise.all([renderMath(exportArea), renderDiagrams(exportArea, { theme: "default" })]);
  return exportArea;
};

const fetchText = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.text();
};

// KaTeX's stylesheet with its fonts inlined, so a file with math renders offline.
const katexStylesheet = async () => {
  const css = await fetchText("/vendor/katex/katex.css");
  const fonts = [...new Set(css.match(/fonts\/[\w-]+\.woff2/g) ?? [])];
  const inlined = await Promise.all(
    fonts.map(async (path) => {
      const response = await fetch(`/vendor/katex/${path}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return [path, `data:font/woff2;base64,${btoa(binary)}`];
    })
  );
  // Only woff2 is shipped; the woff and ttf fallbacks in the stylesheet are dropped.
  let result = css.replace(/,url\(fonts\/[\w-]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, "");
  for (const [path, dataUrl] of inlined) result = result.split(path).join(dataUrl);
  return result;
};

const toDataUrl = async (url) => {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// A copy of the document whose links and images still work when the file is opened from
// disk, where a relative URL would point into the file system: this site's own images are
// embedded, every other URL becomes absolute, and in-page #links stay as they are.
// srcset goes, and <picture> sources with it: the browser would pick one of those over the
// src that was embedded, and on a high-density screen it does.
const portableCopy = async (container) => {
  const copy = container.cloneNode(true);
  const absolute = (value) => {
    try {
      return new URL(value, location.href).href;
    } catch (error) {
      return value;
    }
  };
  for (const source of copy.querySelectorAll("picture source")) source.remove();
  for (const element of copy.querySelectorAll("[srcset]")) {
    element.removeAttribute("srcset");
    element.removeAttribute("sizes");
  }
  for (const element of copy.querySelectorAll("[href]")) {
    const href = element.getAttribute("href");
    if (!href.startsWith("#")) element.setAttribute("href", absolute(href));
  }
  for (const element of copy.querySelectorAll("[src]:not(img), [poster]")) {
    for (const name of ["src", "poster"]) {
      if (element.hasAttribute(name)) element.setAttribute(name, absolute(element.getAttribute(name)));
    }
  }
  await Promise.all(
    [...copy.querySelectorAll("img[src]")].map(async (image) => {
      const url = new URL(image.getAttribute("src"), location.href);
      if (url.origin === location.origin) {
        image.setAttribute("src", await toDataUrl(url).catch(() => url.href));
      } else {
        image.setAttribute("src", url.href);
      }
    })
  );
  return copy;
};

const escapeText = (value) => value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

// A single file: the rendered document, this site's styles and nothing else — no
// script, no request to anywhere when it is opened.
const standaloneHtml = async (container, title) => {
  const hasMath = Boolean(container.querySelector(".katex"));
  const [site, highlight, katex, body] = await Promise.all([
    fetchText("/styles.css"),
    fetchText("/vendor/highlight.css"),
    hasMath ? katexStylesheet() : "",
    portableCopy(container),
  ]);
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="md.airat.top">
<title>${escapeText(title || "Document")}</title>
<style>
${highlight}
${katex}
${site}
</style>
</head>
<body class="export-page">
<main class="preview export-document">
${body.innerHTML}
</main>
</body>
</html>
`;
};

// Only the title is needed, so this renders into a detached element rather than
// #exportArea, which an HTML or PDF export may be using.
const exportMarkdown = (markdown) => {
  const scratch = document.createElement("div");
  scratch.innerHTML = renderMarkdown(markdown);
  download(fileName(documentTitle(scratch), "md"), "text/markdown;charset=utf-8", markdown);
};

const exportHtml = async (markdown) => {
  const container = await renderForExport(markdown);
  const title = documentTitle(container);
  download(fileName(title, "html"), "text/html;charset=utf-8", await standaloneHtml(container, title));
  // Other sites' images are not embedded: fetching them would take a request to another
  // origin, which this site's policy refuses. They stay links, and the author is told.
  const external = [...container.querySelectorAll("img[src]")].filter(
    (image) => new URL(image.getAttribute("src"), location.href).origin !== location.origin
  ).length;
  if (external) {
    showStatus(`Exported. ${external === 1 ? "1 image from another site stays a link" : `${external} images from other sites stay links`}: the file needs the network to show ${external === 1 ? "it" : "them"}.`, 6000);
  }
};

// Before printing, everything the print shows must have arrived: KaTeX's stylesheet,
// the fonts, and every image, loaded and decoded. Bounded, because an image host may
// never answer; what is still missing then is reported rather than waited for.
const PRINT_WAIT_MS = 10_000;

const printReady = async (container) => {
  const images = [...container.querySelectorAll("img")];
  for (const image of images) image.loading = "eager"; // a lazy image off-screen never loads
  const loaded = (image) =>
    image.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
  const everything = Promise.all([
    container.querySelector(".katex") ? katexStyled : null,
    document.fonts.ready,
    ...images.map((image) => loaded(image).then(() => image.decode().catch(() => {}))),
  ]);
  await Promise.race([everything, new Promise((resolve) => setTimeout(resolve, PRINT_WAIT_MS))]);
  return images.filter((image) => !image.complete || image.naturalWidth === 0).length;
};

// The print shows only #exportArea (see @media print in styles.css). The page title
// becomes the suggested PDF filename, so it is the document's for the duration.
const exportPdf = async (markdown) => {
  const container = await renderForExport(markdown);
  const missing = await printReady(container);
  if (missing) {
    showStatus(`${missing === 1 ? "1 image" : `${missing} images`} could not be loaded and will be missing from the PDF.`, 6000);
  }
  const pageTitle = document.title;
  document.title = fileName(documentTitle(container), "pdf").replace(/\.pdf$/, "");
  document.body.classList.add("is-printing");
  const restore = () => {
    document.body.classList.remove("is-printing");
    document.title = pageTitle;
  };
  window.addEventListener("afterprint", restore, { once: true });
  window.print();
};

// The Export button and its menu. `getMarkdown` returns the text to export.
const setupExport = ({ button, menu, getMarkdown }) => {
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    items[0].focus();
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) close();
  });
  menu.addEventListener("keydown", (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      close();
      button.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    }
  });

  // One export at a time: HTML and PDF render into the shared #exportArea and wait on
  // math, diagrams and images, and a second export started meanwhile replaced the
  // document under the first. The text is taken when the export starts.
  const actions = { md: exportMarkdown, html: exportHtml, pdf: exportPdf };
  let busy = false;
  for (const item of menu.querySelectorAll("[data-export]")) {
    item.addEventListener("click", async () => {
      close();
      if (busy) {
        showStatus("An export is already in progress");
        return;
      }
      const markdown = getMarkdown();
      if (!markdown.trim()) {
        showStatus("Nothing to export yet");
        return;
      }
      busy = true;
      try {
        await actions[item.dataset.export](markdown);
      } catch (error) {
        showStatus("Export failed. Try again.");
      } finally {
        busy = false;
      }
    });
  }
};
