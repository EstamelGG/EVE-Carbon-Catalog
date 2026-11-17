function typeID(item) {
  const id = Number(item.id);
  return Number.isFinite(id) ? id : Number.POSITIVE_INFINITY;
}

// Each published asset carries its own model, material and effect setup.
// Sharing only the GLB path would collapse visually distinct launchers.
export function uniqueEquipmentAssets(items) {
  const selected = new Map();
  items.forEach((item, index) => {
    const asset = typeof item.asset === 'string' ? item.asset.trim() : '',
      key = asset ? `asset:${asset}` : `item:${item.id ?? index}`,
      current = selected.get(key);
    if (!current || typeID(item) < typeID(current)) selected.set(key, item);
  });
  const visible = new Set(selected.values());
  return items.filter((item) => visible.has(item));
}
