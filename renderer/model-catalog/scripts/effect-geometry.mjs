// Resolve published shared data. Short animation tracks and assembled T3
// geometry remain inline under the current runtime contract.
const sharedURL = /^assets\/effect-(geometry|animation)\/[0-9a-f]{64}\.json$/;
const validSamples = data => Array.isArray(data) && data.length > 0 && data.every(sample =>
  typeof sample === 'boolean' || Number.isFinite(sample) ||
  (Array.isArray(sample) && sample.length > 0 && sample.every(Number.isFinite)));

export async function resolveEffectGeometry(document, loadJSON, concurrency = 6, loadMesh) {
  const urls = new Set();
  const meshes=new Map(),references=new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if(value.primitive==='unitQuad'||(value.url?.endsWith?.('.glb')&&Number.isInteger(value.mesh))){
      const key=JSON.stringify(value);
      urls.add(key);meshes.set(key,value);references.set(value,key);return;
    }
    if (sharedURL.test(value.url || '')) { urls.add(value.url); return; }
    if (Array.isArray(value.position) && Array.isArray(value.indices)) return;
    for (const child of (Array.isArray(value) ? value : Object.values(value)))
      if (child && typeof child === 'object') visit(child);
  }
  visit(document);
  if (!urls.size) return document;
  const loaded = new Map(), queue = [...urls];
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      if(meshes.has(url)){loaded.set(url,await loadMesh(meshes.get(url)));continue;}
      const data = await loadJSON(url);
      if (url.startsWith('assets/effect-animation/')) {
        if (!validSamples(data)) throw new Error(`Invalid shared effect animation: ${url}`);
        loaded.set(url, data);
      } else {
        if (!Array.isArray(data?.position) || !Array.isArray(data?.indices))
          throw new Error(`Invalid shared effect geometry: ${url}`);
        loaded.set(url, { ...data, sharedGeometryURL: url });
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(Math.max(1, concurrency), queue.length)}, worker));
  function replace(value) {
    if (!value || typeof value !== 'object') return value;
    if(references.has(value))return loaded.get(references.get(value));
    if (loaded.has(value.url)) return loaded.get(value.url);
    if (Array.isArray(value.position) && Array.isArray(value.indices)) return value;
    let result = value;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const child = value[key];
      if (!child || typeof child !== 'object') continue;
      const next = replace(child);
      if (next !== child) {
        if (result === value) result = Array.isArray(value) ? [...value] : {...value};
        result[key] = next;
      }
    }
    return result;
  }
  return replace(document);
}
