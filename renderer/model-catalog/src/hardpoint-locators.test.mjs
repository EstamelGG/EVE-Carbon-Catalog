import test from 'node:test';
import assert from 'node:assert/strict';
import {
  equipmentLocatorCandidates,
  equipmentPrefixesForMountFamilies,
  equipmentSize,
  hardpointSlotSize,
  hardpointFamilies,
  hullSize,
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

test('matches exact equipment families and cross-fits launchers and turrets', () => {
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
  assert.deepEqual(
    equipmentLocatorCandidates({ locatorName: 'locator_turret_' }),
    ['locator_turret_', 'locator_launcher_'],
  );
});

test('XL equipment only uses XL or its exact specialized locator', () => {
  assert.equal(
    equipmentSize({ locatorName: 'locator_turret_', model: '/turret/energy/beam/xl/a.glb' }),
    'xl',
  );
  assert.deepEqual(
    equipmentLocatorCandidates({
      locatorName: 'locator_turret_',
      model: '/turret/energy/beam/xl/a.glb',
    }),
    ['locator_xl_'],
  );
  assert.deepEqual(
    equipmentLocatorCandidates({ locatorName: 'locator_xl_' }),
    ['locator_xl_'],
  );
  assert.deepEqual(
    equipmentLocatorCandidates({
      locatorName: 'locator_atomic_',
      model: '/turret/atomic/xl/a.glb',
    }),
    ['locator_atomic_'],
  );
});

test('equipment size falls back from locator and model metadata to launcher class', () => {
  assert.equal(equipmentSize({ size: 'L' }), 'l');
  assert.equal(equipmentSize({ locatorName: 'locator_turretm_' }), 'm');
  assert.equal(equipmentSize({ locatorName: 'locator_xl_' }), 'xl');
  assert.equal(
    equipmentSize({
      locatorName: 'locator_launcher_',
      model: 'res/dx9/model/turret/launcher/cruise/cruise_t1.glb',
    }),
    'l',
  );
  assert.equal(
    equipmentSize({
      locatorName: 'locator_launcher_',
      model: 'res/dx9/model/turret/launcher/light/light_t1.glb',
    }),
    's',
  );
  assert.equal(equipmentSize({ groupID: 771 }), 'm');
  assert.equal(
    equipmentSize({ locatorName: 'locator_high_', model: 'res/model/utility.glb' }),
    '',
  );
});

test('slot size uses authored size suffixes before the hull class', () => {
  const frigate = {
    groupID: 834,
    model: 'res/dx9/model/ship/caldari/frigate/cf6/cf6_t2.glb',
  };
  assert.equal(hullSize(frigate), 's');
  assert.equal(
    hullSize({
      groupID: 1201,
      model: 'res/dx9/model/ship/caldari/battlecruiser/abc1/abc1_t1.glb',
    }),
    'l',
  );
  assert.equal(
    hardpointSlotSize({ family: 'locator_turret_', types: {} }, frigate),
    's',
  );
  assert.equal(
    hardpointSlotSize(
      {
        family: 'locator_turret_',
        types: { locator_turret_: [{}], locator_turretm_: [{}] },
      },
      frigate,
    ),
    'm',
  );
  assert.equal(
    hardpointSlotSize(
      {
        family: 'locator_turret_',
        types: { locator_turret_: [{}], locator_xl_: [{}] },
      },
      frigate,
    ),
    'xl',
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

test('turret and launcher families expose both shared weapon shards', () => {
  assert.deepEqual(equipmentPrefixesForMountFamilies(['turret']).sort(), [
    'locator_launcher_',
    'locator_turret_',
  ]);
  assert.deepEqual(equipmentPrefixesForMountFamilies(['custom_weapon']), [
    'locator_custom_weapon_',
  ]);
});
