import {$scene} from '@google/model-viewer/lib/model-viewer-base.js';
import {decompress} from 'three/addons/utils/WebGLTextureUtils.js';
import {exportGLB, exportOBJ} from './model-export-core.js';
import {createMaterialBaker} from './export-material-bake.js';

export async function exportModel(viewer, format) {
  const scene = viewer[$scene], model = viewer.hangar?.exportRoot || scene?.model;
  if (!model) throw new Error('Model is not ready');
  if (format === 'obj') return {blob:new Blob([exportOBJ(model)], {type:'text/plain;charset=utf-8'}), skipped:0};
  if (format !== 'glb') throw new Error('Unknown export format');
  const lights = [];
  scene.traverse(object => { if (object.isLight) lights.push(object); });
  let baker;
  try {
    const result = await exportGLB(model, {
      animations:scene.animations,
      materialFor:(material, mesh) => {
        const fallback = viewer.exportMaterials?.get(material) || material;
        const recipe = viewer.exportRecipes?.get(material);
        if (!recipe) return fallback;
        baker ||= createMaterialBaker();
        return baker.material(mesh, material, fallback, recipe);
      },
      lights, textureUtils:{decompress},
    });
    return {blob:new Blob([result.data], {type:'model/gltf-binary'}), skipped:result.skipped};
  } finally { baker?.dispose(); }
}
