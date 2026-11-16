// Owner manifests reference only compatible equipment shards. No global fitting file.
export async function loadFittingData(item, load) {
  if (!item?.fitting) return {version:2, equipment:[]};
  const descriptor = await load(item.fitting);
  if (descriptor.version !== 3 || !Array.isArray(descriptor.equipmentShards))
    throw Error('Per-hull fitting metadata version 3 is required');
  const shards = await Promise.all(descriptor.equipmentShards.map(load));
  const equipment = new Map();
  for (const shard of shards) {
    if (shard.version !== 1 || !Array.isArray(shard.equipment)) throw Error('Invalid equipment shard');
    for (const row of shard.equipment) if (row.supported !== false) equipment.set(row.id, row);
  }
  return {version:2, equipment:[...equipment.values()], appearance:descriptor.appearance,
    hullCategory:descriptor.hullCategory};
}
