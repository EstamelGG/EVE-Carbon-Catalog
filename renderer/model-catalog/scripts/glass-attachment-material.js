// Animated child lenses share the hull glass shader and receive authored curve values.
// Published Chimera Siren_01A material and verification: docs/source-remediation-82-evidence.json.
import { MeshStandardMaterial, SRGBColorSpace } from 'three';
import { configureGlass } from './glass-material.js';
import { configureNativeShader } from './native-shader.js';
import { nativeMaterialKey } from './native-material-key.js';
import { runtimeProfile, runtimeUniforms } from './runtime-material.js';

export async function glassAttachmentMaterial(record,resources,{viewer}={}) {
 const context=viewer?.nativeMaterialContext;
 if(!context)throw new Error('Child glass requires native hull lighting');
 const native={profile:runtimeProfile,effect:record.shader,textures:record.textures,parameters:record.parameters};
 const loaded=Object.fromEntries(await Promise.all(Object.entries(record.textures).map(async([role,ref])=>{
  let texture=await resources.texture(ref,{repeat:true});
  if(role==='AlbedoMap'){
   texture=resources.own(texture.clone());texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;
  }
  return [role,texture];
 })));
 const uniforms=runtimeUniforms(native,loaded,0);
 Object.assign(uniforms,context.displayUniforms);
 const material=resources.own(new MeshStandardMaterial({map:loaded.AlbedoMap,normalMap:loaded.NormalMap,
  metalness:0,roughness:1,envMapIntensity:0}));
 configureGlass(material);
 material.onBeforeCompile=shader=>{
  configureNativeShader(shader,{...context,native,loaded,dirtLevel:0,
   diffuseIntensity:context.reflection.source.shIntensity??context.reflection.settings.diffuseIntensity,
   onCutoutCompiled:()=>{}});
  Object.assign(shader.uniforms,uniforms);
 };
 material.customProgramCacheKey=()=>nativeMaterialKey(native);
 return {material,uniforms,update(parameters){
  for(const [name,suffix] of [['diffuse','DiffuseColor'],['fresnel','FresnelColor'],['dustColor','DustDiffuseColor']])
   for(let i=1;i<=4;i++)if(parameters[`Mtl${i}${suffix}`])uniforms[`eve_${name}`].value.set(parameters[`Mtl${i}${suffix}`].slice(0,3),3*(i-1));
  for(let i=1;i<=4;i++)if(parameters[`Mtl${i}Gloss`])uniforms.eve_gloss.value.setComponent(i-1,parameters[`Mtl${i}Gloss`][0]);
  if(parameters.GeneralGlowColor)uniforms.eve_glowColor.value.fromArray(parameters.GeneralGlowColor);
 }};
}
