/** The three addresses of one share: the page, the raw markdown, and the JSON. */
export function shareLinks(env, id) {
  const base = `https://${env.SITE_HOST}/${id}`;
  return { url: base, markdownUrl: `${base}.md`, jsonUrl: `${base}.json` };
}
