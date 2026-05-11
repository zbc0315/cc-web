/**
 * Generate a UUID v4. Prefers native `crypto.randomUUID()` (only available in
 * secure contexts — HTTPS, localhost, or 127.0.0.1) but falls back to
 * `crypto.getRandomValues` (available everywhere) when ccweb is accessed
 * over plain LAN HTTP.
 */
export function uuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
    buf[8] = (buf[8] & 0x3f) | 0x80; // variant 10
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return (
      `${h(buf[0])}${h(buf[1])}${h(buf[2])}${h(buf[3])}-` +
      `${h(buf[4])}${h(buf[5])}-${h(buf[6])}${h(buf[7])}-` +
      `${h(buf[8])}${h(buf[9])}-` +
      `${h(buf[10])}${h(buf[11])}${h(buf[12])}${h(buf[13])}${h(buf[14])}${h(buf[15])}`
    );
  }
  // Math.random fallback — non-cryptographic, only triggers in ancient
  // browsers without WebCrypto. Flow-def ids don't carry security weight.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
