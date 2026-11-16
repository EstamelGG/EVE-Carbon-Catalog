// Owner manifests reference only compatible equipment shards. No global fitting file.
import {resolveFittingRules} from './fitting-rules.mjs';
export async function loadFittingData(item, load) {
  if (!item?.fitting) return {version:2, equipment:[]};
  const descriptor = await load(item.fitting);
  if (descriptor.version !== 3 || !Array.isArray(descriptor.equipmentShards))
    throw Error('Per-hull fitting metadata version 3 is required');
  if (!Object.hasOwn(descriptor,'materialRules'))throw Error('Missing fitting rules; rebuild fitting resources');
  const shards = await Promise.all(descriptor.equipmentShards.map(load));
  const equipment = new Map();
  for (const shard of shards) {
    if (shard.version !== 1 || !Array.isArray(shard.equipment)) throw Error('Invalid equipment shard');
    for (const row of shard.equipment) if (row.supported !== false) equipment.set(row.id, row);
  }
  const appearance=await resolveFittingRules(descriptor.materialRules,item.dna,load);
  return {version:2, equipment:[...equipment.values()], appearance,
    hullCategory:descriptor.hullCategory};
}
