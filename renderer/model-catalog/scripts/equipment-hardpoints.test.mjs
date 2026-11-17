import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone,BufferGeometry,Group,Matrix4,MeshBasicMaterial,Skeleton,SkinnedMesh,Vector3} from 'three';
import {
  bindHardpointBones,
  canFitEquipment,
  groupHardpoints,
  planEquipmentPlacements,
  selectHardpoints,
} from './equipment-hardpoints.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shifted = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
const slots = groupHardpoints([
  { name: 'locator_turret_1a', transform: identity },
  { name: 'locator_launcher_1a', transform: shifted },
]);

test('launcher and chain equipment cannot use turret-only hull mounts', () => {
  const turretOnly = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  for (const locatorName of ['locator_launcher_', 'locator_chain_']) {
    assert.equal(
      canFitEquipment(turretOnly, 1, { categoryID: 7, locatorName }),
      false,
    );
  }
});

test('an exact launcher equipment only uses an exact launcher mount', () => {
  const mounts = selectHardpoints(slots, 1, 'locator_launcher_');
  assert.deepEqual(mounts.map(({ name }) => name), ['locator_launcher_1a']);
});

test('launcher equipment cannot be planned onto a turret-only slot', () => {
  const turretOnly = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  const equipment = [{ id: 1875, categoryID: 7, locatorName: 'locator_launcher_' }];
  assert.throws(
    () =>
      planEquipmentPlacements(
        turretOnly,
        new Map([[1, 1875]]),
        equipment,
        6,
      ),
    /No free compatible equipment mounts/,
  );
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
