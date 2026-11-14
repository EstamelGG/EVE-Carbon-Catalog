import {MeshStandardMaterial, DoubleSide, SRGBColorSpace} from 'three';
import {applyDecalLighting} from './decal-lighting.js';
import {authoredLocal} from './ship-authored-spotlights.js';

// The open Blender decal material binds albedo and F0 as color and roughness as data.
export async function createPaintDecal(record, resources, lightingUniforms) {
  const maps=Object.fromEntries(await Promise.all(Object.entries(record.textures).map(async([role,ref])=>{
    // The parent NormalMap tiles on the mesh UVs. Decal samplers use projected UVs.
    let texture=await resources.texture(ref, {repeat:role==='NormalMap'});
    if (role==='DecalAlbedoMap'||role==='DecalFresnelMap') {texture=resources.own(texture.clone());texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;}
    return [role,texture];
  })));
  const projection=authoredLocal({translation:record.position,rotation:record.rotation,scaling:record.scaling}).invert();
  const material=resources.own(new MeshStandardMaterial({map:maps.DecalAlbedoMap,alphaMap:maps.DecalTransparencyMap,
    normalMap:maps.NormalMap ?? null,roughnessMap:maps.DecalRoughnessMap,roughness:1,metalness:0,transparent:true,depthWrite:false,
    side:DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  material.onBeforeCompile=shader=>{
    shader.uniforms.decalProjection={value:projection}; shader.uniforms.decalF0={value:maps.DecalFresnelMap};
    shader.vertexShader='uniform mat4 decalProjection; varying vec2 decalUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n decalUV=(decalProjection*vec4(position,1.0)).yz*0.5+0.5;');
    shader.fragmentShader='uniform sampler2D decalF0; varying vec2 decalUV;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`if(any(lessThan(decalUV,vec2(0)))||any(greaterThan(decalUV,vec2(1))))discard;
      diffuseColor*=texture2D(map,decalUV);`)
      .replace('#include <alphamap_fragment>','diffuseColor.a*=texture2D(alphaMap,decalUV).r; if(diffuseColor.a<=0.0)discard;')
      .replace('#include <roughnessmap_fragment>','float roughnessFactor=texture2D(roughnessMap,decalUV).r;');
    if (maps.NormalMap) {
      shader.uniforms.eve_useParentNormal = lightingUniforms?.eve_useNormalMap ?? {value:1};
      shader.fragmentShader = 'uniform float eve_useParentNormal;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
        'if (eve_useParentNormal > 0.0) {\n#include <normal_fragment_maps>\n}');
    }
    applyDecalLighting(shader, lightingUniforms);
  };
  material.customProgramCacheKey=()=> 'eve-projected-decal-color-v2';
  return material;
}
