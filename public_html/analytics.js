// Google Analytics counter.
//
// In a file rather than inline so the content security policy can forbid inline script,
// and loaded *before* gtag.js (see the <head> of both pages) for the reason below.
//
// Page views only, as far as this code can make it so:
//
// - On a shared document's page the URL is the document's only access control, so that
//   page is reported under a fixed address and title.
// - GA's enhanced measurement reports the full URL of any outbound or download link that
//   is clicked (`link_url`). Inside the editor preview and a shared document, those
//   links come from the text — a draft that was never shared, or a URL carrying a
//   token. Clicks inside rendered markdown are kept from GA's listeners: this capture
//   listener on window is registered before gtag.js exists, so it runs first, and
//   stopping propagation leaves the browser's own navigation untouched.
//
// Enhanced measurement can only be switched off in the GA property itself (Admin → Data
// streams → Enhanced measurement); turning off outbound clicks, file downloads and form
// interactions there as well is recommended, and this guard does not depend on it.
for (const type of ["click", "auxclick"]) {
  window.addEventListener(
    type,
    (event) => {
      if (event.target instanceof Element && event.target.closest(".preview")) {
        event.stopImmediatePropagation();
      }
    },
    true
  );
}

window.dataLayer = window.dataLayer || [];
function gtag() {
  dataLayer.push(arguments);
}
gtag("js", new Date());
gtag(
  "config",
  "G-CVEGGNPJXK",
  /^\/[0-9A-Z]{26}$/i.test(location.pathname)
    ? { page_location: `${location.origin}/shared`, page_title: "Shared markdown" }
    : {}
);
