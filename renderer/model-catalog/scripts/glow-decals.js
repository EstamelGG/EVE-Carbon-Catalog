import { Matrix3, Mesh, Vector3 } from 'three';
import { beforeSceneRender } from './effect-resources.js';
import { decalBoneTransform, inverseDecalProjection, projectedDecalVertex } from './decal-projection.js';
import { glowDecalFragment, setGlowUV } from './glow-decal-material.js';

export { glowDecalFragment };

export async function installGlowDecals(viewer, scene, root, records, resources, getTime, owner) {
  const meshes = [], animations = [], bones = [];
  let unsubscribe;
  const dispose = () => {
    unsubscribe?.();
    for (const mesh of meshes) mesh.removeFromParent();
  };
  try {
    for (const record of records) {
      const updateBone = decalBoneTransform(viewer, scene, root, record.parentBoneIndex, owner);
      const { DecalTextureScaling: rates, DecalTextureOffset: offsets,
        DecalGlowColor: color, DecalIntensityData: intensity } = record.parameters;
      const [mask, pattern] = await Promise.all([
        resources.texture(record.textures.DecalTransparencyMap),
        resources.texture(record.textures.DecalGlowMap, {repeat:true}),
      ]);
      const matrix = setGlowUV(new Matrix3(), rates, offsets, 0);
      const material = resources.additiveMaterial(projectedDecalVertex, glowDecalFragment, {
        decalProjection: {value:inverseDecalProjection(record)},
        transparencyMap: {value:mask}, glowMap: {value:pattern}, glowUV: {value:matrix},
        emissionColor: {value:new Vector3().fromArray(color)}, intensity: {value:intensity[0]},
      });
      material.polygonOffset = true;
      material.polygonOffsetFactor = material.polygonOffsetUnits = -1;
      const mesh = new Mesh(resources.geometry(record.geometry), material);
      mesh.name = 'EVE animated glow decal';
      if (updateBone) {
        mesh.matrixAutoUpdate = mesh.frustumCulled = false;
        bones.push({mesh, updateBone});
      }
      if (rates[0] || rates[1] || rates[2]) animations.push({matrix, rates, offsets});
      root.add(mesh);
      meshes.push(mesh);
    }
    if (animations.length || bones.length) unsubscribe = beforeSceneRender(scene, () => {
      const time = getTime();
      for (const {matrix, rates, offsets} of animations) setGlowUV(matrix, rates, offsets, time);
      for (const {mesh, updateBone} of bones) {
        updateBone(mesh.matrix);
        mesh.updateWorldMatrix(false, false);
      }
    });
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
