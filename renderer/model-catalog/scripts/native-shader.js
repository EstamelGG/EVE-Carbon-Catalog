// Shader orchestration only. Surface and lighting stages retain legacy math;
// see their SOURCE REVIEW PENDING annotations before treating them as audited.
import {runtimeProfile} from './runtime-material.js';
import {isGlassMaterial} from './glass-material.js';
import {configureSurface} from './native-surface-shader.js';
import {configureLighting} from './native-lighting-shader.js';

// Shader construction owns no resources. Live controls and texture uniforms are
// supplied by the installation scope, including subsystem replacement scopes.
export function configureNativeShader(
  shader,
  {
    controls,
    roomLights,
    reflection,
    sh,
    shWorld,
    diffuseIntensity,
    native,
    loaded,
    dirtLevel,
    displayUniforms,
    onCutoutCompiled,
  },
) {
  const runtime = native.profile === runtimeProfile;
  const glass = runtime && isGlassMaterial(native);

  shader.uniforms.eve_reflectionStrength = controls.reflection;
  Object.assign(shader.uniforms, reflection.uniforms, roomLights);
  shader.uniforms.eve_sh = sh;
  shader.uniforms.eve_shWorld = shWorld;
  shader.uniforms.eve_shFill = controls.fill;
  shader.uniforms.eve_ambientStrength = { value: diffuseIntensity };
  shader.uniforms.eve_environmentStrength = reflection.uniforms.eve_environmentStrength || { value: reflection.source.intensity };
  shader.uniforms.eve_f0Strength = controls.f0;
  shader.uniforms.eve_roughnessScale = controls.roughness;
  configureSurface(shader, { native, loaded, dirtLevel, displayUniforms, onCutoutCompiled });
  if(runtime)shader.uniforms.eve_dirtStrength=controls.dirt||{value:1};
  configureLighting(shader, runtime, glass);
}
