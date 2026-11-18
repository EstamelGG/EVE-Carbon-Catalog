import {createHullVariantIndex, hullKey} from './hull-variants.mjs';
import {OTHER_FACTION} from './affiliation.mjs';

export function joinDirectory(inventory, identities, affiliation) {
  const byID = new Map(), groups = new Map(), models = new Map();
  for (const [id, item] of Object.entries(inventory?.items || {}))
    models.set(Number(id), {dna: item.dna, raceID: item.raceID, factionID: item.factionID});
  const categories = (inventory?.categories || []).map(category => {
    const children = category.groups.map(group => {
      // Rows carry the SDE labels so the page needs no item table of its own.
      const items = group.items.map(([id, en, zh, metaGroupID, factionID]) => {
        const model = models.get(id);
        const item = {id, name: {en, zh}, ...model, categoryID: category.id, groupID: group.id,
          available: !!model, metaGroupID, factionID: model?.factionID ?? factionID};
        Object.assign(item, affiliation(item));
        byID.set(item.id, item);
        return item;
      });
      groups.set(group.id, items);
      return {id: group.id, name: group.name, count: items.length, readyCount: items.filter(i => i.available).length, iconTypeID: items[0]?.id};
    });
    return {...category, groups: children, count: children.reduce((n, g) => n + g.count, 0), iconTypeID: children[0]?.iconTypeID};
  });
  const all = [...byID.values()];
  let variants;
  const factions = identities?.factions || [];
  return {categories, iconTypeID: all[0]?.id, items: [], races: [
    ...factions.map(r => ({id: r.id, ...r.name})),
    {id: OTHER_FACTION, en: 'Other', zh: '其他'},
  ],
    loader: {group: id => groups.get(id) || [], search: () => all, item: id => byID.get(id), peek: id => byID.get(id),
      variants: dna => { variants ??= createHullVariantIndex(all); return variants.get(hullKey(dna)) || []; }}};
}
