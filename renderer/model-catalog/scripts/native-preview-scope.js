// Scene transaction: prepare inputs -> reflection/lighting -> materials -> commit/dispose.
// Shader arithmetic and light-rig policy live in their respective modules.
import {createEffectResources} from './effect-resources.js';
import {createModelTextureLoader} from './model-textures.js';
import {loadReflections, loadReflectionSource, sessionReflections} from './native-reflections.js';
import {previewSH} from './native-sh.js';
import {normalizeRenderSettings} from '../src/render-settings.mjs';
import {normalizeDisplaySettings, textureRoles} from '../src/display-settings.mjs';
import {Group, Matrix3} from 'three';
import {queueMaterialInputs} from './native-material-inputs.js';
import {roomLightUniforms} from './room-light-grid.js';
import {createNativeMaterial} from './native-material-factory.js';
import {installPreviewLightRig} from './native-preview-lights.js';

// One installation owns its cloned materials, textures and render hook. Child
// scopes share the hull's uniforms and exports, but never its light rig.
class NativePreviewScope {
  constructor(
    viewer,
    {
      scene,
      anisotropy,
      settings,
      modelUrl,
      typeID,
      dna = '',
      progressive = false,
      root = null,
      document = null,
      sharedTextures = true,
      isValid = () => true,
    },
  ) {
    Object.assign(this, {
      viewer,
      scene,
      anisotropy,
      modelUrl,
      typeID,
      dna,
      progressive,
      root,
      document,
      sharedTextures,
      isValid,
    });
    this.model = scene.model;
    this.materialRoot = root || this.model;
    this.surfaceIndex=new Map();
    this.materialRoot.traverse(mesh=>{if(!mesh.isMesh||!mesh.material?.name)return;
      const name=mesh.material.name;if(!this.surfaceIndex.has(name))this.surfaceIndex.set(name,[]);this.surfaceIndex.get(name).push(mesh);});
    this.inherited = root ? viewer.nativeMaterialContext : null;
    if (root && !this.inherited)
      throw new Error('Part replacement requires the existing native lighting context');
    this.equipment = viewer.equipmentPreview?.scene;
    this.settings = this.equipment ? { ...settings, lights: [] } : settings;
    this.definitions = (document || viewer.appearanceDocument || viewer.originalGltfJson).materials;
    this.resources = createEffectResources(undefined, viewer.assetSession?.resolveURL, viewer.assetSession?.binaryURL);
    this.originalEnvironmentIntensity = scene.environmentIntensity;
    this.textureCache = new Map();
    this.materials = new Map();
    this.previewModes = new Map();
    this.replacements = [];
    this.lights = [];
    this.controls =
      this.inherited?.controls ||
      Object.fromEntries(
        Object.entries(normalizeRenderSettings(viewer.renderSettings)).map(([key, value]) => [
          key,
          { value },
        ]),
      );
    this.bufferInputs = {revision: 0};
    this.exportMaterials = this.inherited?.exportMaterials || new Map();
    this.exportRecipes = this.inherited?.exportRecipes || new Map();
    this.displayUniforms =
      this.inherited?.displayUniforms ||
      Object.fromEntries(textureRoles.map((role) => ['eve_use' + role, { value: 1 }]));
    this.group = new Group();
    this.group.name = 'CCP preview light rig';
    this.disposed = false;
    this.active = false;
    this.dispose = this.dispose.bind(this);
    this.setRenderSettings = this.setRenderSettings.bind(this);
    this.setDisplaySettings = this.setDisplaySettings.bind(this);
  }

  isCurrent() {
    return !this.disposed && this.isValid() && this.viewer.isConnected && this.scene.model === this.model;
  }

  prepareInputs() {
    const { viewer, root, materialRoot, document, modelUrl, resources, definitions } = this;
    this.loadTexture =
      (!root && viewer.loadSourceTexture) ||
      createModelTextureLoader(
        materialRoot,
        document || viewer.originalGltfJson,
        new URL(viewer.src || modelUrl, location.href).href,
        viewer.assetSession && this.sharedTextures ? (texture) => texture : resources.own,
        viewer.assetSession && this.sharedTextures ? (url) => viewer.assetSession.resources.texture({ url }) :
          viewer.assetSession ? (url) => resources.texture({ url }) : undefined,
      );
    if (root) this.inherited.scopes.add(this);
    return queueMaterialInputs(definitions, materialRoot, modelUrl, this);
  }

  bind() {
    const { viewer, definitions, root } = this;
    viewer.dataset.nativeCutoutMaterials = definitions
      .filter((d) => d.extras?.ccpdecNative?.clip).map((d) => d.name).join(',');
    const roles = definitions.flatMap((d) => Object.keys(d.extras?.ccpdecNative?.textures || {}));
    if (root) {
      for (const role of roles) viewer.availableTextureRoles.add(role);
      return;
    }
    viewer.loadSourceTexture = this.loadTexture;
    viewer.setRenderSettings = this.setRenderSettings;
    viewer.setDisplaySettings = this.setDisplaySettings;
    viewer.exportMaterials = this.exportMaterials;
    viewer.exportRecipes = this.exportRecipes;
    viewer.availableTextureRoles = new Set(roles);
  }

  setRenderSettings(values) {
    this.bufferInputs.revision++;
    const tuning = normalizeRenderSettings(values);
    for (const [key, value] of Object.entries(tuning)) this.controls[key].value = value;
    for (const { light, kind, base } of this.lights) light.intensity = base * tuning[kind];
    this.scene.queueRender();
  }

  setDisplaySettings(values) {
    const display = normalizeDisplaySettings(values);
    this.bufferInputs.revision++;
    const preview=display.noColor && !this.materialRoot.userData.eveEnvironment;
    for(const setPreview of this.previewModes.values())setPreview(preview);
    if(!this.root){
      this.group.visible=!preview && !this.viewer.hangarActive;
      this.scene.environmentIntensity=0;
    }
    for (const role of textureRoles)
      this.displayUniforms['eve_use' + role].value = Number(display.textures[role]);
    for (const material of this.materials.values())
      material.normalScale.setScalar(Number(display.textures.NormalMap));
    if (!this.root)
      for (const scope of this.context?.scopes || []) scope.setDisplaySettings(values);
    this.scene.queueRender();
  }

  async loadReflection() {
    if (this.inherited) return this.inherited.reflection;
    const { viewer, equipment, resources, dna } = this;
    if (equipment)
      return loadReflectionSource(
        resources,
        { sunColor: equipment.sunColor, diffuseIntensity: 1 },
        { ...equipment, reflection: equipment.reflection.url, diffuse: equipment.diffuse.url },
      );
    const environment = this.settings.environment;
    if (environment) return loadReflectionSource(resources, environment, environment.source);
    const race = viewer.previewRace || dna.split(':')[2];
    return viewer.assetSession?.reflections
      ? sessionReflections(viewer.assetSession, race)
      : loadReflections(resources, race);
  }

  prepareLighting(reflection) {
    const { inherited, settings } = this;
    const shWorld = inherited?.shWorld || { value: new Matrix3() };
    const diffuseIntensity = reflection.source.shIntensity ?? reflection.settings.diffuseIntensity;
    const sh = inherited?.sh || { value: previewSH(settings, diffuseIntensity) };
    this.lighting = { reflection, shWorld, sh, diffuseIntensity, roomLights:inherited?.roomLights??roomLightUniforms() };
  }

  installLighting() {
    if (this.root) return;
    const {viewer, scene, model, settings, equipment, typeID, controls, group,
      lights, displayUniforms, exportMaterials, exportRecipes, lighting} = this;
    Object.assign(this, installPreviewLightRig({
      document: this.document || viewer.appearanceDocument || viewer.originalGltfJson,
      viewer, scene, model, settings, equipment, typeID, controls, group,
      lights, displayUniforms, exportMaterials, exportRecipes, lighting,
    }));
  }

  findMaterial(name) {
    const material=this.surfaceIndex.get(name)?.at(-1)?.material;
    return this.viewer.exportMaterials?.get(material)||material;
  }

  createMaterial(definition, original, loaded) {
    const {viewer, model, settings, resources, controls, displayUniforms,
      exportRecipes, materialRoot, lighting, previewModes} = this;
    return createNativeMaterial(definition, original, loaded, {
      viewer, model, settings, resources, controls, displayUniforms,
      exportRecipes, materialRoot, lighting, previewModes, bufferInputs: this.bufferInputs,
    });
  }

  async installMaterial(definition, inputs) {
    const native = definition.extras?.ccpdecNative;
    if (!native) throw new Error('Missing source material inputs: ' + definition.name);
    const original = this.findMaterial(definition.name);
    if (!original) return;
    let material;
    if (native.profile === 'fx-surface-v1') {
      material = this.resources.own(original.clone());
      material.colorWrite = false;
      material.depthWrite = false;
    } else {
      const { loaded, pending } = inputs.get(definition);
      await pending;
      if (!this.isCurrent()) return;
      material = this.createMaterial(definition, original, loaded);
    }
    this.materials.set(definition.name, material);
    if (this.progressive) this.applyMaterial(definition.name, material);
  }

  applyMaterial(name, replacement) {
    if (!this.isCurrent()) return;
    const { viewer, materialRoot, definitions, replacements, exportMaterials } = this;
    for(const mesh of this.surfaceIndex.get(name)||[]) {
      if (!mesh.isMesh || mesh.material.name !== name || mesh.material === replacement) continue;
      replacements.push([mesh, mesh.material, mesh.renderOrder]);
      exportMaterials.set(replacement, mesh.material);
      mesh.material = replacement;
      viewer.pendingNativeSurfaces?.reveal(mesh);
      mesh.renderOrder = definitions.find((d) => d.name === name)?.extras?.ccpdecDrawOrder || 0;
    }
    this.setDisplaySettings(viewer.displaySettings);
    this.scene.queueRender();
  }

  activate() {
    if (this.active || !this.isCurrent()) return;
    this.originalEnvironmentIntensity = this.scene.environmentIntensity;
    this.active = true;
    this.bind();
    this.installLighting();
    this.setRenderSettings(this.viewer.renderSettings);
  }

  async prepare() {
    try {
      const inputs = this.prepareInputs();
      const reflection = await this.loadReflection();
      if (!this.isCurrent()) {
        this.dispose();
        return this;
      }
      this.prepareLighting(reflection);
      // First loads retain progressive rendering; replacements remain private
      // until their entire material/effects transaction is ready to commit.
      if (this.progressive) this.activate();
      if(this.progressive&&this.root){
        // Room surfaces become visible as their own maps finish; one slow
        // material must not hold every other completed wall/platform hostage.
        await Promise.all(this.definitions.map(definition=>this.installMaterial(definition,inputs)));
        if(!this.isCurrent())this.dispose();
      }else for (const definition of this.definitions) {
        await this.installMaterial(definition, inputs);
        if (!this.isCurrent()) {
          this.dispose();
          return this;
        }
      }
      return this;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  commit() {
    if (!this.isCurrent()) { this.dispose(); return this.dispose; }
    this.activate();
    for (const [name, replacement] of this.materials) this.applyMaterial(name, replacement);
    this.viewer.dataset.materialPath = 'quad-source-v1';
    this.viewer.dataset.nativeTextureCount = String(this.textureCache.size);
    this.setRenderSettings(this.viewer.renderSettings);
    this.setDisplaySettings(this.viewer.displaySettings);
    this.scene.queueRender();
    return this.dispose;
  }

  releaseExports() {
    const { viewer, inherited, context, exportMaterials, exportRecipes } = this;
    if (this.root) {
      inherited.scopes.delete(this);
      for (const material of this.materials.values()) {
        exportMaterials.delete(material);
        exportRecipes.delete(material);
      }
      return;
    }
    for (const child of [...(context?.scopes || [])]) child.dispose();
    if (viewer.nativeMaterialContext === context) delete viewer.nativeMaterialContext;
    if (viewer.exportMaterials === exportMaterials) delete viewer.exportMaterials;
    if (viewer.exportRecipes === exportRecipes) delete viewer.exportRecipes;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const { viewer, scene, model } = this;
    this.releaseExports();
    this.stopFollowingCamera?.();
    this.group.removeFromParent();
    if (this.active && !this.root && scene.model === model)
      scene.environmentIntensity = this.originalEnvironmentIntensity;
    for (const [mesh, original, order] of this.replacements) {
      mesh.material = original;
      mesh.renderOrder = order;
    }
    this.resources.dispose();
    if (viewer.setRenderSettings === this.setRenderSettings) delete viewer.setRenderSettings;
    if (!viewer.assetSession && viewer.loadSourceTexture === this.loadTexture)
      delete viewer.loadSourceTexture;
    if (this.active && !this.root && scene.model === model) delete viewer.decalLightingUniforms;
    if (viewer.setDisplaySettings === this.setDisplaySettings) {
      delete viewer.setDisplaySettings;
      delete viewer.availableTextureRoles;
    }
  }
}

export function prepareNativeScene(viewer, options) {
  return new NativePreviewScope(viewer, options).prepare();
}

export async function installNativeScene(viewer, options) {
  if (!options.scene.model || !viewer.isConnected) return () => {};
  return (await prepareNativeScene(viewer, options)).commit();
}
