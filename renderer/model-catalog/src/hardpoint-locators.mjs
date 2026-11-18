const HARDPOINT_PATTERN = /^locator_(.+)_(\d+)([a-z]*)$/i;
const EQUIPMENT_LOCATOR_PATTERN = /^locator_(.+)_$/i;
const MODEL_SIZE_PATTERN = /(?:^|\/)(xl|s|m|l)\//i;
const LAUNCHER_PATH_PATTERN = /(?:^|\/)turret\/launcher\/([^/]+)\//i;
const SHIP_CLASS_PATTERN = /(?:^|\/)ship\/[^/]+\/([^/]+)\//i;
const TURRET_LOCATOR = 'locator_turret_';
const LAUNCHER_LOCATOR = 'locator_launcher_';
const XL_LOCATOR = 'locator_xl_';
const SIZES = new Set(['s', 'm', 'l', 'xl']);
const SIZE_RANK = { s: 1, m: 2, l: 3, xl: 4 };
const ATTACK_BATTLECRUISER_GROUP = 1201;
const LAUNCHER_FOLDER_SIZES = {
  bomb: 's',
  cruise: 'l',
  heavy: 'm',
  heavyassault: 'm',
  light: 's',
  rapidheavy: 'l',
  rapidlight: 'm',
  rocket: 's',
  torpedo: 'l',
};
const LAUNCHER_GROUP_SIZES = {
  506: 'l',
  507: 's',
  508: 'l',
  509: 's',
  510: 'm',
  511: 'm',
  771: 'm',
  862: 's',
  1245: 'l',
};
const HULL_CLASS_SIZES = {
  barge: 'm',
  battlecruiser: 'm',
  battleship: 'l',
  capsule: 's',
  capital: 'xl',
  carrier: 'xl',
  cruiser: 'm',
  destroyer: 's',
  dreadnought: 'xl',
  fighter: 's',
  forceauxillary: 'xl',
  freighter: 'xl',
  frigate: 's',
  industrial: 'm',
  shuttle: 's',
  strategiccruiser: 'm',
  titan: 'xl',
};

function prefixFor(family) {
  return family ? `locator_${family}_` : '';
}

function normalizeSize(value) {
  const size = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SIZES.has(size) ? size : '';
}

function familySize(family) {
  return normalizeSize(/(xl|[sml])$/i.exec(family || '')?.[1]);
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

export function equipmentSize(item = {}) {
  const declared = normalizeSize(item.size);
  if (declared) return declared;
  const locator = equipmentLocatorName(item);
  const locatorSize = familySize(parseEquipmentLocator(locator)?.family);
  if (locatorSize) return locatorSize;
  if (item.requirement === 'xl') return 'xl';
  const model = typeof item.model === 'string' ? item.model : '';
  const modelSize = normalizeSize(MODEL_SIZE_PATTERN.exec(model)?.[1]);
  if (modelSize) return modelSize;
  const launcher = LAUNCHER_PATH_PATTERN.exec(model)?.[1].toLowerCase();
  const launcherSize = normalizeSize(LAUNCHER_FOLDER_SIZES[launcher]);
  if (launcherSize) return launcherSize;
  return normalizeSize(LAUNCHER_GROUP_SIZES[item.groupID]);
}

export function hullSize(item = {}) {
  const declared = normalizeSize(item.size);
  if (declared) return declared;
  if (Number(item.groupID) === ATTACK_BATTLECRUISER_GROUP) return 'l';
  const model = typeof item.model === 'string' ? item.model : '';
  const shipClass = SHIP_CLASS_PATTERN.exec(model)?.[1].toLowerCase();
  return normalizeSize(HULL_CLASS_SIZES[shipClass]);
}

export function hardpointSlotSize(definition = {}, hull = {}) {
  const declared = normalizeSize(definition.size);
  if (declared) return declared;
  const families = new Set([
    ...Object.keys(definition.types || {}),
    definition.family,
  ]);
  let selected = '';
  for (const prefix of families) {
    const family = parseEquipmentLocator(prefix)?.family;
    const size = familySize(family);
    if (size && SIZE_RANK[size] > (SIZE_RANK[selected] || 0)) selected = size;
  }
  return selected || hullSize(hull);
}

export function equipmentLocatorCandidates(item = {}) {
  const prefix = equipmentLocatorName(item),
    parsed = parseEquipmentLocator(prefix);
  if (!parsed) return [];
  // XL weapons are the one size class with a distinct authored locator family.
  // Never let them fall back to an ordinary turret or launcher mount.
  if (equipmentSize(item) === 'xl') {
    return parsed.prefix === TURRET_LOCATOR || parsed.prefix === LAUNCHER_LOCATOR
      ? [XL_LOCATOR]
      : [parsed.prefix];
  }
  // Missile launchers and turrets share generic weapon mounts in EVE. Prefer
  // the authored family, then fall back to the other weapon family.
  if (parsed.prefix === LAUNCHER_LOCATOR) return [LAUNCHER_LOCATOR, TURRET_LOCATOR];
  if (parsed.prefix === TURRET_LOCATOR) return [TURRET_LOCATOR, LAUNCHER_LOCATOR];
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
  const prefixes = new Set(families.map(prefixFor));
  if (prefixes.has(TURRET_LOCATOR) || prefixes.has(LAUNCHER_LOCATOR)) {
    prefixes.add(TURRET_LOCATOR);
    prefixes.add(LAUNCHER_LOCATOR);
  }
  return [...prefixes];
}
