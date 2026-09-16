/**
 * btoa-based, same approach as engine/rotation-http-client.ts's
 * `toBase64` -- duplicated rather than imported from there on purpose:
 * that file is an HTTP client for the rotation endpoints, and pulling
 * it in here just for this three-line helper would couple the UI
 * layer to a network module it otherwise has no reason to depend on.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
