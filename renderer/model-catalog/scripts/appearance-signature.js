function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}

// Be conservative: unknown geometry, animation, UV, shader or scene changes
// take the ordinary loader path. Only native runtime material inputs may differ.
export function appearanceSignature(document, url) {
  if (!document?.materials?.length || !document.materials.every(m => m.extras?.ccpdecNative?.profile === 'quad-runtime-v1')) return null;
  const copy = structuredClone(document);
  // GLTFLoader owns the base textures. Their descriptors and resolved URLs must
  // still describe the loaded model when the material overlay is removed.
  for (const image of copy.images || []) {
    if (image.uri) image.uri = new URL(image.uri, url).href;
  }
  for (const key of ['typeID', 'dna', 'warnings']) if (copy.extras?.ccpdec) delete copy.extras.ccpdec[key];
  for (const material of copy.materials) {
    const native = material.extras.ccpdecNative;
    // Only these two dictionaries are fully supplied to the replacement
    // material. Keep effect, profile, surface kind and unknown extension data.
    delete native.parameters;
    delete native.textures;
  }
  for (const buffer of copy.buffers || []) {
    if (!buffer.uri) return null; // Embedded GLB bytes cannot be compared by URL.
    buffer.uri = new URL(buffer.uri, url).href;
  }
  return JSON.stringify(stable(copy));
}

export function canReuseHull(previous, previousURL, next, nextURL) {
  const signature = appearanceSignature(previous, previousURL);
  return signature !== null && signature === appearanceSignature(next, nextURL);
}
