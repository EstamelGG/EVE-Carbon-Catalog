// Owner manifests reference only compatible equipment shards. No global fitting file.
import {resolveFittingRules} from './fitting-rules.mjs';
import {
  equipmentPrefixesForMountFamilies,
  hardpointFamilies,
} from './hardpoint-locators.mjs';

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
  if (!item?.fitting) return {version:2, equipment:[]};
  const descriptor = await load(item.fitting);
  if (descriptor.version !== 3 || !Array.isArray(descriptor.equipmentShards))
    throw Error('Per-hull fitting metadata version 3 is required');
  if (!Object.hasOwn(descriptor,'materialRules'))throw Error('Missing fitting rules; rebuild fitting resources');
  const categoryID = descriptor.hullCategory === 65 ? 66 : 7,
    shardURLs = new Set(descriptor.equipmentShards),
    optionalURLs = new Map();
  const compatiblePrefixes = equipmentPrefixesForMountFamilies(
    hardpointFamilies(hardpoints),
  );
  for (const prefix of compatiblePrefixes) {
    const path = shardPath(categoryID, prefix);
    if (!shardURLs.has(path)) optionalURLs.set(path, prefix);
    shardURLs.add(path);
  }
  const loadedShards = await Promise.all(
    [...shardURLs].map(async (url) => {
      if (!optionalURLs.has(url)) return load(url);
      return optionalShard(load, url);
    }),
  );
  const shards = loadedShards.filter(Boolean);
  const equipment = new Map();
  for (const shard of shards) {
    if (shard.version !== 1 || !Array.isArray(shard.equipment)) throw Error('Invalid equipment shard');
    for (const row of shard.equipment) if (row.supported !== false) equipment.set(row.id, row);
  }
  const appearance=await resolveFittingRules(descriptor.materialRules,item.dna,load);
  return {version:2, equipment:[...equipment.values()], appearance,
    hullCategory:item.categoryID === 65 ? 65 : descriptor.hullCategory};
}
