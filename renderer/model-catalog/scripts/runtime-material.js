// Material-stage composition shared by live rendering and export baking.
// Preserve stage order: layer selection/overrides -> paint -> dust.
import {layerComposition} from './material-layer-composition.js';
import {paintComposition} from './material-paint-composition.js';
import {dustComposition} from './material-dust-composition.js';
export {runtimeUniforms} from './runtime-material-inputs.js';
export {runtimeDeclarations} from './material-layer-composition.js';
export const runtimeProfile = 'quad-runtime-v1';

export function runtimeComposition(sails, patterns = 0, detail = false, environment = false, roles = []) {
  return layerComposition(sails, patterns, detail, environment, roles) + paintComposition(patterns) + dustComposition;
}
