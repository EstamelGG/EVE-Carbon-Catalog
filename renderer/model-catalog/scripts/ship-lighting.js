import { installSpotlights } from './ship-spotlights.js';
import { installAuthoredSpotlights } from './ship-authored-spotlights.js';

const installers = {
  authored: installAuthoredSpotlights,
  smart: installSpotlights,
  none: async () => () => {},
};

/** Selection is a build-time capability decision, never a ship-ID lookup. */
export async function installLighting(viewer, scene, root, lighting, resources, getState) {
  if (!Object.hasOwn(installers, lighting.mode))
    throw new Error(`Unsupported lighting mode: ${lighting.mode}`);
  const install = installers[lighting.mode];
  viewer.dataset.lightingMode = lighting.mode;
  viewer.dataset.lightingUnsupported = JSON.stringify(lighting.unsupported);
  const dispose = await install(viewer, scene, root, lighting.sets, resources, getState);
  let disposeSurface;
  try {
    const sets = lighting.mode === 'authored' ? lighting.surfaceSets : [];
    if (sets.length) {
      const authoredCount = viewer.dataset.spotlights;
      disposeSurface = await installSpotlights(viewer, scene, root, sets, resources, getState);
      viewer.dataset.spotlights = authoredCount;
    }
    viewer.dataset.surfaceLightSets = String(sets.length);
    return () => { disposeSurface?.(); dispose(); };
  } catch (error) {
    dispose();
    throw error;
  }
}

