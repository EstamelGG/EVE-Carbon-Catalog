import { dnaManifestPath } from './dna-path.js';
import { createResourceLocator } from '../src/resource-location.mjs';


// Extracted from the first-generation component-controller.js. Catalog schema
// and field meanings are inherited, not yet independently source-audited.
// Empty resourceBase deliberately means files beside the hosting page.
export function componentResourceKey(options) {
  return JSON.stringify([
    options.resourceBase || '',
    options.backgroundBase || '',
    options.backgroundFiles,
    options.resBase,
  ]);
}

export function createComponentResources(key, fetchJSON) {
  const resolveURL = createResourceLocator(
    ...JSON.parse(key).map((value) => (value === null ? undefined : value)),
  );
  const load = (url) => fetchJSON(resolveURL(url));
  let index, catalog;
  const models = new Map();
  async function resolveModel(value, itemId, staticDNA=value) {
    const manifest = dnaManifestPath(staticDNA);
    await loadCatalog();
    const expected = staticDNA.trim().toLowerCase();
    if (!Object.hasOwn(index.models, expected) || !manifest) throw Error('Model has not been built: ' + expected);
    const item = {...await load(manifest)};
    if (itemId != null && item.itemIds?.includes(itemId)) item.id = itemId;
    const key = item.modelDNA || item.dna;
    if (key?.toLowerCase() !== expected.trim().toLowerCase() || !item.model ||
        (itemId != null && item.id !== itemId)) throw Error('Invalid DNA response');
    if (item.renderManifest) {
      const url = new URL(resolveURL(item.renderManifest), document.baseURI);
      const manifest = await fetchJSON(url.href);
      if (manifest.version !== 1 || manifest.dna.toLowerCase() !== value.trim().toLowerCase())
        throw Error('Invalid hull render manifest');
      const full = manifest.levels.find(level => level.pixels === null && level.tier === 'full');
      if (!full?.file) throw Error('Missing full-resolution hull in render manifest');
      item.model = new URL(full.file, url).href;
    }
    return {...item, available:true, id:item.id || item.dna, categoryID:item.categoryID ?? 6,
      name:item.name || {en:item.dna,zh:item.dna}, model:resolveURL(item.model),
      effects:item.effects && resolveURL(item.effects)};
  }
  function dna(value, itemId, staticDNA=value) {
    const key = JSON.stringify([value.trim().toLowerCase(), itemId, staticDNA]);
    if (!models.has(key)) models.set(key, resolveModel(value, itemId, staticDNA).catch(error => {
      models.delete(key);
      throw error;
    }));
    return models.get(key);
  }
  let loading;
  function loadCatalog() {
    loading ??= load('res/model-index.json').then(data => {
      if (data.version !== 1 || !data.models) throw Error('Unsupported model index');
      const items = new Map();
      for (const [dna, model] of Object.entries(data.models)) {
        for (const id of model.itemIds) {
          items.set(id, {id, dna, name:model.name, groupID:model.groupID, categoryID:model.categoryID, available:true});
        }
      }
      catalog = {
        item: async id => items.has(id) ? dna(items.get(id).dna, id) : null,
        search: async () => [...items.values()],
        group: async id => [...items.values()].filter(item => item.groupID === id),
      };
      index = data;
    }).catch(error => { loading = undefined; throw error; });
    return loading;
  }
  return {
    key, resolveURL, load, dna, loadCatalog,
    get index() { return index; },
    get catalog() { return catalog; },
    async publishedItem(item) {
      if (!item) throw Error('Item is absent from the build index');
      return dna(item.dna, item.id);
    },
  };
}
