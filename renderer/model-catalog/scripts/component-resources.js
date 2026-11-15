import {assembleDNA} from './dna-recipe.js';
import { createResourceLocator, normalizeModelIndex } from '../src/resource-location.mjs';


export function componentResourceKey(options) {
  return normalizeModelIndex(options.modelIndex);
}

function itemName(model, id, dna) {
  if (id == null || id === model.id) return model.name || {en:dna, zh:dna};
  return model.itemNames?.[id] || {en:`ID ${id}`, zh:`ID ${id}`};
}

export function createComponentResources(key, fetchJSON) {
  const resolveURL = createResourceLocator(key);
  const load = (url) => fetchJSON(resolveURL(url));
  let index, catalog;
  const models = new Map();
  const recipes = new Map();
  function loadRecipe(url) {
    if (!recipes.has(url)) recipes.set(url, load(url).catch(error => {
      recipes.delete(url);
      throw error;
    }));
    return recipes.get(url);
  }
  async function resolveModel(value, itemId, staticDNA=value) {
    await loadCatalog();
    const expected = staticDNA.trim().toLowerCase();
    if(itemId==null && Object.hasOwn(index.dnaRecipes||{},expected.split(':')[0]))
      return assembleDNA(expected,index,loadRecipe,resolveURL);
    if (!Object.hasOwn(index.models, expected)) {
      if(itemId != null || !index.dnaRecipes)throw Error('Model has not been built: '+expected);
      return assembleDNA(expected,index,loadRecipe,resolveURL);
    }
    const item = index.models[expected];
    if (!item.model || (itemId != null && !item.itemIds.includes(itemId))) throw Error('Invalid model index entry: ' + expected);
    return {...item, dna:expected, available:true, id:itemId ?? item.id, categoryID:item.categoryID ?? 6,
      name:itemName(item, itemId, expected), model:resolveURL(item.model),
      effects:item.effects && resolveURL(item.effects)};
  }
  function dna(value, itemId, staticDNA=value) {
    if (index && !Object.hasOwn(index.models,staticDNA.trim().toLowerCase()))
      return resolveModel(value,itemId,staticDNA);
    const key = JSON.stringify([value.trim().toLowerCase(), itemId, staticDNA]);
    if (!models.has(key)) models.set(key, resolveModel(value, itemId, staticDNA).catch(error => {
      models.delete(key);
      throw error;
    }));
    return models.get(key);
  }
  let loading;
  function loadCatalog() {
    loading ??= fetchJSON(key).then(data => {
      if (data.version !== 2 || !data.models) throw Error('Unsupported model index');
      const items = new Map();
      for (const [dna, model] of Object.entries(data.models)) {
        for (const id of model.itemIds) {
          items.set(id, {id, dna, name:itemName(model, id, dna), groupID:model.groupID, categoryID:model.categoryID, available:true});
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
    officialSkin:skin=>assembleDNA(skin.dna,index,loadRecipe,resolveURL,{officialSkin:true}),
    get index() { return index; },
    get catalog() { return catalog; },
    async publishedItem(item) {
      if (!item) throw Error('Item is absent from the build index');
      return dna(item.dna, item.id);
    },
  };
}
