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
    const world = new Vector3(), rotationMatrix = new Matrix4(), modelRotation = new Quaternion();
    const updateLights = camera => {
      model.updateWorldMatrix(true, false);
      group.updateWorldMatrix(true, false);
      sun.target.position.copy(scene.target.position);
      if (settings.sunMode === 'scene') {
        sun.position.copy(sun.target.position).add(new Vector3(...settings.sunDirection).negate().normalize());
      } else {
        sun.position.copy(group.worldToLocal(camera.getWorldPosition(world)));
      }
      if (!equipment) {
        // Keep the authored fill lights in the hull frame as the camera orbits.
        group.getWorldQuaternion(rotation).invert().multiply(model.getWorldQuaternion(modelRotation));
        model.getWorldScale(scale);
        pointRig.matrix.compose(scene.target.position,rotation,scale).multiply(containers);
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

