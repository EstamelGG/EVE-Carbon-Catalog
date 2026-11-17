import test from 'node:test';
import assert from 'node:assert/strict';
import {
  equipmentLocatorCandidates,
  equipmentPrefixesForMountFamilies,
  hardpointFamilies,
  parseEquipmentLocator,
  parseHardpointLocator,
} from './hardpoint-locators.mjs';

test('parses arbitrary hardpoint families without a prefix whitelist', () => {
  assert.deepEqual(parseHardpointLocator('locator_point_defense_12b'), {
    family: 'point_defense',
    prefix: 'locator_point_defense_',
    slot: 12,
    suffix: 'b',
  });
  assert.equal(parseHardpointLocator('locator_turret_'), null);
});

test('normalizes authored equipment locators with or without a slot suffix', () => {
  assert.equal(parseEquipmentLocator('locator_atomic_').family, 'atomic');
  assert.equal(
    parseEquipmentLocator('locator_custom_weapon_3a').prefix,
    'locator_custom_weapon_',
  );
});

test('matches the exact equipment family and falls launchers back to turrets', () => {
  assert.deepEqual(
    equipmentLocatorCandidates({ locatorName: 'locator_atomic_1a' }),
    ['locator_atomic_'],
  );
  assert.deepEqual(
    equipmentLocatorCandidates({ locatorName: 'locator_custom_weapon_' }),
    ['locator_custom_weapon_'],
  );
  assert.deepEqual(
    equipmentLocatorCandidates({ locatorName: 'locator_launcher_' }),
    ['locator_launcher_', 'locator_turret_'],
  );
});

test('derives all equipment shards needed by the current hull families', () => {
  const families = hardpointFamilies([
    { name: 'locator_turret_1a' },
    { name: 'locator_launcher_1a' },
    { name: 'locator_custom_weapon_1a' },
  ]);
  assert.deepEqual(families, ['turret', 'launcher', 'custom_weapon']);
  const prefixes = equipmentPrefixesForMountFamilies(families);
  assert.ok(prefixes.includes('locator_turret_'));
  assert.ok(prefixes.includes('locator_launcher_'));
  assert.ok(prefixes.includes('locator_custom_weapon_'));
  assert.ok(!prefixes.includes('locator_chain_'));
  assert.ok(!prefixes.includes('locator_atomic_'));
  assert.ok(!prefixes.includes('locator_bomb_'));
});

test('turret-mounted hulls request launcher equipment shards', () => {
  assert.deepEqual(equipmentPrefixesForMountFamilies(['turret']), [
    'locator_turret_',
    'locator_launcher_',
  ]);
});
