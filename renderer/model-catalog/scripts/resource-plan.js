import {resourceURL} from '../src/resource-location.mjs';

export function selectedBackground(catalog, race, id = 'auto') {
  return catalog.scenes.find(s => s.id === (id === 'auto' ? (catalog.defaults[race] || `res:/dx9/scene/preview/${race}.red`) : id)) ||
    (id === 'auto' ? catalog.scenes.find(s => s.id === catalog.defaults.gallente) : null);
}

// Read small dependency documents once, using the same cache as installation.
// Shared geometry/animation JSONs are leaf resources and need no pre-download.
export async function planViewerResources(viewer, item, native, backgroundID, batch) {
  const urls = new Set(), session = viewer.assetSession;
  const resolveURL = session.resolveURL || resourceURL;
  const add = (value, base = location.href) => {
    if (typeof value !== 'string' || /^(?:data:|blob:|res:)/i.test(value)) return;
    if (!/\.(?:gltf|glb|bin|rgba|rgba32f|f32|json|webp|dds|png|jpe?g|hdr)(?:[?#]|$)/i.test(value)) return;
    urls.add(new URL(value.startsWith('assets/') || value.startsWith('github-assets/') ? resolveURL(value) : value, base).href);
  };
  const visit = (value, base) => {
    if (typeof value === 'string') add(value, base);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child, base);
  };
  const read = async url => { const href = new URL(resolveURL(url), location.href).href; add(href); return session.json(href); };
  const source = new URL(resolveURL(item.model), location.href).href;
  add(source);
  const tasks = new URL(source).pathname.endsWith('.gltf') ? [read(source).then(doc => visit(doc, source))] : [];
  if (item.effects) tasks.push(read(item.effects).then(doc => visit(doc, location.href)).catch(error=>{if(error?.name==="AbortError")throw error;}));
  if (native) {
    tasks.push(read(native));
    if (item.renderKind !== 'equipment') tasks.push(read('data/reflection-preview.json').then(doc => {
      const settings = doc.races[viewer.previewRace] || doc.races.gallente;
      add(resolveURL(settings.reflection)); add(resolveURL(settings.diffuse));
    }));
  }
  if (item.renderKind !== 'equipment') tasks.push(read('data/backgrounds.json').then(doc => {
    const id = backgroundID === 'none' || backgroundID === 'auto' || doc.scenes.some(s => s.id === backgroundID) ? backgroundID : 'auto';
    const entry = selectedBackground(doc, viewer.previewRace, id);
    if (entry && !session.skybox?.isReady(entry)) { add(resolveURL(entry.url)); if (entry.stars) add(resolveURL(entry.stars)); }
  }).catch(() => {})); // Optional backgrounds must not make the model fail.
  await Promise.all(tasks);
  batch.plan(urls);
  return urls;
}
