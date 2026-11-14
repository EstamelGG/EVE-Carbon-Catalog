import {customEmissionOccluder,refreshCustomOccluder} from './custom-emission-occluder.js';
import {createMaterialPass} from './material-pass.js';
import { HalfFloatType, LinearFilter, WebGLRenderTarget } from 'three';
import {sceneBuffers} from './scene-buffers.js';
import {createEmissionComposite} from './emission-composite.js';

// Render a separate HDR emission source. Selecting whole glowing meshes would
// also bloom their white paint and specular reflections. Keep the original
// alpha/cutout/skinning shaders and depth so hidden lights remain occluded.
export function createEmissionSource(scene) {
  const target = new WebGLRenderTarget(1, 1, {type:HalfFloatType, minFilter:LinearFilter, magFilter:LinearFilter});
  target.texture.name = 'EVE emission bloom source';
  const materials = new Map();
  function replacement(source) {
    if (!source.visible || source.userData.eveBloomEmission) return source;
    const key=source.customProgramCacheKey();
    const cached=materials.get(source);
    if(cached?.key===key && cached.compile===source.onBeforeCompile && (cached.version===source.version || source.isMeshStandardMaterial)){
      // Three increments version twice for each two-sided transparent draw.
      // Keep the material and its compiled programs when refreshing source state.
      if(cached.version!==source.version){
        cached.material.copy(source);
        cached.material.toneMapped=false;
        cached.material.fog=false;
        cached.material.needsUpdate=true;
        cached.version=source.version;
      }
      if(source.isShaderMaterial)refreshCustomOccluder(source,cached.material);
      else cached.material.opacity=source.opacity;
      if(source.isMeshStandardMaterial){
        cached.material.emissive.copy(source.emissive);
        cached.material.emissiveIntensity=source.emissiveIntensity;
      }
      return cached.material;
    }
    cached?.release();
    const standard = source.isMeshStandardMaterial;
    let material;
    if (source.isShaderMaterial || source.isRawShaderMaterial) {
      material=customEmissionOccluder(source);
    } else {
      material = source.clone();
      const compile = source.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>',
          `gl_FragColor.rgb=${standard ? 'totalEmissiveRadiance' : 'vec3(0.0)'};\n#include <tonemapping_fragment>`);
      };
      material.customProgramCacheKey = () => key + ':emission-source-v1';
    }
    material.toneMapped = false;
    material.fog = false;
    const release = () => {
      source.removeEventListener('dispose', release);
      materials.delete(source);
      material.dispose();
    };
    source.addEventListener('dispose', release);
    materials.set(source, {material, release, key, compile:source.onBeforeCompile, version:source.version});
    return material;
  }
  const legacy=createMaterialPass(scene,target,replacement),composite=createEmissionComposite(scene,target,replacement);
  return {
    render(renderer,camera,width,height){
      const buffers=sceneBuffers(scene,renderer,camera,width,height);
      return buffers?composite.render(renderer,camera,buffers):legacy(renderer,camera,width,height);
    },
    dispose() {
      for (const {release} of [...materials.values()]) release();
      composite.dispose();
      target.dispose();
    },
  };
}

export function installEmissionBloom(scene, bloom) {
  const source = createEmissionSource(scene), effect = bloom.effects[0], update = effect.update;
  effect.update = function(renderer, input, delta) {
    const emission = source.render(renderer, scene.getCamera(), input.width, input.height);
    update.call(this, renderer, emission, delta);
  };
  return () => {
    effect.update = update;
    source.dispose();
  };
}
