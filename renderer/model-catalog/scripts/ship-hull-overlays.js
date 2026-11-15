import { Vector2, Vector4, NormalBlending, NoBlending, GLSL3, ShaderMaterial } from 'three';
import { beforeSceneRender } from './effect-resources.js';
import {directionalVertex, uvEffectVertex, overlayFragment, distortionVertex, distortionFragment} from './overlay-shaders.js';
import {installSceneColorCapture} from './equipment-scene.js';

export {directionalVertex, uvEffectVertex, overlayFragment as directionalFragment};

/** Borrow hull geometry/skeleton; only the material and texture scope is owned. */
export async function installHullOverlays(viewer, scene, root, resources, getTime, materialRoot = scene.model, onCommit = callback => callback()) {
  const definitions = new Map(((viewer.appearanceDocument || viewer.originalGltfJson).materials || [])
    .map(material => [material.name, material.extras?.ccpdecNative?.overlays || []]));
  const sources = [];
  materialRoot.traverse(mesh => {
    if (mesh.isMesh && definitions.get(mesh.material?.name)?.length) sources.push(mesh);
  });
  const draws = [];
  let unsubscribe;
  const dispose = () => {
    unsubscribe?.();
    for (const {mesh,release} of draws) {release?.();mesh.removeFromParent();}
    draws.length = 0;
  };
  try {
    for (const source of sources) {
      for (const layer of definitions.get(source.material.name)) {
        const directional = layer.profile === 'fxdirectional-v1';
        const distortion = layer.profile === 'fx-distortion-v1';
        if (!directional && !distortion && layer.profile !== 'fx-uv-v1') throw new Error(`Unsupported hull overlay: ${layer.profile}`);
        if (directional && (!source.geometry.hasAttribute('_ccp_source_position') || !(layer.sourceRadius > 0)))
          throw new Error('Hull overlay lacks native projection coordinates or radius; rebuild the model');
        const uniforms = Object.fromEntries(Object.entries(layer.parameters)
          .filter(([,value]) => Array.isArray(value) && value.length === 4)
          .map(([name,value]) => [name,{value:new Vector4(...value)}]));
        const roles=distortion?['DistortionMap','Layer2Map']:['Layer1Map','Layer2Map','LayerMaskMap'];
        await Promise.all(roles.map(async role => {
          const url = new URL(layer.textures[role], new URL(viewer.appearanceURL || viewer.src, location.href)).href;
          uniforms[role] = {value:await resources.texture({url},{repeat:true})};
        }));
        uniforms.time = {value:0};
        uniforms.sourceRadius = {value:layer.sourceRadius};
        let material;
        if(distortion){
          uniforms.carrierFrame={value:null};
          uniforms.carrierSize={value:new Vector2()};
          material=resources.own(new ShaderMaterial({glslVersion:GLSL3,vertexShader:distortionVertex,
            fragmentShader:distortionFragment,uniforms,transparent:true,depthWrite:false,blending:NoBlending}));
        }else material=resources.additiveMaterial(directional ? directionalVertex : uvEffectVertex,overlayFragment,uniforms);
        if (layer.blend === 'alpha') material.blending = NormalBlending;
        else if (layer.blend && layer.blend !== 'additive') throw new Error(`Unsupported hull blend: ${layer.blend}`);
        material.name = distortion?'EVE hull refraction':'EVE directional hull overlay';
        const mesh = source.clone(false);
        mesh.name = material.name;
        mesh.material = material;
        mesh.morphTargetInfluences = source.morphTargetInfluences;
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.visible = false;
        onCommit(() => source.parent.add(mesh));
        if(distortion)mesh.renderOrder=source.renderOrder+2;
        draws.push({source,mesh,material,release:distortion?installSceneColorCapture(mesh):null});
      }
    }
    if (draws.length) unsubscribe = beforeSceneRender(scene, () => {
      for (const {source,mesh,material} of draws) {
        mesh.visible = root.visible && source.visible;
        if (!mesh.visible) continue;
        mesh.matrix.copy(source.matrix);
        mesh.matrixWorld.copy(source.matrixWorld);
        // Skinning updates the source inverse bind matrix as it moves.
        if (source.isSkinnedMesh) mesh.bindMatrixInverse.copy(source.bindMatrixInverse);
        material.uniforms.time.value = getTime();
      }
    });
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
