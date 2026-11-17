import {assembleDNA} from './dna-recipe.js';
import {isStrategicCruiser, subsystemSlots, subsystemGroups} from '../src/subsystems.mjs';
import { createResourceLocator, normalizeModelIndex } from '../src/resource-location.mjs';


export function componentResourceKey(options) {
  return normalizeModelIndex(options.modelIndex);
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
      if (data?.version !== 4 || typeof data.directory !== 'string')
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
          options.push({variant, hull, id:part.id, name:part.name, nextSubsystem:part.nextSubsystem});
      }
      return {key, options};
    });
    if (slots.every(slot => slot.options.length)) item.subsystems = {default:'1111', slots};
  }
  async function resolveModel(value, itemId) {
    await loadIndex();
    const expected = value.trim().toLowerCase();
    if(itemId==null && Object.hasOwn(index.dnaRecipes||{},expected.split(':')[0]))
      return assembleDNA(expected,index,loadRecipe,resolveURL);
    await loadCatalog();
    const identity = itemId == null ? null : directory.items[itemId];
    if (itemId != null && (!identity || identity.dna !== expected))
      throw Error('Item is absent from the component index');
    let composed;
    if (expected.startsWith('graphic:')) {
      const asset = directory.assets[expected];
      if (!asset) throw Error('Unpublished graphic: '+expected);
      composed = await loadRecipe(asset);
      composed = {...composed, model:resolveURL(composed.model),
        effects:composed.effects && resolveURL(composed.effects)};
    } else composed = await assembleDNA(expected,index,loadRecipe,resolveURL);
    const result = {...composed,...identity,dna:expected,available:true,
      id:itemId ?? composed.id, name:identity?.name || composed.name,
      officialSkins:identity?.officialSkins ? {[identity.id]:identity.officialSkins} : composed.officialSkins};
    if (isStrategicCruiser(result) && !result.subsystems) await inferSubsystems(result, expected);
    return result;
  }
  function dna(value, itemId) {
    const key = JSON.stringify([value.trim().toLowerCase(), itemId]);
    if (!models.has(key)) models.set(key, resolveModel(value, itemId).catch(error => {
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
      for (const row of Object.values(directory.items))
        items.set(row.id,{...row,available:true});
      for (const item of items.values()) {
        if (!groups.has(item.groupID)) groups.set(item.groupID, []);
        groups.get(item.groupID).push(item);
      }
      async function group(id) { return groups.get(id) || []; }
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
