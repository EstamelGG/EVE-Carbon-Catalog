import {renderPreparedScene} from './prepared-scene.js';
import { Color, NoToneMapping, Vector4 } from 'three';

// Emission and ID masks share render-state isolation, but keep their own
// material selection, caches, render targets and disposal policies.
export function createMaterialPass(scene, target, replacement) {
  const clear = new Color(),
    viewport = new Vector4(),
    scissor = new Vector4();
  return (renderer, camera, width, height) => {
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    const swaps = [],
      background = scene.background,
      override = scene.overrideMaterial,
      hook = scene.onBeforeRender;
    const previousTarget = renderer.getRenderTarget(),
      autoClear = renderer.autoClear,
      toneMapping = renderer.toneMapping;
    const alpha = renderer.getClearAlpha(),
      scissorTest = renderer.getScissorTest();
    renderer.getClearColor(clear);
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    try {
      scene.traverse((object) => {
        if (
          !object.material ||
          !(object.isMesh || object.isPoints || object.isLine || object.isSprite)
        )
          return;
        swaps.push([object, object.material]);
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => replacement(material, object))
          : replacement(object.material, object);
      });
      scene.background = null;
      scene.overrideMaterial = null;
      // The main pass already advanced camera-follow lights, bones and effects.
      scene.onBeforeRender = () => {};
      renderer.autoClear = true;
      renderer.toneMapping = NoToneMapping;
      renderer.setClearColor(0, 0);
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderPreparedScene(renderer, scene, camera);
      return target;
    } finally {
      for (const [object, material] of swaps) object.material = material;
      scene.background = background;
      scene.overrideMaterial = override;
      scene.onBeforeRender = hook;
      renderer.autoClear = autoClear;
      renderer.toneMapping = toneMapping;
      renderer.setClearColor(clear, alpha);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      // Bind last: a postprocessing target has its own pixel-sized viewport.
      // Restoring the canvas viewport afterwards shrinks high-DPI targets.
      renderer.setRenderTarget(previousTarget);
    }
  };
}
