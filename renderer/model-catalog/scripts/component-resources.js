import {assembleDNA} from './dna-recipe.js';
import {isStrategicCruiser, subsystemSlots, subsystemGroups} from '../src/subsystems.mjs';
import { createResourceLocator, normalizeModelIndex } from '../src/resource-location.mjs';

// Standalone graphic shards mirror the published name, so no lookup table is
// downloaded: the DNA alone addresses the record.
function graphicShard(dna) {
  return 'res/index/models/' + dna.replace(/[^a-zA-Z0-9_.-]/g, c => '~' + c.codePointAt(0).toString(16) + '~') + '.json';
}

export function componentResourceKey(options) {
  return normalizeModelIndex(options.modelIndex);
}

export function createComponentResources(key, fetchJSON) {
  const resolveURL = createResourceLocator(key);
  const load = (url) => fetchJSON(resolveURL(url));
  let header, headerRequest;
  const shards = new Map(), items = new Map(), skins = new Map();
  const models = new Map(), recipes = new Map();
  const memo = (cache, id, create) => {
    if (!cache.has(id)) cache.set(id, Promise.resolve().then(create).catch(error => {
      cache.delete(id);
      throw error;
    }));
    return cache.get(id);
  };
  function loadRecipe(url) {
    if (!recipes.has(url)) recipes.set(url, load(url).catch(error => {
      recipes.delete(url);
      throw error;
    }));
    return recipes.get(url);
  }
  function loadHeader() {
    headerRequest ??= fetchJSON(key).then(data => {
      const path = value => typeof value === 'string' && value.startsWith('res/');
      if (data?.version !== 4 || !path(data.items) || !path(data.skins) ||
          !path(data.ships) || !path(data.subsystems))
        throw Error('Unsupported model index');
      return header = data;
    }).catch(error => { headerRequest = null; throw error; });
    return headerRequest;
  }
  // One file per item; a missing file means the item has no published model.
  async function identity(itemId) {
    const index = await loadHeader();
    const id = Number(itemId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const record = await memo(items, id, () => load(index.items + '/' + id + '.json')).catch(() => null);
    return record ? {...record, id} : null;
  }
  // One request per skin, so an item's picker needs its own ids only. The file
  // stores the bilingual label at the top level next to the DNA body.
  async function skin(skinId) {
    const index = await loadHeader();
    const id = Number(skinId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const entry = await memo(skins, id, () => load(index.skins + '/' + id + '.json'));
    const record = {id, name: {en: entry.en, zh: entry.zh}};
    if (entry.b) record.b = entry.b;
    if (entry.v) record.v = entry.v;
    return record;
  }
  async function skinsFor(itemId) {
    const record = await identity(itemId);
    if (!record?.skins?.length) return [];
    const entries = await Promise.all(record.skins.map(id => skin(id).catch(() => null)));
    return entries.filter(Boolean);
  }
  async function shipList() {
    const index = await loadHeader();
    const rows = await memo(shards, index.ships, () => load(index.ships));
    return Object.entries(rows || {}).map(([id, row]) => ({...row, id:Number(id), available:true}));
  }
  async function subsystemParts() {
    const index = await loadHeader();
    const rows = await memo(shards, index.subsystems, () => load(index.subsystems));
    return Object.entries(rows || {}).map(([id, row]) => ({...row, id:Number(id), available:true}));
  }
  async function inferSubsystems(item, dna) {
    const parts = await subsystemParts();
    const slots = subsystemSlots.map((key, slot) => {
      const options = [];
      const prefix = dna.split(':')[0] + '_s' + (slot + 1) + 'v';
      for (const part of parts) {
        if (part.groupID !== subsystemGroups[slot]) continue;
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
    const index = await loadHeader();
    const expected = value.trim().toLowerCase();
    if(itemId==null && Object.hasOwn(index.dnaRecipes||{},expected.split(':')[0]))
      return assembleDNA(expected,index,loadRecipe,resolveURL);
    const record = itemId == null ? null : await identity(itemId);
    if (itemId != null && (!record || record.dna !== expected))
      throw Error('Item is absent from the component index');
    let composed;
    if (expected.startsWith('graphic:')) {
      composed = await loadRecipe(graphicShard(expected));
      composed = {...composed, model:resolveURL(composed.model),
        effects:composed.effects && resolveURL(composed.effects)};
    } else composed = await assembleDNA(expected,index,loadRecipe,resolveURL);
    const result = {...composed,...record,dna:expected,available:true,
      id:itemId ?? composed.id, name:record?.name || composed.name};
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
  return {
    key, resolveURL, load, dna, identity, skins: skinsFor, skin, ships: shipList, subsystemParts,
    // A skin whose authored material set carries no race publishes one body per
    // race; the item's own DNA race selects it.
    officialSkin: async (item, skin) => {
      const variants = skin.v || [];
      const body = skin.b || (variants.find(entry => entry.r === item.dna.split(':')[2]) || variants[0])?.b;
      if (!body) throw Error(`Skin ${skin.id} has no DNA body`);
      return assembleDNA(`${item.dna.split(':')[0]}:${body}`, await loadHeader(), loadRecipe, resolveURL,
        {officialSkin:true});
    },
    get index() { return header; },
    async item(itemId) {
      const record = await identity(itemId);
      if (!record) throw Error('Item is absent from the component index');
      return dna(record.dna, record.id);
    },
  };
}
