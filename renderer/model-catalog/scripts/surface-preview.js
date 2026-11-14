import {applyCutoutShader} from './material-cutout.js';

// Switch the existing shared material, so fitted clones change with the hull.
// Maps remain loaded. The preview outputs grayscale albedo directly, without
// lights, native region composition, emission or reflections.
export function surfacePreview(material, native, loaded) {
  const original = {
    compile:material.onBeforeCompile, key:material.customProgramCacheKey,
    roughness:material.roughness, environment:material.envMapIntensity,
    emissive:material.emissive.clone(), emissiveMap:material.emissiveMap,
  };
  let active=false;
  const compile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\ndiffuseColor.rgb=vec3(dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722)));');
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',
      '#include <lights_physical_fragment>\nmaterial.specularColor=vec3(0.0); material.specularColorBlended=vec3(0.0); material.specularF90=0.0;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight=diffuseColor.rgb;\n#include <opaque_fragment>');
    // Keep the native silhouette when a hull uses a projected cutout mask.
    if(native.clip)applyCutoutShader(shader,native.clip,loaded.PaintMaskMap);
  };
  return enabled=>{
    if(active===enabled)return;
    active=enabled;
    material.onBeforeCompile=enabled?compile:original.compile;
    material.customProgramCacheKey=enabled?()=> 'eve-surface-preview-unlit-v2-'+JSON.stringify(native.clip||null):original.key;
    material.roughness=enabled?1:original.roughness;
    // No environment contribution in the unlit preview.
    material.envMapIntensity=enabled?0:original.environment;
    material.emissive.copy(original.emissive);
    if(enabled)material.emissive.setRGB(0,0,0);
    material.emissiveMap=enabled?null:original.emissiveMap;
    // Three caches per-material uniforms along with compiled programs. Drop
    // those programs when changing hooks, otherwise returning to the old key
    // can reuse the preview's uniform set. This does not dispose any textures.
    material.dispose();
    material.needsUpdate=true;
  };
}
