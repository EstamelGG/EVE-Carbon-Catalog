import { sessionReflections } from './native-reflections.js';
import {concurrentMap} from './concurrent-map.js';

export async function prefetchModelTextures(session, source, isValid = () => true) {
  const document = await session.json(source), urls = new Set();
  // GLTFLoader already starts these with geometry; native materials reuse its
  // decoded images. Warming them separately would duplicate cold requests.
  const portable = new Set((document.images || []).filter(image => image.uri)
    .map(image => new URL(image.uri, source).href));
  for (const material of document.materials || []) {
    const native = material.extras?.ccpdecNative;
    if (native?.profile === 'fx-surface-v1') continue;
    for (const url of Object.values(native?.textures || {})) {
      const href = new URL(url, source).href;
      if (!portable.has(href)) urls.add(href);
    }
  }
  await concurrentMap(urls, url => session.resources.texture({url}), {limit:6, isValid});
}

// Warm session caches while geometry loads. Installation keeps its existing
// dependency order and retries failed speculative requests through those caches.
export function prefetchViewerAssets(viewer, effects, native = true, source) {
  const session = viewer.assetSession;
  const pending = [];
  if (native) pending.push(sessionReflections(session, viewer.previewRace));
  if (native && source && new URL(source,location.href).pathname.endsWith('.gltf')) pending.push(prefetchModelTextures(session, source, () => !viewer.lifecycle?.disposed));
  if (effects) pending.push(session.json(effects).then(data => {
    return Promise.all(Object.values(data.booster?.textures || {}).map(record => session.resources.texture(record)));
  }));
  return Promise.all(pending);
}
