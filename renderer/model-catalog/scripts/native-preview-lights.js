// SOURCE AUDIT 2026-11-11 [L01-L02/M01-M04]: Reviewed with unresolved game-specific terms/policies; see consolidated report for limited public matches.
// See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
// Initially extracted from first-generation native-preview-scope.js; data IO
// and radius transport have since been replaced (remediation 03 and 09).
// Equipment brightness / view-relative presentation are separate application policies.
import {Color, DirectionalLight, PointLight, Group, Vector3, Quaternion, Matrix4} from 'three';
import {beforeSceneRender} from './effect-resources.js';
import {setSourceLightRadii} from './source-light-contract.js';

export function installPreviewLightRig(context) {
    const {
      viewer,
      scene,
      model,
      settings,
      equipment,
      typeID,
      controls,
      group,
      lights,
      displayUniforms,
      exportMaterials,
      exportRecipes,
    } = context;
    const { reflection, shWorld, sh, diffuseIntensity } = context.lighting;
    viewer.decalLightingUniforms = {
      ...reflection.uniforms,
      ...context.lighting.roomLights,
      eve_useNormalMap: displayUniforms.eve_useNormalMap,
      eve_sh: sh,
      eve_shWorld: shWorld,
      eve_shFill: controls.fill,
      eve_reflectionStrength: controls.reflection,
      eve_ambientStrength: { value: diffuseIntensity },
      eve_environmentStrength: reflection.uniforms.eve_environmentStrength || { value: reflection.source.intensity },
      eve_f0Strength: controls.f0,
      eve_roughnessScale: controls.roughness,
    };
    const sun = new DirectionalLight(new Color(...reflection.settings.sunColor), 1);
    // CCPDec AGame's reference orbit: the authored rig is unrotated at 35 deg yaw, 20 deg elevation.
    const yaw = 0.610865, pitch = -0.349066;
    const referenceEye = new Vector3(Math.sin(yaw)*Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw)*Math.cos(pitch));
    const referenceInverse = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(referenceEye, new Vector3(), new Vector3(0,1,0))
    ).invert();
    const cameraRotation = new Quaternion();
    const toSun = new Vector3(...settings.sunDirection).normalize().negate();
    group.add(sun, sun.target);
    lights.push({ light: sun, kind: 'sun', base: equipment ? 4.5 : 1 });

    const extras = context.document?.extras?.ccpdec;
    const publishedRadius = extras?.sourceRadiusOrigin === 'sof-hull-boundingSphere' ? extras.sourceRadius : null;
    const legacyRadius = settings.probes?.[typeID]?.sourceRadius;
    const positive = value => Number.isFinite(value) && value > 0;
    // Older packages lacking both lengths use model-viewer's visible sphere in scene units.
    const radius = positive(publishedRadius) ? publishedRadius : positive(legacyRadius) ? legacyRadius
      : scene.boundingSphere.radius / (model.scale.x || 1);
    const transforms = settings.rigTransforms;
    const pointRig = new Group();
    pointRig.matrixAutoUpdate = false;
    group.add(pointRig);
    const containers = new Matrix4();
    const translation = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    for (const [index, transform] of transforms.entries()) {
      scale.fromArray(transform.scaling);
      if (index === 1) scale.setScalar(radius); // boundingSphereRadius -> scaler.scaling
      containers.multiply(new Matrix4().compose(translation, rotation.fromArray(transform.rotation), scale));
    }
    const points = settings.lights.map(source => {
      const light = new PointLight(new Color(...source.color.slice(0, 3)), source.brightness);
      light.position.fromArray(source.position);
      pointRig.add(light);
      lights.push({ light, kind: 'fill', base: source.brightness });
      return {light, source};
    });
    scene.add(group);
    const world = new Vector3(), rotationMatrix = new Matrix4();
    const updateLights = camera => {
      model.updateWorldMatrix(true, false);
      group.updateWorldMatrix(true, false);
      if (equipment) {
        sun.position.copy(group.worldToLocal(camera.getWorldPosition(world)));
        sun.target.position.copy(scene.target.position);
      } else {
        camera.getWorldQuaternion(cameraRotation);
        group.quaternion.copy(scene.getWorldQuaternion(rotation).invert()).multiply(cameraRotation).multiply(referenceInverse);
        sun.position.copy(toSun);
        sun.target.position.set(0,0,0);
        model.getWorldScale(scale);
        pointRig.matrix.makeScale(scale.x,scale.y,scale.z).multiply(containers);
        pointRig.matrix.setPosition(scene.target.position);
      }
      group.updateMatrixWorld(true);
      // EveChildContainer::GetLights takes the arithmetic mean of the three world basis lengths.
      scale.setFromMatrixScale(pointRig.matrixWorld);
      const parentScale = (scale.x + scale.y + scale.z) / 3;
      for (const {light, source} of points) setSourceLightRadii(light, source.radius, source.innerRadius, parentScale);
      // previewSH already rotated each local source through the authored containers.
      model.getWorldQuaternion(rotation);
      shWorld.value.setFromMatrix4(rotationMatrix.makeRotationFromQuaternion(rotation));
    };
    updateLights(scene.getCamera());
    const stop = beforeSceneRender(scene, updateLights);
    const stopFollowingCamera = () => {
      stop();
      group.removeFromParent();
    };
    // Source cubemaps are sampled explicitly; keep the generic studio IBL off.
    scene.environmentIntensity = 0;

    const materialContext = {
      roomLights:context.lighting.roomLights,
      lightRig: group,
      controls,
      displayUniforms,
      reflection,
      shWorld,
      sh,
      exportMaterials,
      exportRecipes,
      scopes: new Set(),
    };
    viewer.nativeMaterialContext = materialContext;
    return {context: materialContext, stopFollowingCamera};
  }

