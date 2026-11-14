import { Color, Matrix4, PointLight, Vector3 } from 'three';
import { previewRandom } from './preview-random.js';
import { setSourceLightRadii } from './source-light-contract.js';

// Trinity, MIT (docs/licenses/carbon-trinity-MIT.txt). Sample count, phase range
// and interpolation follow ComputeBoosterLightFlicker / GenerateBoosterLightPhase.
// A fixed preview seed makes comparisons repeatable across reloads.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveBoosterUtilities.cpp#L133-L162
const noise = Float32Array.from({ length: 128 }, previewRandom(7391));

export function previewBoosterGain(booster, flightMode) {
  // CalculateIntensity checks alwaysOn first. Cruise previews steady full speed
  // without acceleration, idle previews zero speed.
  // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/EveBoosterSet2.cpp#L98-L132
  if (booster.alwaysOn) return booster.alwaysOnIntensity;
  return flightMode === 'idle' ? 0 : 0.8;
}

export function installBoosterLights(group, booster, scale, seed) {
  const settings = booster.lights;
  const lights = [];
  const random = previewRandom(seed);
  // EveBoosterSet2::Add supplies position and transverse scale. AddBoosterLights
  // applies gain to radius and flicker to color, using the cruise inputs here.
  // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/EveBoosterSet2.cpp#L770-L780
  // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveBoosterUtilities.h#L47-L66
  const matrix = new Matrix4(), axis = new Vector3();
  for (const placement of booster.placements) {
    matrix.fromArray(placement.transform.flat());
    const width = Math.max(axis.setFromMatrixColumn(matrix, 0).length(), axis.setFromMatrixColumn(matrix, 1).length());
    const radius = width * placement.lightScale * settings.lightRadius;
    if (radius <= 0) continue;
    const light = new PointLight(new Color().fromArray(settings.lightColor), 0);
    light.position.set(0, 0, -settings.lightOffset).applyMatrix4(matrix);
    group.add(light);
    lights.push({ light, radius, phase: random() * noise.length });
  }
  return (elapsed, gain) => {
    for (const { light, radius, phase } of lights) {
      const sample = (phase + elapsed) * settings.lightFlickerFrequency;
      const index = Math.floor(sample), fraction = sample - index;
      const a = noise[index % noise.length], b = noise[(index + 1) % noise.length];
      light.intensity = 1 + settings.lightFlickerAmplitude * (2 * (a + (b - a) * fraction) - 1);
      light.visible = gain > 0;
      setSourceLightRadii(light, radius * gain, 0, scale);
    }
  };
}
