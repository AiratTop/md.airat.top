// Google Analytics counter.
//
// In a file rather than inline so the content security policy can forbid inline script.
// On a shared document's page the URL is the document's only access control, so that
// page is reported under a fixed address and title: views are counted, ids and document
// titles never reach Google.
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
