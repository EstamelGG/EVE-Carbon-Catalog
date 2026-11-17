const HARDPOINT_PATTERN = /^locator_(.+)_(\d+)([a-z]*)$/i;
const EQUIPMENT_LOCATOR_PATTERN = /^locator_(.+)_$/i;
const TURRET_LOCATOR = 'locator_turret_';
const LAUNCHER_LOCATOR = 'locator_launcher_';

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
  // Missile launchers use generic weapon locators on hulls such as Caracal.
  // Prefer an authored launcher mount, then fall back to a turret mount.
  if (parsed.prefix === LAUNCHER_LOCATOR) return [LAUNCHER_LOCATOR, TURRET_LOCATOR];
  return [parsed.prefix];
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
  return [...new Set(families.map(prefixFor))];
}
