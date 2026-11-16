import {assembleDNA} from './dna-recipe.js';
import {isStrategicCruiser, subsystemSlots, subsystemGroups} from '../src/subsystems.mjs';
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
  let index, catalog, directory, headerRequest;
  const models = new Map();
  const recipes = new Map();
  function loadRecipe(url) {
    if (!recipes.has(url)) recipes.set(url, load(url).catch(error => {
      recipes.delete(url);
      throw error;
    }));
    return recipes.get(url);
  }
  function loadIndex() {
    headerRequest ??= fetchJSON(key).then(data => {
      if (data?.version !== 3 || typeof data.directory !== 'string')
        throw Error('Unsupported model index');
      return index = data;
    }).catch(error => { headerRequest = null; throw error; });
    return headerRequest;
  }
  async function inferSubsystems(item, dna) {
    const groups = await Promise.all(subsystemGroups.map(id => catalog.group(id)));
    const slots = subsystemSlots.map((key, slot) => {
      const options = [];
      const prefix = dna.split(':')[0] + '_s' + (slot + 1) + 'v';
      for (const part of groups[slot]) {
        const hull = part.dna.split(':')[0];
        if (!hull.startsWith(prefix) || !/^[1-3]$/.test(hull.slice(prefix.length))) continue;
        const variant = Number(hull.slice(prefix.length));
        if (!options.some(option => option.variant === variant))
          options.push({variant, hull, id:part.id, name:part.name});
      }
      return {key, options};
    });
    if (slots.every(slot => slot.options.length)) item.subsystems = {default:'1111', slots};
  }
  async function resolveModel(value, itemId, staticDNA=value) {
    await loadIndex();
    const expected = staticDNA.trim().toLowerCase();
    if(itemId==null && Object.hasOwn(index.dnaRecipes||{},expected.split(':')[0]))
      return assembleDNA(expected,index,loadRecipe,resolveURL);
    await loadCatalog();
    if (!Object.hasOwn(directory.models, expected)) {
      if(itemId != null || !index.dnaRecipes)throw Error('Model has not been built: '+expected);
      return assembleDNA(expected,index,loadRecipe,resolveURL);
    }
    const summary = directory.models[expected];
    const item = await loadRecipe(summary.detail);
    if (!item.model || (itemId != null && !item.itemIds.includes(itemId))) throw Error('Invalid model index entry: ' + expected);
    const result = {...item, dna:expected, available:true, id:itemId ?? item.id, categoryID:item.categoryID ?? 6,
      name:itemName(item, itemId, expected), model:resolveURL(item.model),
      effects:item.effects && resolveURL(item.effects)};
    if (isStrategicCruiser(result) && !result.subsystems) await inferSubsystems(result, expected);
    return result;
  }
  function dna(value, itemId, staticDNA=value) {
    if (itemId == null && (!directory || !Object.hasOwn(directory.models,staticDNA.trim().toLowerCase())))
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
    loading ??= loadIndex().then(async data => {
      directory = await loadRecipe(data.directory);
      const items = new Map();
      const groups = new Map();
      for (const [dna, model] of Object.entries(directory.models)) {
        for (const id of model.itemIds) {
          items.set(id, {id, dna, name:itemName(model, id, dna), groupID:model.groupID, categoryID:model.categoryID, available:true});
        }
      }
      for (const item of items.values()) {
        if (!groups.has(item.groupID)) groups.set(item.groupID, []);
        groups.get(item.groupID).push(item);
      }
      async function group(id) {
        const rows = groups.get(id) || [];
        const url = directory.groupNames?.[id];
        if (!url) return rows;
        const names = await loadRecipe(url);
        return rows.map(item => ({...item, name:names[item.id] || item.name}));
      }
      catalog = {
        item: async id => items.has(id) ? dna(items.get(id).dna, id) : null,
        search: async () => (await Promise.all([...groups.keys()].map(group))).flat(),
        group,
      };
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
