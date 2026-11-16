/*! CCP Trinity child transforms. See third-party-notices.txt. */
import { Mesh, Vector3, Quaternion, Matrix4, Vector4 } from 'three';
import { createFlareVisibility } from './flare-visibility.js';
import { applyBillboard2D, applyBillboard3D } from './billboard-transform.js';
import { beforeSceneRender } from './effect-resources.js';
import { authoredFlareVertex, flareFragment } from './lighting-shaders.js';
import { createSpotlightBeam } from './spotlight-beam.js';

const localPosition = new Vector3(),
  localRotation = new Quaternion(),
  localScale = new Vector3();
const origin = [0, 0, 0],
  identityRotation = [0, 0, 0, 1],
  unitScale = [1, 1, 1];
export function authoredLocal(node, target = new Matrix4()) {
  if ((node.staticTransform || node.useSRT === false) && node.localTransform)
    return target.fromArray(node.localTransform.flat());
  return target.compose(
    localPosition.fromArray(node.translation || origin),
    localRotation.fromArray(node.rotation || identityRotation),
    localScale.fromArray(node.scaling || unitScale),
  );
}

const modifierPosition=new Vector3(),toCamera=new Vector3(),direction=new Vector3();
const modifierScale=new Vector3(),modifierRotation=new Quaternion(),modifierBasis=new Matrix4();

export function applyAuthoredModifier(world, modifier, eye, cameraRotation) {
  const type = modifier.type;
  if (type.endsWith('TranslateWithCamera')) {
    modifierPosition.setFromMatrixPosition(world);
    return world.setPosition(modifier.attachedToCamera ? eye : modifierPosition.add(eye));
  }
  if (type.endsWith('ModifierSRT')) return world.multiply(authoredLocal(modifier));
  if (type.endsWith('Billboard2D')) return applyBillboard2D(world, cameraRotation);
  if (type.endsWith('Billboard3D'))
    return applyBillboard3D(world, eye, cameraRotation, modifier.fixed);

  modifierPosition.setFromMatrixPosition(world);
  toCamera.subVectors(eye,modifierPosition);
  if (type.endsWith('Halo')) {
    direction.setFromMatrixColumn(world,2).normalize();
    const attenuation = Math.max(0, toCamera.normalize().dot(direction)) ** 2;
    return applyBillboard2D(world, cameraRotation, attenuation);
  }
  if (type.endsWith('CameraOrientedRotationConstrained')) {
    const rotation = modifierRotation.identity();
    // carbonengine/math 540edbfb Matrix.cpp::Decompose keeps positive basis lengths.
    // RotationQuaternion resolves diagonal ties X, then Y, then Z.
    const scale = modifierScale.setFromMatrixScale(world);
    if (scale.x && scale.y && scale.z) {
      const basis = modifierBasis.copy(world).scale(scale.set(1/scale.x,1/scale.y,1/scale.z));
      const m=basis.elements;
      if (m[0]+m[5]+m[10]<=0 && m[0]>=m[5] && m[0]>=m[10]) {
        const s=2*Math.sqrt(1+m[0]-m[5]-m[10]);
        rotation.set(s/4,(m[1]+m[4])/s,(m[2]+m[8])/s,(m[6]-m[9])/s);
      } else if (m[0]+m[5]+m[10]<=0 && m[5]>=m[10]) {
        const s=2*Math.sqrt(1+m[5]-m[0]-m[10]);
        rotation.set((m[1]+m[4])/s,s/4,(m[6]+m[9])/s,(m[8]-m[2])/s);
      } else rotation.setFromRotationMatrix(basis);
    }
    const inverseBasis=modifierBasis.makeRotationFromQuaternion(rotation).transpose();
    toCamera.applyMatrix4(inverseBasis);
    return world.multiply(modifierBasis.makeRotationY(Math.atan2(toCamera.x, toCamera.z)));
  }
  throw new Error(`Unsupported authored transform: ${type}`);
}

export function authoredWorld(node, parent, cameraPosition, cameraRotation) {
  const world = parent.clone().multiply(authoredLocal(node));
  for (const modifier of node.transformModifiers || []) {
    applyAuthoredModifier(world, modifier, cameraPosition, cameraRotation);
  }
  return world;
}

export async function installAuthoredSpotlights(viewer, scene, root, sets, resources, getState) {
  const entries = [];
  const shader = resources.additiveMaterial;
  const plane = resources.plane();
  async function visit(node, parents) {
    if (node.display === false) return;
    let object;
    if (node.type === 'trinity.EveChildQuad') {
      object = new Mesh(
        plane,
        shader(authoredFlareVertex, flareFragment(), {
          localTransform: { value: authoredLocal(node) },
          parentScale: { value: 1 },
          lightColor: {
            value: new Vector3(...node.color.slice(0, 3)).multiplyScalar(node.brightness),
          },
        }),
      );
    } else if (node.geometry) {
      object = new Mesh(
        resources.geometry(node.geometry),
        await createSpotlightBeam(node, resources, { authored: true }),
      );
    }
    if (object) {
      object.name = node.name;
      object.matrixAutoUpdate = false;
      object.frustumCulled = false;
      root.add(object);
      entries.push({ node, parents, object });
    }
    for (const child of node.objects || []) await visit(child, [...parents, node]);
  }
  for (const set of sets) {
    if (set.parents.some((parent) => parent.display === false)) continue;
    await visit(set.node, set.parents);
  }
  const cameraPosition = new Vector3(),
    cameraRotation = new Quaternion(),
    inverse = new Matrix4();
  const visibility = entries.some(entry => entry.node.type === 'trinity.EveChildQuad') ? createFlareVisibility() : null;
  const center = new Vector3(), viewport = new Vector4();
  const lastView = new Matrix4(), lastProjection = new Matrix4(), lastRoot = new Matrix4();
  const beamClocks = entries.filter(({node}) => node.type !== 'trinity.EveChildQuad')
    .map(({object}) => object.material.uniforms.time);
  let lastWidth, lastCamera, lastDepthMode;
  const unsubscribe = beforeSceneRender(scene, (camera, renderer) => {
    if (!root.visible) return;
    const elapsed = getState().elapsed;
    for (const uniform of beamClocks) uniform.value = elapsed;
    // These placements use only authored static transforms, the root pose and
    // the camera. Flare visibility additionally uses the pass viewport width.
    const width = camera.viewport?.z ?? renderer.getCurrentViewport(viewport).z;
    if (lastCamera === camera && lastWidth === width && lastDepthMode === camera.reversedDepth &&
        lastRoot.equals(root.matrixWorld) && lastView.equals(camera.matrixWorldInverse) &&
        lastProjection.equals(camera.projectionMatrix)) return;
    lastCamera = camera;
    lastWidth = width;
    lastDepthMode = camera.reversedDepth;
    lastRoot.copy(root.matrixWorld);
    lastView.copy(camera.matrixWorldInverse);
    lastProjection.copy(camera.projectionMatrix);
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(cameraRotation);
    inverse.copy(root.matrixWorld).invert();
    visibility?.begin(camera, renderer, root.matrixWorld, inverse);
    for (const { node, parents, object } of entries) {
      let parent = root.matrixWorld.clone();
      for (const ancestor of parents)
        parent = authoredWorld(ancestor, parent, cameraPosition, cameraRotation);
      if (node.type === 'trinity.EveChildQuad') {
        object.visible = visibility.test(node, object.material.uniforms.localTransform.value, parent, node.minScreenSize);
        if (!object.visible) continue;
        visibility.billboardCenter(center);
        object.matrix.makeTranslation(center.x, center.y, center.z).premultiply(inverse);
        object.material.uniforms.parentScale.value =
          visibility.billboardScale(object.material.uniforms.localTransform.value);
      } else {
        object.matrix
          .copy(authoredWorld(node, parent, cameraPosition, cameraRotation))
          .premultiply(inverse);
      }
      object.updateMatrixWorld(true);
    }
  });
  viewer.dataset.spotlights = `authored:${sets.length}`;
  return unsubscribe;
}
