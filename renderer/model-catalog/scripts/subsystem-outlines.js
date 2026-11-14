import {createMaterialPass} from './material-pass.js';
import {Color, MeshBasicMaterial, NearestFilter, Uniform, Vector2, WebGLRenderTarget} from 'three';
import {BlendFunction, Effect, EffectPass} from 'postprocessing';

export const subsystemColors = ['#79d9f2', '#edc573', '#ba9bf3', '#87d4a4'];

// A single depth-tested ID buffer distinguishes all four parts, including their
// shared boundaries. Nothing is added to the model or its exported geometry.
export function createSubsystemMask(scene, entries) {
  const slots = new Map(), materials = new Map();
  for (const {root, slot} of entries) root.traverse(object => {
    for (let node = object; node && node !== root; node = node.parent) if (node.userData.eveEffects) return;
    if (object.isMesh) slots.set(object, slot);
  });
  const target = new WebGLRenderTarget(1, 1, {minFilter:NearestFilter, magFilter:NearestFilter});
  target.texture.name = 'Subsystem IDs';
  const replacement = (source, slot) => {
    if (!materials.has(source)) materials.set(source, new Map());
    const variants = materials.get(source);
    if (!variants.has(slot)) {
      const material = new MeshBasicMaterial({
        color:new Color().setRGB((slot+1)/4, 0, 0), side:source.side,
        depthTest:source.depthTest, depthWrite:source.depthWrite,
        visible:source.visible && source.depthWrite, toneMapped:false, fog:false,
        alphaTest:source.alphaTest, alphaMap:source.alphaMap ?? null,
        map:source.alphaTest > 0 ? (source.map ?? null) : null,
        opacity:source.opacity,
      });
      // Retain texture alpha cutouts without allowing their RGB to change IDs.
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
          `#include <opaque_fragment>\ngl_FragColor.rgb = vec3(${((slot+1)/4).toFixed(2)}, 0.0, 0.0);`);
      };
      material.customProgramCacheKey = () => `subsystem-mask-${slot}`;
      variants.set(slot, material);
    }
    return variants.get(slot);
  };
  return {
    render:createMaterialPass(scene, target, (material, object) => replacement(material, slots.get(object) ?? -1)),
    dispose() {
      for (const variants of materials.values()) for (const material of variants.values()) material.dispose();
      materials.clear(); slots.clear(); target.dispose();
    },
  };
}

const fragment = `
uniform sampler2D subsystemMask;
uniform vec2 subsystemTexel;
uniform vec3 subsystemPalette[4];
uniform float subsystemFocus;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float center = floor(texture2D(subsystemMask, uv).r * 4.0 + 0.5);
  float edge = 0.0;
  // Draw inward, so a hidden part cannot paint over an occluding surface.
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    float neighbor = floor(texture2D(subsystemMask, uv + vec2(float(x), float(y)) * subsystemTexel).r * 4.0 + 0.5);
    edge = max(edge, step(0.5, abs(neighbor-center)));
  }
  vec3 color = inputColor.rgb;
  for (int i = 0; i < 4; i++) if (abs(center-float(i+1)) < 0.5 && (subsystemFocus < 0.0 || abs(subsystemFocus-float(i)) < 0.5)) color = mix(color, subsystemPalette[i], edge);
  outputColor = vec4(color, inputColor.a);
}`;

export function installSubsystemOutlines(scene, entries, composer) {
  if (!composer) return {setOpacity() {}, setFocus() {}, dispose() {}};
  const mask = createSubsystemMask(scene, entries);
  const effect = new Effect('SubsystemOutline', fragment, {blendFunction:BlendFunction.NORMAL, uniforms:new Map([
    ['subsystemMask', new Uniform(null)], ['subsystemTexel', new Uniform(new Vector2())],
    ['subsystemPalette', new Uniform(subsystemColors.map(c => new Color(c)))],
    ['subsystemFocus', new Uniform(-1)],
  ])});
  effect.update = (renderer, input) => {
    const target = mask.render(renderer, scene.getCamera(), input.width, input.height);
    effect.uniforms.get('subsystemMask').value = target.texture;
    // Keep the stroke about 1.5 CSS pixels as rendering resolution changes.
    const scale = input.width / (scene.width || input.width);
    effect.uniforms.get('subsystemTexel').value.set(1.5*scale/input.width, 1.5*scale/input.height);
  };
  const pass = new EffectPass(scene.getCamera(), effect);
  pass.enabled = false;
  composer.addPass(pass, false, false);
  return {
    setFocus(slot) { effect.uniforms.get('subsystemFocus').value = slot ?? -1; scene.queueRender(); },
    setOpacity(value) {
      pass.enabled = value > 0;
      effect.blendMode.opacity.value = value;
      scene.queueRender();
    },
    dispose() { composer.removePass(pass); mask.dispose(); },
  };
}
