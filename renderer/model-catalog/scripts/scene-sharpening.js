/*!
Copyright (c) 2017-2019 Advanced Micro Devices, Inc. All rights reserved.
-------
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:
-------
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.
-------
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Full-resolution, no-scaling GLSL port of the fast green-weight CAS path.
// https://github.com/GPUOpen-Effects/FidelityFX-CAS/blob/9fabcc9a2c45f958aff55ddfda337e74ef894b7f/ffx-cas/ffx_cas.h
// Trinity f6f5ff8, Tr2PostProcessRenderer::RenderSharpening, after tone mapping.
import {Uniform} from 'three';
import {BlendFunction, Effect, EffectAttribute} from 'postprocessing';
import {MVEffectBase} from '@google/model-viewer-effects/lib/effects/mixins/effect-base.js';

const fragment = `
uniform float sharpness;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 center = inputColor.rgb;
  vec3 left = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
  vec3 right = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
  vec3 top = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
  vec3 bottom = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
  float low = min(center.g, min(min(left.g, right.g), min(top.g, bottom.g)));
  float high = max(center.g, max(max(left.g, right.g), max(top.g, bottom.g)));
  float amplitude = clamp(min(low, 1.0 - high) / max(high, 1e-6), 0.0, 1.0);
  float weight = -sqrt(amplitude) / mix(8.0, 5.0, sharpness);
  vec3 result = (center + weight * (left + right + top + bottom)) / (1.0 + 4.0 * weight);
  outputColor = vec4(clamp(result, 0.0, 1.0), inputColor.a);
}`;

class EveSceneSharpening extends MVEffectBase {
  constructor() {
    super();
    this.effects = [new Effect('SceneCAS', fragment, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['sharpness', new Uniform(0.5)]]),
    })];
  }

  setStrength(value) {
    this.effects[0].uniforms.get('sharpness').value = Math.max(0, Math.min(1, value));
    this.setAttribute('blend-mode', value > 0 ? 'default' : 'skip');
  }
}

customElements.define('eve-scene-sharpening', EveSceneSharpening);
