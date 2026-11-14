// Three r183 patch locations only; expression values are supplied by surface stages.
// Host chunk (MIT): https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/normal_fragment_maps.glsl.js
import {ShaderChunk} from 'three';
import {applyCutoutShader} from './material-cutout.js';

export function applySurfaceStages(shader, {
  projection, declarations, composition, roughness, emission, normal, output,
  clip, clipTexture, onCutoutCompiled,
}) {
  if (projection) {
    shader.vertexShader =
      projection.declarations +
      '\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + projection.body + '\n',
      );
  }
  shader.fragmentShader =
    declarations +
    shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    composition,
  );
  if (clip) {
    applyCutoutShader(shader, clip, clipTexture);
    onCutoutCompiled();
  }
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <roughnessmap_fragment>',
    roughness,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    emission,
  );
  if (output)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      output,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    ShaderChunk.normal_fragment_maps.replaceAll(
      'texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0',
      normal,
    ),
  );
}
