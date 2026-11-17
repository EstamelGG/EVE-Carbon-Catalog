function typeID(item) {
  const id = Number(item.id);
  return Number.isFinite(id) ? id : Number.POSITIVE_INFINITY;
}

function modelKey(item, index) {
  const model = typeof item.model === 'string' ? item.model.trim() : '',
    asset = typeof item.asset === 'string' ? item.asset.trim() : '';
  if (model) return `model:${model}`;
  if (asset) return `asset:${asset}`;
  return `item:${item.id ?? index}`;
}

// The same model picks up the hull's material and effect context at runtime.
// Keep the smallest TypeID for each model so equivalent variants stay hidden.
export function uniqueEquipmentModels(items) {
  const selected = new Map();
  items.forEach((item, index) => {
    const key = modelKey(item, index),
      current = selected.get(key);
    if (!current || typeID(item) < typeID(current)) selected.set(key, item);
  });
  const visible = new Set(selected.values());
  return items.filter((item) => visible.has(item));
}
