import { Group } from 'three';
import { beforeSceneRender } from './effect-resources.js';
import { createPlaneBatches, groupPlaneSets } from './plane-batch.js';
import { planeFragment, hologramFragment } from './plane-material.js';
import { concurrentMap } from './concurrent-map.js';
import { bindAttachmentBones } from './source-bones.js';

export { planeFragment, hologramFragment } from './plane-material.js';

export async function installPlanes(viewer, scene, root, data, resources, getTime, bindVideos, owner) {
  if (!data) return () => {};
  if (data.version !== 1) throw new Error(`Unsupported plane effects: ${data.version}`);

  const prepared = await concurrentMap(groupPlaneSets(data.sets), async set => {
    const roles = ['Layer1Map', 'Layer2Map', 'MaskMap'];
    if (set.hologram) roles.push('ImageMap');
    const textures = await Promise.all(roles.map(async role =>
      [role, await resources.texture(set.textures[role], { repeat: role !== 'ImageMap' })]));
    return { set, textures: Object.fromEntries(textures) };
  });

  // Trinity applies the item transform first, then the available bone, then
  // the parent. A missing bone leaves the authored transform in parent space.
  // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EvePlaneSet.cpp#L188-L211
  const container = new Group(), joints = new Map(), clocks = new Set();
  for (const { set, textures } of prepared) {
    let parent = container;
    if (set.boneIndex >= 0) {
      if (!joints.has(set.boneIndex)) {
        const joint = new Group();
        joint.matrixAutoUpdate = false;
        container.add(joint);
        joints.set(set.boneIndex, joint);
      }
      parent = joints.get(set.boneIndex);
    }
    const fragment = set.hologram ? hologramFragment : planeFragment;
    for (const batch of createPlaneBatches(set, textures, resources, fragment)) {
      parent.add(batch);
      clocks.add(batch.material.uniforms.time);
    }
  }

  root.add(container);
  const updatePose = bindAttachmentBones(root, owner?.model ?? scene.model, owner?.document ?? viewer.originalGltfJson, joints);
  const unsubscribe = beforeSceneRender(scene, () => {
    if (!root.visible) return;
    const time = getTime();
    for (const clock of clocks) clock.value = time;
    updatePose?.((joint, matrix) => {
      joint.matrix.copy(matrix);
      joint.updateMatrixWorld(true);
    });
  });
  const stopVideos=bindVideos?.(prepared.filter(({textures})=>textures.ImageMap?.isVideoTexture)
    .map(({set,textures})=>({channel:set.textures.ImageMap.channel,video:textures.ImageMap.image})));
  return () => {
    stopVideos?.();
    unsubscribe();
    container.removeFromParent();
  };
}
