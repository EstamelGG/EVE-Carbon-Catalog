import { Vector3 } from 'three';

// CCP Trinity, EveSmartLightAttributeModifierCameraDependency.cpp, GetActivationValue.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/SmartLightSets/attributeModifiers/EveSmartLightAttributeModifierCameraDependency.cpp#L36-L104
// The view and both overrides use the same world frame, in source units.
export function cameraActivation(modifier, context) {
  const offset = context.position.clone();
  if (modifier.overwritePosition ?? modifier.overwriteObjectPosition) {
    offset.fromArray(modifier.positionOverwrite ?? [0, 0, 0]);
  }
  offset.sub(context.camera);
  const distance = offset.length();
  offset.normalize();
  let gain = 1;
  if (modifier.useCameraDistance) {
    const low = modifier.minimumDistance ?? 1000, high = modifier.maximumDistance ?? 10000;
    const ramp = high === low ? Number(distance > low) : Math.min(1, Math.max(0, (distance - low) / (high - low)));
    gain *= modifier.inverseDistanceFormula ? 1 - ramp : ramp;
  }
  if (modifier.useCameraLookAt) {
    // Trinity negates the view matrix's +Z column. Three supplies camera forward (-Z).
    let facing = context.look.dot(offset);
    const cone = modifier.lookAtVisionCone ?? 30;
    if (cone > 0 && cone < 90) {
      const edge = 1 - cone / 90;
      facing = Math.max(0, facing - edge) / (1 - edge);
    }
    const exponent = modifier.lookAtIntensity ?? 1;
    // Behind an unrestricted cone an integer power is defined, even for negative facing.
    // A fractional power there has no real value. Use zero response on that half-space.
    const response = facing < 0 && !Number.isInteger(exponent) ? 0 : Math.pow(facing, exponent);
    gain *= modifier.inverselookAtFormula ? 1 - response : response;
  }
  if (modifier.useCameraPlacement) {
    const direction = modifier.overwriteObjectDirection
      ? new Vector3().fromArray(modifier.angleOverwrite ?? [0, 0, 0]).normalize()
      : context.direction;
    const response = Math.pow(Math.max(0, -offset.dot(direction)), modifier.placementIntensity ?? 1);
    gain *= modifier.inversePlacementFormula ? 1 - response : response;
  }
  const min = modifier.minimumActivation ?? 0, max = modifier.maximumActivation ?? 1;
  return min + (max - min) * gain;
}
