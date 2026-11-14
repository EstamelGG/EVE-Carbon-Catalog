import { createLayeredMeshMaterial } from './layered-mesh-material.js';

export function createSpotlightBeam(record, resources, { authored = false } = {}) {
  // Old authored lamps used two layers, old SmartLight exports one.
  return createLayeredMeshMaterial(record, resources, record.beamLayers ?? (authored ? 2 : 1));
}
