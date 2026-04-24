import { getRawFileUrl } from '@/lib/api';

/**
 * Rewrite a markdown `![](src)` src so it loads through ccweb's
 * authenticated `/api/filesystem/raw` endpoint.
 *
 * Markdown files typically reference images with relative paths
 * (`./screenshots/foo.png` or `../assets/bar.jpg`). Browsers resolve those
 * against the HTML document URL, not the markdown file's location, so the
 * default <img> ends up requesting `https://ccweb.example/screenshots/...`
 * which doesn't exist. We resolve against the markdown file's own
 * directory, turn it into an absolute filesystem path, and route it
 * through `/api/filesystem/raw` which already enforces workspace access
 * control (so a hostile README can't try to load arbitrary files).
 *
 * Passes through external URLs (http/https), data: URIs, blob: URIs, and
 * protocol-relative URLs without modification.
 *
 * @param mdFilePath  absolute filesystem path of the .md file being rendered
 * @param token       current auth token (appended as ?token= query param so
 *                    the <img> request carries auth — browsers don't send
 *                    custom Authorization headers for <img src>)
 */
export function resolveMarkdownImageSrc(
  mdFilePath: string,
  src: string | undefined,
  token: string | null,
): string {
  if (!src) return '';
  // Any URI with an RFC 3986 scheme (scheme = ALPHA *( ALPHA / DIGIT / + / - / . ))
  // or a protocol-relative `//host` → pass through unmodified.  Whitelisting
  // only http/data/blob/... leaves exotic or future schemes treated as
  // relative paths, producing nonsense like `/path/to/dir/javascript:alert(1)`.
  // The backend's `isPathAllowed` would still reject those, but passing them
  // through to the browser lets native UA handling decide.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return src;

  // Separate off `?query` or `#fragment` so they don't get percent-encoded
  // as part of the path. Examples: `./foo.png?v=2`, `./bar.svg#layer3`.
  let pathPart = src;
  let suffix = '';
  const qIdx = pathPart.search(/[?#]/);
  if (qIdx >= 0) { suffix = pathPart.slice(qIdx); pathPart = pathPart.slice(0, qIdx); }

  // Find md file's directory, supporting both POSIX (/) and Windows (\)
  // separators — ccweb's backend is cross-platform.
  const sepIdx = Math.max(mdFilePath.lastIndexOf('/'), mdFilePath.lastIndexOf('\\'));
  const mdDir = sepIdx >= 0 ? mdFilePath.substring(0, sepIdx) : '';

  const joined = (pathPart.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(pathPart))
    ? pathPart
    : `${mdDir}/${pathPart}`;
  const resolved = normalize(joined);

  let url = getRawFileUrl(resolved);
  if (token) url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  return url + suffix;
}

/** Collapse `./` and `../` segments into a clean absolute path. Accepts
 *  mixed `/` and `\` separators (Windows). */
function normalize(p: string): string {
  const parts = p.split(/[/\\]+/);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') stack.pop();
    else if (part !== '.' && part !== '') stack.push(part);
  }
  return '/' + stack.join('/');
}
