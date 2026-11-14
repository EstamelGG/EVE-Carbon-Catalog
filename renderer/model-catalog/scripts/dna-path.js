/** Reversible filesystem-safe spelling shared by the builder and web component. */
export function dnaManifestPath(value) {
  const parts = value.trim().toLowerCase().split(':');
  if (parts.length < 2 || parts.some(part => !part || part.length > 150)) return null;
  const escape = part => Array.from(new TextEncoder().encode(part), byte => {
    const c = String.fromCharCode(byte);
    return /[a-z0-9_-]/.test(c) ? c : '~' + byte.toString(16).padStart(2,'0');
  }).join('');
  return 'res/dna/' + parts.map(part => 'd-' + escape(part)).join('/') + '/manifest.json';
}
