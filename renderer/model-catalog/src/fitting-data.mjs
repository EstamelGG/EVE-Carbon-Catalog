// Owner manifests reference only compatible equipment shards. No global fitting file.
import {resolveFittingRules} from './fitting-rules.mjs';

function shardPath(categoryID, prefix) {
  return `res/fitting/lists/${categoryID}-${prefix}.json`;
}

async function optionalShard(load, path) {
  try {
    return await load(path);
  } catch {
    return null;
  }
}

export async function loadFittingData(item, load, hardpoints = []) {
  if (!item?.fitting) return {version:2, sourceVersion:0, equipment:[]};
  const descriptor = await load(item.fitting);
  if (![3,4,5].includes(descriptor.version) || !Array.isArray(descriptor.equipmentShards))
    throw Error('Per-hull fitting metadata version 3, 4 or 5 is required');
  if (!Object.hasOwn(descriptor,'materialRules'))throw Error('Missing fitting rules; rebuild fitting resources');
  const categoryID = descriptor.hullCategory === 65 ? 66 : 7,
    shardURLs = new Set(descriptor.equipmentShards);
  // Version 3 inferred extra shards from locator families. That made a hull
  // with turret locators advertise turret weapons even when the SDE granted
  // only launcher slots. Version 4 publishes the exact compatibility set.
  if (descriptor.version === 3) {
    const compatiblePrefixes = new Set(
      hardpoints.map(({name}) => /^locator_(.+)_\d/i.exec(name)?.[1]).filter(Boolean),
    );
    for (const family of compatiblePrefixes) {
      const path = shardPath(categoryID, `locator_${family.toLowerCase()}_`);
      if (!shardURLs.has(path)) shardURLs.add(path);
    }
  }
  const loadedShards = await Promise.all([...shardURLs].map((url) =>
    descriptor.version === 3 ? optionalShard(load, url) : load(url)));
  const shards = loadedShards.filter(Boolean);
  const equipment = new Map();
  const capacity = descriptor.hardpoints;
  const compatible = (row) => {
    if (row.supported === false || row.requirement === 'unsupported') return false;
    if (!capacity) return true;
    if (['high', 'launcher', 'turret', 'xl'].includes(row.requirement))
      return [capacity.high, capacity.launcher, capacity.turret]
        .some((value) => Number(value) > 0);
    return true;
  };
  for (const shard of shards) {
    if (shard.version !== 1 || !Array.isArray(shard.equipment)) throw Error('Invalid equipment shard');
    for (const row of shard.equipment) if (compatible(row)) equipment.set(row.id, row);
  }
  const appearance=await resolveFittingRules(descriptor.materialRules,item.dna,load);
  const slots=Array.isArray(descriptor.slots)
    ? descriptor.slots.map(definition=>descriptor.hardpoints
      ? {...definition,hardpoints:descriptor.hardpoints}:definition)
    : undefined;
  return {version:2, sourceVersion:descriptor.version, equipment:[...equipment.values()], appearance,
    hullCategory:item.categoryID === 65 ? 65 : descriptor.hullCategory,
    hardpoints:descriptor.hardpoints, slots};
}
