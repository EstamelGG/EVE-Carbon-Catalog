/*! Trinity smart-light placement and modifiers; MIT notices in dist/third-party-notices.txt. */
import { Mesh, Vector3, Quaternion, Matrix3, Matrix4, SpotLight, PointLight } from 'three';
import { beforeSceneRender } from './effect-resources.js';
import { smartFlareVertex, flareFragment } from './lighting-shaders.js';
import { createSpotlightBeam } from './spotlight-beam.js';
import { smartLightPlacement, updateSmartLightPlacements } from './smart-light-placement.js';
import { bindAttachmentBones } from './source-bones.js';
import {controllerValue, expressionValue, lightController} from './smart-light-controller.js';
import {perlinNoise1D} from './trinity-noise.js';
import {beamRotation} from './smart-beam-rotation.js';
import { cameraActivation } from './smart-light-camera.js';

const clamp = (x) => Math.min(1, Math.max(0, x));
// Evaluate settled modifier values for the active preview state.
export function modifyLightColor(color, modifiers, context, strength = 1) {
  for (const m of modifiers || []) {
    let a = strength * (m.attributeMultiplier ?? 1);
    const type = m.type.split('.').pop();
    const frame = context.modifierState?.(m);
    if (frame) a = strength * frame.final;
    if (type === 'EveSmartLightAttributeModifierControllerVariableListener' && !frame) {
      const value = controllerValue(m, context);
      const active = value === undefined ? (m.defaultValue ?? 0) > .5 :
        m.invertReceivedValue ? value < 1 : value > 0;
      a *= Number(active);
    } else if (type === 'EveSmartLightAttributeModifierCameraDependency') {
      a = strength * (m.attributeMultiplier ?? 1) * cameraActivation(m, context);
    } else if (type === 'EveSmartLightAttributeModifierExpressionBucket' && !frame) {
      a = strength * expressionValue(m, context, context.elapsed ?? 0);
    } else if (type === 'EveSmartLightAttributeModifierNoise') {
      const amplitude=a*(m.noiseAmplitude??0);
      if(amplitude>0){
        const noise=perlinNoise1D((context.elapsed??0)*(m.noiseFrequency??1),2,2,m.noiseOctaves??1);
        color.multiplyScalar(1+a*((noise+1)*.5*amplitude-1));
      }
    } else if (type === 'EveSmartLightAttributeModifierColor') {
      if ((!frame && m.startsActive === false) || a <= 0) continue;
      const target = m.activeBlendColor || m.blendColor;
      color.lerp(new Vector3(...target.slice(0, 3)), a * m.blendValue);
      const gray = color.dot(new Vector3(0.299, 0.587, 0.114));
      color
        .subScalar(gray)
        .multiplyScalar(Math.max(0, 1 + a * (m.saturationMultiplier - 1)))
        .addScalar(gray);
      color.multiplyScalar(1 + a * (m.brightnessMultiplier - 1));
      color.set(clamp(color.x), clamp(color.y), clamp(color.z));
    }
    if (m.attributeModifiers && a !== 0) modifyLightColor(color, m.attributeModifiers, context, a);
  }
  return color;
}

function groupColor(group,inherited){
  if(group.useFactionColor && group.factionColor>=0 && group.activeColor)return group.activeColor;
  return inherited ?? group.activeColor ?? group.customColor ?? [1,1,1,1];
}

export async function installSpotlights(viewer, scene, root, sets, resources, getState) {
  const model = scene.model;
  const entries = [], jointPoses = new Map();
  const shader = resources.additiveMaterial;
  const plane = resources.plane();
  async function visit(g, placement, parents = []) {
    if (g.display === false) return;
    if (g.lightGroups) {
      for (const child of g.lightGroups) await visit(child, placement, [...parents, g]);
      return;
    }
    const type = g.type.split('.').pop();
    const entry = {
      g,
      placement,
      parents,
      position: new Vector3(),
      direction: new Vector3(),
      rotation: new Quaternion(),
    };
    let object;
    if (type === 'EveSmartLightQuad') {
      const resource = g.sourceShader?.resource || '';
      const softFlare = /(?:^|\/)flarequadsoft\.(?:fx|sm_depth)$/i.test(resource);
      const m = shader(smartFlareVertex, flareFragment({ softFlare }), {
        size: { value: new Vector3() },
        lightColor: { value: new Vector3() },
      });
      object = new Mesh(plane, m);
    } else if (type === 'EveSmartLightMesh') {
      const material = await createSpotlightBeam(g, resources);
      object = new Mesh(resources.geometry(g.geometry), material);
      // Trinity changes only the named parameter. Older exports assumed DiffuseColor.
      // https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/SmartLightSets/EveSmartLightMesh.cpp#L79-L136
      const parameter = material.uniforms[g.shaderParamColorName ?? 'DiffuseColor']?.value;
      if (parameter?.isVector4) entry.beamColor = parameter;
    } else if (type === 'EveSmartLightSpotLight' || type === 'EveSmartLightPointLight') {
      const scale = Math.max(placement.scale.x, placement.scale.y, placement.scale.z) * model.scale.x;
      object =
        type === 'EveSmartLightSpotLight'
          ? new SpotLight(
              0xffffff,
              g.brightness,
              g.radius * scale,
              (g.outerAngle * Math.PI) / 180,
              1 - g.innerAngle / Math.max(g.outerAngle, 0.001),
              0,
            )
          : new PointLight(0xffffff, g.brightness, g.radius * scale, 0);
      if (object.isSpotLight) root.add(object.target);
    } else return;
    object.name = g.name || type;
    object.frustumCulled = false;
    root.add(object);
    entry.object = object;
    entries.push(entry);
  }
  for (const set of sets) {
    for (const source of set.placements) {
      const placement = smartLightPlacement(source, jointPoses);
      for (const group of set.groups) await visit(group, placement);
    }
  }
  const groups=new Set(entries.flatMap(e=>[...e.parents,e.g]));
  const advance=lightController();
  const updateJoints = bindAttachmentBones(root, model, viewer.originalGltfJson, jointPoses);
  const worldCamera = new Vector3(),
    worldPosition = new Vector3(),
    worldDirection = new Vector3(),
    directionMatrix = new Matrix3(),
    look = new Vector3(),
    nativeWorld=new Matrix4(),
    placementMatrix = new Matrix4();
  function update(camera) {
    if (!root.visible || !root.parent) return;
    updateJoints?.((items, joint) => updateSmartLightPlacements(items, joint, placementMatrix));
    const preview = getState();
    const state={...preview,modifierState:advance(groups,preview)};
    camera.getWorldPosition(worldCamera);
    camera.getWorldDirection(look);
    // Remove the viewer's metre-to-display scale while retaining the hull's scene pose.
    const displayScale = Math.abs(model.scale.x) || 1;
    worldCamera.divideScalar(displayScale);
    nativeWorld.makeScale(1/displayScale,1/displayScale,1/displayScale).multiply(root.matrixWorld);
    directionMatrix.setFromMatrix4(root.matrixWorld).multiplyScalar(1 / displayScale);
    const sharedColors = new Map();
    const sharedContext={camera:worldCamera,position:new Vector3(),direction:new Vector3(0,1,0),
      look,...state};
    for (const e of entries) {
      const { g, placement, object } = e;
      e.rotation.copy(placement.rotation);
      e.position
        .fromArray(g.staticOffsetTranslation || [0, 0, 0])
        .applyQuaternion(e.rotation)
        .add(placement.position);
      e.direction.set(0, 1, 0).applyQuaternion(e.rotation);
      const context = {
        camera: worldCamera,
        position: worldPosition.copy(e.position).applyMatrix4(root.matrixWorld).divideScalar(displayScale),
        direction: worldDirection.copy(e.direction).applyMatrix3(directionMatrix),
        look,
        ...state,
      };
      let inherited;
      for(const parent of e.parents){
        if(!sharedColors.has(parent)){
          const seed=groupColor(parent,inherited);
          const rgb=modifyLightColor(new Vector3().fromArray(seed),parent.attributeModifiers,sharedContext);
          sharedColors.set(parent,[rgb.x,rgb.y,rgb.z,inherited?.[3]??parent.customColor?.[3]??seed[3]??1]);
        }
        inherited=sharedColors.get(parent);
      }
      const baseColor=groupColor(g,inherited);
      const color = new Vector3().fromArray(baseColor);
      modifyLightColor(color, g.attributeModifiers, context);
      object.position.copy(e.position);
      if (object.isLight) {
        // EveSmartLightPointLight and EveSmartLightSpotLight use the largest placement axis.
        const largestAxis = Math.max(placement.scale.x, placement.scale.y, placement.scale.z);
        object.distance = g.radius * model.scale.x * largestAxis;
        object.color.setRGB(color.x, color.y, color.z);
        if (largestAxis === 0) object.color.setRGB(0, 0, 0);
        if (object.isSpotLight) object.target.position.copy(e.position).add(e.direction);
      } else {
        if (g.staticQuadScale) {
          object.material.uniforms.lightColor.value.copy(color).multiplyScalar(g.brightness ?? 1);
          const scale = model.scale.x;
          object.material.uniforms.size.value.set(
            g.staticQuadScale[0] * placement.scale.x * scale,
            g.staticQuadScale[1] * placement.scale.y * scale,
            0,
          );
        } else {
          e.beamColor?.set(color.x, color.y, color.z, baseColor[3] ?? 1);
          beamRotation(object.quaternion,g.rotationConstraint??0,e.rotation,e.position,nativeWorld,worldCamera,g.staticOffsetRotation);
          object.scale.set(...g.staticOffsetScale).multiply(placement.scale);
          object.material.uniforms.time.value = state.elapsed;
        }
      }
      object.updateMatrixWorld(true);
      if (object.isSpotLight) object.target.updateMatrixWorld(true);
    }
  }
  // Called before lights and meshes are collected, including camera-only changes while paused.
  const unsubscribe = beforeSceneRender(scene, update);
  viewer.dataset.spotlights = String(sets.reduce((n, s) => n + s.placements.length, 0));
  return unsubscribe;
}
