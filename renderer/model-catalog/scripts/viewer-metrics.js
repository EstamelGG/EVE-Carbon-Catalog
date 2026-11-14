// Extracted unchanged from first-generation viewer-entry.js.
// These adapters use the installed model-viewer/Three.js APIs; no shader math lives here.
// API reference (Apache-2.0, model-viewer v4.4.0):
// https://github.com/google/model-viewer/blob/v4.4.0/packages/model-viewer/src/model-viewer-base.ts
// renderCount/queueRender are in the installed three-components/ModelScene.js.
// Sampling intervals and diagnostic labels are inherited application policy.
import {$scene, $renderer} from '@google/model-viewer/lib/model-viewer-base.js';

// Measure actual rendered model frames, including postprocessing. Sampling the
// browser animation loop would report refresh rate even for an idle model.
export function watchViewerFPS(viewer, update) {
  const scene = viewer[$scene];
  let frames = scene.renderCount, start = performance.now();
  const reset = () => {
    frames = scene.renderCount;
    start = performance.now();
    update(viewer.renderPaused ? 0 : null);
  };
  reset();
  document.addEventListener('visibilitychange', reset);
  viewer.addEventListener('render-activity-change', reset);
  const timer = setInterval(() => {
    if (document.hidden || viewer.renderPaused || !viewer.isConnected) return;
    const now = performance.now();
    const elapsed = now - start;
    if (elapsed <= 0) return;
    update(Math.round(Math.max(0, scene.renderCount - frames) * 1000 / elapsed));
    frames = scene.renderCount;
    start = now;
  }, 500);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', reset);
    viewer.removeEventListener('render-activity-change', reset);
  };
}

export function viewerGPU(viewer) {
  try {
    const gl=viewer[$renderer].threeRenderer.getContext();
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL||gl.RENDERER)||'WebGL');
  } catch { return 'WebGL'; }
}

import {observeRenderer, sceneResources} from './viewer-performance.js';
export function watchViewerPerformance(viewer) {
  const shared = viewer[$renderer], native = shared.threeRenderer;
  const observer = observeRenderer(shared);
  return {
    snapshot() {
      const gl = native.getContext(), canvas = native.domElement;
      return {
        scope: 'All scenes sharing this WebGL renderer; all passes including shadows and postprocessing',
        notes: 'CPU submit is JavaScript render work, not GPU time. FPS counts rendered frames over 2 seconds (initial window warms up). Idle scenes can report 0 FPS. Resource lists include hidden scene objects; visibility does not test camera frustum. Texture bytes are approximate RGBA8 with mipmaps, or compressed payload sizes; excludes render targets, driver allocations and cached resources. gpuMemory counts include renderer-owned resources.',
        sceneBufferStats: viewer.sceneBufferStats ? {...viewer.sceneBufferStats} : null,
        paused: !!viewer.renderPaused, contextLost: gl.isContextLost(), gpu: viewerGPU(viewer),
        canvas: {width: canvas.width, height: canvas.height, pixelRatio: native.getPixelRatio()},
        device: {userAgent: viewer.ownerDocument.defaultView.navigator.userAgent,
          devicePixelRatio: viewer.ownerDocument.defaultView.devicePixelRatio,
          viewport: {width: viewer.ownerDocument.defaultView.innerWidth, height: viewer.ownerDocument.defaultView.innerHeight},
          webglVersion: gl.getParameter(gl.VERSION), contextAttributes: gl.getContextAttributes()},
        frame: observer.sample(), resources: sceneResources(shared.scenes),
        gpuMemory: {...native.info.memory}, programs: native.info.programs?.length || 0,
        jsHeap: performance.memory ? {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit} : null,
      };
    },
    dispose: () => observer.dispose(),
  };
}
