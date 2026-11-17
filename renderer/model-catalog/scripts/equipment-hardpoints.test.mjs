import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone,BufferGeometry,Group,Matrix4,MeshBasicMaterial,Skeleton,SkinnedMesh,Vector3} from 'three';
import {
  bindHardpointBones,
  canFitEquipment,
  groupHardpoints,
  logicalHardpoints,
  planEquipmentPlacements,
  selectHardpoints,
} from './equipment-hardpoints.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shifted = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
const slots = groupHardpoints([
  { name: 'locator_turret_1a', transform: identity },
  { name: 'locator_launcher_1a', transform: shifted },
]);

test('launcher equipment can use turret mounts but chain equipment cannot', () => {
  const turretOnly = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  assert.equal(
    canFitEquipment(turretOnly, 1, { categoryID: 7, locatorName: 'locator_launcher_' }),
    true,
  );
  assert.equal(
    canFitEquipment(turretOnly, 1, { categoryID: 7, locatorName: 'locator_chain_' }),
    false,
  );
});

test('logical slots follow SDE capacity instead of locator group count', () => {
  const turrets = groupHardpoints(
    Array.from({length: 6}, (_, index) => ({
      name: `locator_turret_${index + 1}a`,
      transform: [...identity.slice(0, 12), index * 10, 0, 0, 1],
    })),
  );
  const slots = logicalHardpoints(
    turrets,
    Array.from({length: 5}, (_, index) => ({
      slot: index + 1,
      requirement: 'launcher',
      family: 'locator_turret_',
      nativeSlot: index + 1,
    })),
  );
  assert.equal(turrets.length, 6);
  assert.equal(slots.length, 5);
  assert.equal(slots.at(-1).nativeSlot, 5);
  assert.equal(
    canFitEquipment(slots, 1, {categoryID: 7, requirement: 'launcher', locatorName: 'locator_launcher_'}),
    true,
  );
  assert.equal(
    canFitEquipment(slots, 1, {categoryID: 7, requirement: 'turret', locatorName: 'locator_turret_'}),
    false,
  );
});

test('launcher equipment prefers an exact launcher mount', () => {
  const mounts = selectHardpoints(slots, 1, 'locator_launcher_');
  assert.deepEqual(mounts.map(({ name }) => name), ['locator_launcher_1a']);
});

test('duplicate locator suffixes expose one physical mount', () => {
  const caracalGroup = groupHardpoints([
    { name: 'locator_turret_5a', transform: identity },
    { name: 'locator_turret_5b', transform: shifted },
    { name: 'locator_turret_5c', transform: shifted },
  ]);
  assert.deepEqual(caracalGroup[0].mounts.map(({ name }) => name), [
    'locator_turret_5a',
    'locator_turret_5b',
  ]);
  assert.deepEqual(
    selectHardpoints(caracalGroup, 5, 'locator_turret_').map(({ name }) => name),
    ['locator_turret_5a', 'locator_turret_5b'],
  );
});

test('launcher equipment can be planned onto a turret-only slot', () => {
  const turretOnly = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  const equipment = [{ id: 1875, categoryID: 7, locatorName: 'locator_launcher_' }];
  const plan = planEquipmentPlacements(
    turretOnly,
    new Map([[1, 1875]]),
    equipment,
    6,
  );
  assert.deepEqual(plan.get(1).mounts.map(({ name }) => name), ['locator_turret_1a']);
});

test('unrelated equipment families stay incompatible', () => {
  assert.equal(
    canFitEquipment(slots, 1, {
      categoryID: 7,
      locatorName: 'locator_bomb_',
    }),
    false,
  );
});

test('new locator families match exactly without code changes', () => {
  const custom = groupHardpoints([
    { name: 'locator_custom_weapon_1a', transform: identity },
  ]);
  assert.equal(
    canFitEquipment(custom, 1, {
      categoryID: 7,
      locatorName: 'locator_custom_weapon_',
    }),
    true,
  );
});

test('atomic and doomsday equipment require their exact families', () => {
  const turret = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  const xl = groupHardpoints([
    { name: 'locator_xl_1a', transform: identity },
  ]);
  const atomic = groupHardpoints([
    { name: 'locator_atomic_1a', transform: identity },
  ]);
  const doomsday = groupHardpoints([
    { name: 'locator_doomsday_1a', transform: identity },
  ]);
  assert.equal(
    canFitEquipment(turret, 1, {
      categoryID: 7,
      locatorName: 'locator_atomic_',
    }),
    false,
  );
  assert.equal(
    canFitEquipment(xl, 1, {
      categoryID: 66,
      locatorName: 'locator_doomsday_',
    }, 65),
    false,
  );
  assert.equal(
    canFitEquipment(atomic, 1, {
      categoryID: 7,
      locatorName: 'locator_atomic_',
    }),
    true,
  );
  assert.equal(
    canFitEquipment(doomsday, 1, {
      categoryID: 66,
      locatorName: 'locator_doomsday_',
    }, 65),
    true,
  );
});

test('equipment mounts follow named hull bones without moving their bind pose', () => {
  const scene=new Group(),model=new Group(),effects=new Group();
  model.position.set(2,3,4);model.rotation.y=.3;scene.add(model);model.add(effects);
  const bone=new Bone();bone.name='locator_xl_2a';bone.position.set(1,2,3);model.add(bone);
  const mesh=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());
  mesh.position.set(-1,.5,2);model.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new Skeleton([bone],[bone.matrixWorld.clone().invert()]));
  const base=new Matrix4().makeRotationY(.7);base.setPosition(8,9,10);
  const holder=new Group();holder.matrix.copy(base);holder.matrixAutoUpdate=false;effects.add(holder);
  const document={nodes:[{name:'locator_xl_2a'}],extras:{ccpdec:{bonePalette:['locator_xl_2a']}}};
  const pose=bindHardpointBones(effects,model,document,[
    {holder,mount:{name:'locator_xl_2a'},base:base.clone()},
  ]);
  pose();
  const mounted=new Vector3().setFromMatrixPosition(holder.matrixWorld);
  const expected=effects.localToWorld(new Vector3().setFromMatrixPosition(base));
  assert.ok(mounted.distanceTo(expected)<1e-9);
  bone.position.x+=5;scene.updateMatrixWorld(true);pose();
  const origin=model.localToWorld(new Vector3()),displaced=model.localToWorld(new Vector3(5,0,0));
  const delta=new Vector3().setFromMatrixPosition(holder.matrixWorld).sub(mounted);
  assert.ok(delta.distanceTo(displaced.sub(origin))<1e-9);
});
