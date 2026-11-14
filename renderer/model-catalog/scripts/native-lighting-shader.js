// Stage order only. Each imported response retains its own source-review status.
import {lightingDeclarations} from './native-environment-light.js';
import {layerLighting} from './native-layer-lighting.js';
import {glassLighting} from './glass-material.js';
import {applyLightingStages} from './three-lighting-adapter.js';

export function configureLighting(shader, runtime, glass) {
  shader.fragmentShader = lightingDeclarations(runtime) + shader.fragmentShader;
  applyLightingStages(shader, glass ? glassLighting : layerLighting(runtime));
}
