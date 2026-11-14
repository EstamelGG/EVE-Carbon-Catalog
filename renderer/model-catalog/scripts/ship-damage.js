import {Group} from 'three';
import {createEffectResources} from './effect-resources.js';
import {installGateEffects} from './ship-gates.js';
import {createDamageToggle} from './damage-toggle.mjs';

// Keep damage out of the normal effect allocation and simulation path. It
// shares the established particle renderer and the ship's paused clock.
export function createShipDamage(viewer, scene, parent, data, getTime) {
  if (!data?.particles?.length && !data?.meshes?.length) return null;
  return createDamageToggle(async () => {
    const group = new Group(); group.name = 'EVE damage fire'; group.visible = false;
    const resources = createEffectResources(undefined, viewer.assetSession?.resolveURL, viewer.assetSession?.binaryURL);
    if (viewer.assetSession) resources.texture = viewer.assetSession.resources.texture;
    let effect;
    const dispose = () => { effect?.dispose(); group.removeFromParent(); resources.dispose(); };
    try {
      parent.add(group);
      effect = await installGateEffects(viewer, scene, group, data, resources, getTime, 'damageEffects');
      return {dispose, setVisible(value) { group.visible = value; scene.queueRender(); }};
    } catch (error) { dispose(); throw error; }
  }, state => {
    if (!state.ready || !state.visible)
      viewer.dataset.damageEffects = JSON.stringify({...state, emitters: data.particles.length, particles: 0});
    scene.queueRender();
  });
}
