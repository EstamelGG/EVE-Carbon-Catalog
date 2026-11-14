import { Mesh, Vector3 } from 'three';
import { normalizeKillCount, killCountDigits } from '../src/kill-count.mjs';
import { createKillMarkMaterial } from './kill-mark-material.js';
import { installKillMarkLabels } from './kill-mark-labels.js';
import { beforeSceneRender } from './effect-resources.js';
import { decalBoneTransform, projectedDecalVertex } from './decal-projection.js';

export { decalBoneTransform as killMarkBoneTransform, projectedDecalVertex as killMarkVertex };

export async function installKillMarks(viewer, scene, root, records, resources, onCommit = callback => callback(), owner) {
  let canceled = false;
  let disposeLabels = () => {};
  let disposeBones = () => {};
  const attachments = [];
  const meshes = [];
  const marksPerRow = {value: new Vector3()};
  // Trinity forwards the ship's display count to each decal.
  // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/EveSpaceObjectDecal.cpp#L374
  const setCount = value => {
    const count = normalizeKillCount(value);
    viewer.killCount = count;
    marksPerRow.value.fromArray(killCountDigits(count));
    disposeLabels.changed?.(count);
    for (const mesh of meshes) mesh.visible = count > 0;
    scene.queueRender();
  };
  try {
    await Promise.all(records.map(async record => {
      const updateBone = decalBoneTransform(viewer, scene, root, record.parentBoneIndex, owner);
      const map = await resources.texture(record.textures.DecalTransparencyMap, {repeat:true});
      if (canceled) return;
      const material = resources.own(createKillMarkMaterial(record, map, marksPerRow));
      const mesh = new Mesh(resources.geometry(record.geometry), material);
      mesh.name = 'EVE kill marks';
      if (updateBone) {
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        attachments.push({mesh, updateBone});
      }
      root.add(mesh); meshes.push(mesh);
    }));

    if (attachments.length) disposeBones = beforeSceneRender(scene, () => {
      for (const {mesh, updateBone} of attachments) {
        updateBone(mesh.matrix);
        mesh.updateWorldMatrix(false, false);
      }
    });
    // An empty room decal set must preserve the docked ship's counter controls.
    if (!owner || meshes.length) onCommit(() => {
      viewer.killMarkCount = meshes.length;
      viewer.setKillCount = setCount;
      setCount(viewer.killCount);
      disposeLabels = installKillMarkLabels(viewer, scene, meshes);
    });
  } catch (error) {
    canceled = true;
    disposeBones();
    disposeLabels();
    if (viewer.setKillCount === setCount) {
      delete viewer.setKillCount;
      delete viewer.killMarkCount;
    }
    for (const mesh of meshes) mesh.removeFromParent();
    throw error;
  }
  return () => {
    disposeBones();
    disposeLabels();
    for (const mesh of meshes) mesh.removeFromParent();
    if (viewer.setKillCount === setCount) {
      delete viewer.setKillCount;
      delete viewer.killMarkCount;
    }
  };
}
