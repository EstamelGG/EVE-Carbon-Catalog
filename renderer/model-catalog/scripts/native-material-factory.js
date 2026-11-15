// Material construction separated from scene lifetime and light-rig setup.
// Inherited first-generation policy: the source schema and shader functions
// remain pending review; extraction does not certify their provenance.
// Public API basis for clone/onBeforeCompile/customProgramCacheKey (Three r183, MIT):
// https://github.com/mrdoob/three.js/blob/r183/src/materials/Material.js
import {surfacePreview} from './surface-preview.js';
import {configureNativeShader} from './native-shader.js';
import {runtimeProfile} from './runtime-material.js';
import {nativeMaterialKey} from './native-material-key.js';
import {isGlassMaterial, configureGlass} from './glass-material.js';

export function createNativeMaterial(definition, original, loaded, context) {
    const { viewer, model, settings, resources, controls, displayUniforms, exportRecipes } = context;
    const surfaceControls=context.materialRoot.userData.eveEnvironment?{...controls,dirt:{value:1}}:controls;
    const { reflection, sh, shWorld, diffuseIntensity } = context.lighting;
    const native = definition.extras.ccpdecNative;
    const runtime = native.profile === runtimeProfile;
    const glass = runtime && isGlassMaterial(native);
    const material = resources.own(original.clone());
    material.metalness = 0;
    material.metalnessMap = null;
    material.map = runtime ? loaded.AlbedoMap : loaded.basecolor;
    if (runtime) {
      material.color.setRGB(1, 1, 1);
      material.roughness = 1;
      material.roughnessMap = null;
      material.normalMap = loaded.NormalMap;
      material.normalScale.set(1, 1);
      material.emissiveMap = null;
    }
    // A smoothed hull normal can point away from the eye at shell intersections.
    // Keep the normal-map lighting continuous across those triangles.
    if (runtime && !context.materialRoot.userData.eveEnvironment &&
        native.surfaceKind === 'opaqueAreas' && /\/quad(?:heat)?v5\.fx$/i.test(native.effect)) {
      material.defines = {...material.defines, EVE_OPAQUE_QUAD_HULL: 1};
    }
    if (runtime && !context.materialRoot.userData.eveEnvironment &&
        native.surfaceKind === 'opaqueAreas' && /\/skinned_quad(?:heat)?v5\.fx$/i.test(native.effect)) {
      material.defines = {...material.defines, EVE_SKINNED_QUAD_HULL: 1};
    }
    material.envMapIntensity = 0;
    if (runtime)
      exportRecipes.set(material, {
        native,
        loaded,
        dirtLevel: settings.dirtLevel,
        dirtStrength: surfaceControls.dirt,
        opaqueQuadHull: !!material.defines?.EVE_OPAQUE_QUAD_HULL,
        displayUniforms,
      });
    if (runtime && !glass &&
        !Object.values(loaded).some(texture => texture?.isVideoTexture))
      material.eveFixedBufferInputs = context.bufferInputs;
    if (glass) configureGlass(material);
    material.onBeforeCompile = (shader) =>
      configureNativeShader(shader, {
        controls:surfaceControls,
        roomLights:context.lighting.roomLights,
        reflection,
        sh,
        shWorld,
        diffuseIntensity,
        native,
        loaded,
        dirtLevel: settings.dirtLevel,
        displayUniforms,
        onCutoutCompiled: () => {
          viewer.dataset.nativeCutoutCompiled = definition.name;
        },
      });
    const programKey = nativeMaterialKey(native);
    material.customProgramCacheKey = () => programKey;
    context.previewModes.set(material,surfacePreview(material,native,loaded));
    material.needsUpdate = true;

    return material;
  }

