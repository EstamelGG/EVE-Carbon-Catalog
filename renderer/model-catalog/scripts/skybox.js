import { $scene } from '@google/model-viewer/lib/model-viewer-base.js';
import { createSkyboxState } from './skybox-core.js';
import { createEffectResources } from './effect-resources.js';

export function createSkybox(viewer, catalog, race) {
  const session = viewer.assetSession;
  if (session) {
    session.skybox ||= createSkyboxState(session.resources);
    return session.skybox.attach(viewer, viewer[$scene], catalog, race);
  }
  const resources = createEffectResources(),
    state = createSkyboxState(resources);
  const binding = state.attach(viewer, viewer[$scene], catalog, race);
  return {
    ...binding,
    dispose() {
      state.dispose();
      resources.dispose();
    },
  };
}
