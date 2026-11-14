/*! CCP Trinity EveChildQuad::UpdateVisibility, BoundingSphereTransform and
 * TriFrustum::GetPixelSizeAccross, MIT. See third-party-notices.txt.
 * https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/EveChildQuad.cpp#L157-L181
 */
import {Frustum, Matrix4, Quaternion, Vector3, Vector4} from 'three';

export function createFlareVisibility() {
  const frustum = new Frustum(), clip = new Matrix4(), world = new Matrix4();
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  const center = new Vector3(), viewCenter = new Vector3(), viewport = new Vector4();
  const axisX=new Vector3(),axisY=new Vector3();
  const area=m=>axisX.setFromMatrixColumn(m,0).cross(axisY.setFromMatrixColumn(m,1)).length();
  let eyeToView, root, inverseRoot, projectionWidth, epsilon;
  return {
    begin(camera, renderer, rootWorld, inverse) {
      root = rootWorld;
      inverseRoot = inverse;
      epsilon = 1e-5 * rootWorld.getMaxScaleOnAxis(); // Source meters to viewer units.
      eyeToView = camera.matrixWorldInverse;
      clip.multiplyMatrices(camera.projectionMatrix, eyeToView);
      frustum.setFromProjectionMatrix(clip, camera.coordinateSystem, camera.reversedDepth);
      const width = camera.viewport?.z ?? renderer.getCurrentViewport(viewport).z;
      projectionWidth = width * camera.projectionMatrix.elements[0];
      return width;
    },
    // Preserve the transformed area of the two authored lamp axes. Keeping
    // the local aspect ratio lets the camera-facing sprite stay a billboard.
    billboardScale(local) {
      const sourceArea=area(local);
      return sourceArea>0 ? Math.sqrt(area(world)/sourceArea) : 0;
    },
    billboardCenter(out) {return out.copy(center);},
    measure(node, local, parent) {
      if (!node.staticTransform && node.useSRT !== false && (node.useStaticScale || node.useStaticRotation)) {
        // The viewer's root converts source meters into scene coordinates.
        // Remove only authored parent scale/rotation by decomposing in source space.
        world.multiplyMatrices(inverseRoot, parent).decompose(position, rotation, scale);
        if (node.useStaticScale) scale.set(1, 1, 1);
        if (node.useStaticRotation) rotation.identity();
        world.compose(position, rotation, scale).premultiply(root);
      } else {
        world.copy(parent);
      }
      world.multiply(local);
      center.setFromMatrixPosition(world);
      return Math.SQRT2 * world.getMaxScaleOnAxis();
    },
    test(node, local, parent, minScreenSize = 0) {
      const radius=this.measure(node,local,parent);
      return this.inView(center,radius,minScreenSize);
    },
    inView(center,radius,minScreenSize) {
      // Three orders the planes right, left, bottom, top, far, near. Trinity
      // omits the far plane for this CPU test; rasterization still clips there.
      for (let i = 0; i < 6; i++) {
        if (i !== 4 && frustum.planes[i].distanceToPoint(center) < -radius) return false;
      }
      if (minScreenSize <= 0) return true;
      viewCenter.copy(center).applyMatrix4(eyeToView);
      if (viewCenter.lengthSq() < radius * radius) return true;
      const pixels = radius <= 0 || radius < epsilon ? 0 : radius * projectionWidth / Math.max(-viewCenter.z, epsilon);
      return pixels >= minScreenSize; // EveUpdateContext default LOD factor is 1.
    },
  };
}
