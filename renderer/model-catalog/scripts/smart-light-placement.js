import { Matrix4, Quaternion, Vector3 } from 'three';

// A parent-locator generator supplies the initial pose and bone index.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveDistributionMethods/DistributionPlacementGenerators/EveDistributionPlacementGeneratorParentLocators.cpp#L24-L49
export function smartLightPlacement([position, rotation, scale, boneIndex], groups) {
  const pose = {position: new Vector3(...position), rotation: new Quaternion(...rotation), scale: new Vector3(...scale)};
  if (boneIndex >= 0) {
    if (!groups.has(boneIndex)) groups.set(boneIndex, []);
    groups.get(boneIndex).push({
      pose, rest: new Matrix4().compose(pose.position, pose.rotation, pose.scale),
      restRotation: pose.rotation.clone(),
    });
  }
  return pose;
}

// Trinity applies the current joint to the initial matrix before separating
// position, rotation and scale. Each frame starts from the same authored pose.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveDistributionMethods/EveBaseDistributionMethod.cpp#L194-L201
export function updateSmartLightPlacements(items, joint, matrix) {
  for (const {pose, rest, restRotation} of items) {
    matrix.multiplyMatrices(joint, rest);
    if (matrix.determinant() !== 0) {
      matrix.decompose(pose.position, pose.rotation, pose.scale);
    } else {
      // A collapsed axis has no unique orientation. Keep its authored frame.
      pose.rotation.copy(restRotation);
      pose.position.setFromMatrixPosition(matrix);
      pose.scale.setFromMatrixScale(matrix);
    }
  }
}
