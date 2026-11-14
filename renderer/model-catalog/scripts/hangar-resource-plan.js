import { resourceURL } from '../src/resource-location.mjs';

export function hangarModelURL(entry, resolveURL = resourceURL) {
  const url = new URL(resolveURL(entry.model), location.href);
  url.searchParams.set('v', entry.modelRevision || '');
  return url.href;
}

// Discover the complete finite load before starting geometry/material downloads.
// Dependency documents are reused by installation through the session cache.
export async function planHangarResources(session, room, ship) {
  const resolveURL = session.resolveURL || resourceURL, urls = new Set();
  const add = (value, base = location.href) => {
    if (typeof value !== 'string' || /^(?:data:|blob:|res:)/i.test(value)) return;
    const url = new URL(value, base).href;
    urls.add(url);
    return url;
  };
  const asset = async entry => {
    if (!entry) return;
    const source = add(hangarModelURL(entry, resolveURL));
    const document = await session.json(source);
    for (const buffer of document.buffers || []) add(buffer.uri, source);
    // Hangar rendering deliberately omits portable glTF preview textures.
    for (const material of document.materials || []) {
      const native = material.extras?.ccpdecNative;
      if (native?.profile === 'fx-surface-v1') continue;
      for (const url of Object.values(native?.textures || {})) add(url, source);
    }
  };
  const effects = async path => {
    if (!path) return;
    const source = add(resolveURL(path));
    let document;
    try {document=await session.json(source);}
    catch(error){if(error?.name==="AbortError")throw error;return;}
    function visit(value) {
      if (typeof value === 'string') {
        if (/\.(?:json|rgba|rgba32f|f32|dds|webp|png|jpe?g|hdr|bin)(?:[?#]|$)/i.test(value) && !/^res:/i.test(value))
          add(resolveURL(value));
        return;
      }
      if (!value || typeof value !== 'object') return;
      // Video playlists stream independently after the scene becomes ready.
      if (value.video === true) return;
      // Shared geometry/animation JSONs are leaves. Inline numeric geometry
      // can be very large and contains no resource references.
      if (Array.isArray(value) && (typeof value[0] === 'number' || typeof value[0] === 'boolean')) return;
      for (const key in value) if (Object.hasOwn(value, key)) visit(value[key]);
    }
    visit(document);
  };
  if (room) {
    for (const path of [room.hullMetadata, room.environment?.reflection, room.environment?.diffuse, room.environment?.lighting])
      if (path) add(resolveURL(path));
  }
  await Promise.all([asset(room), asset(ship), effects(room?.effects)]);
  return session.bundles ? new Set([...urls].map(url=>session.bundles.transportURL(url))) : urls;
}
