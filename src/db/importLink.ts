/**
 * Import links: https://<app>/#import=<base64url(JSON)>
 * The payload is the standard import JSON, base64url-encoded (UTF-8). It may be gzip-compressed
 * before encoding; gzip is detected from its magic bytes, so no flag is needed.
 * A link pasted into the import box is decoded the same way (on iOS, links open in Safari,
 * not in the Home Screen app, so pasting the link is the reliable route there).
 */

const PARAM = 'import';

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decodes an import payload (the part after "#import="). */
export async function decodeImportPayload(payload: string): Promise<string> {
  let bytes = base64UrlToBytes(decodeURIComponent(payload.trim()));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  return new TextDecoder().decode(bytes);
}

/** Finds an import payload in a URL or hash string, or returns null. */
export function findImportPayload(text: string): string | null {
  const m = /[#?&]import=([A-Za-z0-9_\-%=+/]+)/.exec(text.trim());
  return m ? m[1] : null;
}

/** If `text` is an import link, returns the decoded JSON; otherwise returns `text` unchanged. */
export async function resolveImportText(text: string): Promise<string> {
  const t = text.trim();
  if (!/^https?:\/\/|^#import=/.test(t)) return text;
  const payload = findImportPayload(t);
  if (!payload) return text;
  try {
    return await decodeImportPayload(payload);
  } catch {
    return text;
  }
}

/** Builds a link for the given import JSON (uncompressed). */
export function makeImportLink(json: string, base = `${location.origin}${location.pathname}`): string {
  return `${base}#${PARAM}=${bytesToBase64Url(new TextEncoder().encode(json))}`;
}
