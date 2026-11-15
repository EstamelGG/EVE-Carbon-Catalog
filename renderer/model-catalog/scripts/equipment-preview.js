import {$scene} from '@google/model-viewer/lib/model-viewer-base.js';
import {Group, Mesh, LinearSRGBColorSpace, CubeReflectionMapping} from 'three';
import {createEffectResources, beforeSceneRender} from './effect-resources.js';
import {resolveEffectGeometry} from './effect-geometry.mjs';
import {effectGeometry} from './effect-glb.js';
import {equipmentBackground, equipmentFloorMaterial,installEquipmentFloorBlend,equipmentStarfield} from './equipment-scene.js';
import {pageAnimationLoop} from './page-activity.js';

export async function loadEquipmentPreview(viewer, url) {
  const packed = await viewer.assetSession.json(url);
  if (packed.equipment?.version !== 1) throw new Error('Missing equipment preview metadata');
  return resolveEffectGeometry(packed.equipment, path => viewer.assetSession.json(path),6,ref=>effectGeometry(viewer.assetSession,ref));
}

// The carrier is a sibling of the model: its huge floor never enters camera
// framing, dimension measurements, or model exports.
export async function installEquipmentPreview(viewer) {
  const scene = viewer[$scene], model = scene.model, data = viewer.equipmentPreview;
  const resources = createEffectResources(undefined, viewer.assetSession?.resolveURL, viewer.assetSession?.binaryURL);
  const floor = new Group();
  floor.name = 'Equipment preview floor'; floor.matrixAutoUpdate = false;
  const originalBackground = scene.background;
  let stop, starClock, background, stars, disposed = false;const floorBlends=[];
  const cleanup = () => {
    if (disposed) return;
    disposed = true; stop?.();starClock?.stop();floorBlends.forEach(dispose=>dispose()); floor.removeFromParent();background?.removeFromParent();stars?.removeFromParent();
    if (scene.background === null) scene.background = originalBackground;
    resources.dispose();
  };
  try {
    const cube = await resources.texture(data.scene.background);
    cube.isCubeTexture = true; cube.mapping = CubeReflectionMapping;
    cube.colorSpace = LinearSRGBColorSpace; cube.needsUpdate = true;
    background = equipmentBackground(cube, data.scene.backgroundParameters, data.scene.intensity ?? 1);
    resources.own(background.geometry);resources.own(background.material);
    const settings = data.scene.starfield;
    const maps = settings?.effect?.textures;
    const [atlas, palette] = maps?.DiffuseMap && maps.PaletteMap
      ? await Promise.all([resources.texture(maps.DiffuseMap, {repeat:true}), resources.texture(maps.PaletteMap, {repeat:true})])
      : [];
    stars = equipmentStarfield(settings, atlas, palette);
    resources.own(stars.geometry);resources.own(stars.material);
    for (const layer of data.floor) {
      const geometry = resources.geometry(layer.mesh);
      const {material,renderOrder} = await equipmentFloorMaterial(layer.material, resources);
      const mesh = new Mesh(geometry, material); mesh.name = layer.name;
      mesh.position.fromArray(layer.translation); mesh.quaternion.fromArray(layer.rotation); mesh.scale.fromArray(layer.scaling);
      mesh.frustumCulled = false; mesh.renderOrder = renderOrder;
      floorBlends.push(installEquipmentFloorBlend(mesh));
      floor.add(mesh);
    }
    if (!viewer.isConnected || scene.model !== model) {cleanup(); return cleanup;}
    scene.background = null;scene.add(background,stars);
    if (stars.visible) {
      starClock = pageAnimationLoop(now => {
        stars.material.uniforms.time.value = now / 1000;
        scene.queueRender();
      }, viewer.ownerDocument);
      starClock.start();
    }
    model.parent.add(floor);
    const update = () => {floor.matrix.copy(model.matrix); floor.updateMatrixWorld(true);};
    update(); stop = beforeSceneRender(scene, update);
    scene.queueRender();
    return cleanup;
  } catch (error) {cleanup(); throw error;}
}
