import {createHullVariantIndex, hullKey} from './hull-variants.mjs';

export function joinDirectory(directory, inventory, identities, affiliation) {
  const byID = new Map(), groups = new Map(), models = new Map();
  for (const item of Object.values(inventory?.items || {}))
    models.set(item.id, {dna:item.dna, raceID:item.raceID});
  const categories = directory.map(category => {
    const children = category.groups.map(group => {
      const items = group.items.map(row => {
        const model = models.get(row.id);
        const item = {...row, ...model, categoryID:category.id, groupID:group.id,
          available:!!model, metaGroupID:identities.typeMetaGroups?.[row.id]};
        Object.assign(item, affiliation(item));
        byID.set(item.id,item);
        return item;
      });
      groups.set(group.id,items);
      return {id:group.id,name:group.name,count:items.length,readyCount:items.filter(i=>i.available).length,iconTypeID:items[0]?.id};
    });
    return {...category,groups:children,count:children.reduce((n,g)=>n+g.count,0),iconTypeID:children[0]?.iconTypeID};
  });
  const all = [...byID.values()];
  let variants;
  return {categories, iconTypeID:all[0]?.id, items:[], races:[...identities.races,...identities.factions].map(r=>({id:r.id,...r.name,icon:r.icon})),
    loader:{group:id=>groups.get(id)||[], search:()=>all, item:id=>byID.get(id), peek:id=>byID.get(id),
      variants:dna=>{variants??=createHullVariantIndex(all);return variants.get(hullKey(dna))||[];}}};
}
