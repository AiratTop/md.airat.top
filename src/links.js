/** The addresses of one share: the page, and its markdown, JSON and HTML. */
export function shareLinks(env, id) {
  const base = `https://${env.SITE_HOST}/${id}`;
  return { url: base, markdownUrl: `${base}.md`, jsonUrl: `${base}.json`, htmlUrl: `${base}.html` };
}
