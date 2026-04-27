/**
 * Cross-context text copy. The async Clipboard API (navigator.clipboard) is
 * only exposed in secure contexts (HTTPS / localhost / 127.0.0.1). ccweb is
 * frequently accessed over plain HTTP on LAN IPs (e.g. http://192.168.1.x:3001
 * from a phone or another laptop), where `navigator.clipboard` is undefined
 * and any `.writeText()` call throws TypeError.
 *
 * Fallback path uses `document.execCommand('copy')` against a hidden,
 * read-only textarea. The API is deprecated but still works in every browser
 * we care about, and it doesn't require secure context.
 *
 * Returns whether the copy actually landed in the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied / not focused / etc. — fall through to execCommand.
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Position off-screen but keep within the document so selection works.
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
