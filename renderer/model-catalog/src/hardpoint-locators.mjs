const HARDPOINT_PATTERN = /^locator_(.+)_(\d+)([a-z]*)$/i;
const EQUIPMENT_LOCATOR_PATTERN = /^locator_(.+)_$/i;

// Equipment families are matched against physical hull locator families.
// Unknown families use an exact-only fallback, so new locator formats work
// without changing the parser. Add aliases here only when they are intentional.
export const EQUIPMENT_MOUNT_FAMILIES = Object.freeze({
  turret: ['turret'],
  launcher: ['launcher', 'turret'],
  chain: ['chain', 'turret'],
  atomic: ['atomic', 'turret'],
  turretm: ['turretm', 'turret'],
  bomb: ['bomb'],
  xl: ['xl'],
  doomsday: ['doomsday', 'xl'],
  moonharvester: ['moonharvester'],
  clonebay: ['clonebay'],
});

function prefixFor(family) {
  return family ? `locator_${family}_` : '';
}

export function parseHardpointLocator(name) {
  const match = HARDPOINT_PATTERN.exec(typeof name === 'string' ? name.trim() : '');
  if (!match) return null;
  const family = match[1].toLowerCase();
  return {
    family,
    prefix: prefixFor(family),
    slot: Number(match[2]),
    suffix: match[3].toLowerCase(),
  };
}

export function parseEquipmentLocator(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  const placed = parseHardpointLocator(value);
  if (placed) return placed;
  const match = EQUIPMENT_LOCATOR_PATTERN.exec(value);
  if (!match) return null;
  const family = match[1].toLowerCase();
  return { family, prefix: prefixFor(family), slot: null, suffix: '' };
}

export function equipmentLocatorName(item = {}) {
  return parseEquipmentLocator(item.locatorName)?.prefix || '';
}

export function equipmentLocatorCandidates(item = {}) {
  const prefix = equipmentLocatorName(item),
    parsed = parseEquipmentLocator(prefix);
  if (!parsed) return [];
  const families = EQUIPMENT_MOUNT_FAMILIES[parsed.family] || [parsed.family];
  return [...new Set(families.map(prefixFor))];
}

export function hardpointFamilies(locators = []) {
  const families = new Set();
  for (const locator of locators) {
    const parsed = parseHardpointLocator(
      typeof locator === 'string' ? locator : locator?.name,
    );
    if (parsed) families.add(parsed.family);
  }
  return [...families];
}

export function equipmentPrefixesForMountFamilies(families = []) {
  const mounts = new Set(families),
    prefixes = new Set([...mounts].map(prefixFor));
  for (const [equipmentFamily, compatibleMounts] of Object.entries(
    EQUIPMENT_MOUNT_FAMILIES,
  )) {
    if (compatibleMounts.some((family) => mounts.has(family)))
      prefixes.add(prefixFor(equipmentFamily));
  }
  return [...prefixes];
}
