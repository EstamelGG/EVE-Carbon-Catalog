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
    await loadCatalog();
    const expected = staticDNA.trim().toLowerCase();
    if (!Object.hasOwn(index.models, expected)) throw Error('Model has not been built: ' + expected);
    const item = index.models[expected];
    if (!item.model || (itemId != null && !item.itemIds.includes(itemId))) throw Error('Invalid model index entry: ' + expected);
    return {...item, dna:expected, available:true, id:itemId ?? item.id, categoryID:item.categoryID ?? 6,
      name:item.name || {en:expected,zh:expected}, model:resolveURL(item.model),
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
      if (data.version !== 2 || !data.models) throw Error('Unsupported model index');
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
