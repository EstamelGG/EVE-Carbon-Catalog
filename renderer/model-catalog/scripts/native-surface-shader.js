// Surface-stage orchestration: inputs -> projection/composition -> cutout ->
// roughness/emission -> glass output -> normal. Preserve the legacy order.
import {runtimeProfile, runtimeUniforms, runtimeDeclarations, runtimeComposition} from './runtime-material.js';
import {hasDetail} from './detail-material.js';
import {hasEnvironment} from './environment-material.js';
import {patternRoles, patternVertex} from './projected-patterns.js';
import {isGlassMaterial, glassComposition, glassOutput} from './glass-material.js';
import {normalExpression} from './material-normal.js';
import {roughnessExpression, glowResponseGLSL, emissionExpression} from './native-surface-response.js';
import {applySurfaceStages} from './three-surface-adapter.js';

export function configureSurface(shader, {native, loaded, dirtLevel, displayUniforms, onCutoutCompiled}) {
  const runtime = native.profile === runtimeProfile;
  const glass = runtime && isGlassMaterial(native);
  const sails = runtime && !!native.textures.SailsDetailMap;
  const roles = runtime ? patternRoles(native) : [];
  const patterns = roles.length;
  if (runtime) {
    Object.assign(shader.uniforms, runtimeUniforms(native, loaded, dirtLevel));
    Object.assign(shader.uniforms, displayUniforms);
    applySurfaceStages(shader, {
      projection: patterns ? patternVertex(patterns) : null,
      declarations: runtimeDeclarations(sails, patterns, hasDetail(native), hasEnvironment(native), roles) + glowResponseGLSL(glass),
      composition: runtimeComposition(sails, patterns, hasDetail(native), hasEnvironment(native), roles) + (glass ? glassComposition : ''),
      roughness: roughnessExpression,
      emission: emissionExpression,
      normal: normalExpression(native),
      output: glass ? glassOutput : null,
      clip: native.clip,
      clipTexture: loaded.PaintMaskMap,
      onCutoutCompiled,
    });
  } else {
    for (const role of ['f0', 'dust_base', 'dust_surface'])
      shader.uniforms['eve_' + role] = {value: loaded[role]};
  }
}
