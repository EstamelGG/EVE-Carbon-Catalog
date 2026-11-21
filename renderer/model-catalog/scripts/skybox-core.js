import {catalogSkyProjection, fileCubeRotation} from './skybox-orientation.js';
import {starOverlayGLSL} from './skybox-stars.js';
import { selectedBackground } from './resource-plan.js';
import { resourceURL } from '../src/resource-location.mjs';
import {
  SRGBColorSpace,
  LinearSRGBColorSpace,
  Matrix3,
  Matrix4,
  CubeReflectionMapping,
  BoxGeometry,
  Mesh,
  ShaderMaterial,
  BackSide,
  RepeatWrapping,
} from 'three';

// Background selection deliberately leaves authored hull reflection/light settings intact.
// New catalogs carry the DDS transfer function. Older ones only mark HDR cubes.
const skyColorSpace = entry => entry.colorSpace ?? (entry.hdr ? LinearSRGBColorSpace : SRGBColorSpace);
export function createSkyboxState(resources) {
  const resolveURL = resources.resolveURL || resourceURL;
  const prepared = new Map(),
    pending = new Map();
  const keyFor = (entry) =>
    entry
      ? JSON.stringify([
          resolveURL(entry.url),
          entry.stars ? resolveURL(entry.stars) : null,
          skyColorSpace(entry),
          entry.rotation,
        ])
      : '';
  let binding = null,
    currentKey = '',
    disposed = false,
    revision = 0;
  const prepare = (entry) => {
    const key = keyFor(entry);
    if (prepared.has(key)) return Promise.resolve(prepared.get(key));
    if (!pending.has(key))
      pending.set(
        key,
        (async () => {
          const [next, stars] = await Promise.all([
            resources.texture({ url: entry.url, dds: true, colorSpace: skyColorSpace(entry) }),
            entry.stars ? resources.texture({ url: entry.stars, dds: true }) : null,
          ]);
          if (disposed) return null;
          if (
            stars &&
            (stars.colorSpace !== SRGBColorSpace ||
              stars.wrapS !== RepeatWrapping ||
              stars.wrapT !== RepeatWrapping)
          ) {
            stars.colorSpace = SRGBColorSpace;
            stars.wrapS = stars.wrapT = RepeatWrapping;
            stars.needsUpdate = true;
          }
          const colorSpace = skyColorSpace(entry);
          if (
            next.colorSpace !== colorSpace ||
            !next.isCubeTexture ||
            next.mapping !== CubeReflectionMapping
          ) {
            next.colorSpace = colorSpace;
            next.isCubeTexture = true;
            next.mapping = CubeReflectionMapping;
            next.needsUpdate = true;
          }
          const value = { next, stars };
          prepared.set(key, value);
          return value;
        })().finally(() => pending.delete(key)),
      );
    return pending.get(key);
  };
  const material = new ShaderMaterial({
    side: BackSide,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      starMap: { value: null },
      hasStars: { value: false },
      skyExposure: { value: 1 },
      skyMap: { value: null },
      skyRotation: { value: new Matrix3() },
      skyOrientation: { value: new Matrix3() },
      skyMix: { value: 1 },
      previousMap: { value: null },
      previousStars: { value: null },
      hasPrevious: { value: false },
      previousHasStars: { value: false },
      previousRotation: { value: new Matrix3() },
    },
    vertexShader: `varying vec3 direction; uniform mat3 skyOrientation;
      ${catalogSkyProjection}
      void main() { direction = position;
        gl_Position = projectCatalogSky(mat3(viewMatrix) * skyOrientation * position); }`,
    fragmentShader: `uniform samplerCube skyMap; uniform sampler2D starMap; uniform bool hasStars;
      uniform mat3 skyRotation; uniform float skyExposure; varying vec3 direction;
      uniform samplerCube previousMap; uniform sampler2D previousStars;
      uniform bool hasPrevious, previousHasStars; uniform mat3 previousRotation; uniform float skyMix;
      ${starOverlayGLSL}
      vec3 sampleSky(samplerCube cube, sampler2D starsMap, bool starsEnabled, mat3 rotation) {
        vec3 ray = rotation * direction;
        vec3 color = textureCube(cube, ray).rgb;
        if (starsEnabled) color += sampleStarOverlay(starsMap, ray);
        return color;
      }
      void main() {
        vec3 color = sampleSky(skyMap, starMap, hasStars, skyRotation);
        if (skyMix < 1.0) {
          vec3 previous = hasPrevious ? sampleSky(previousMap, previousStars, previousHasStars, previousRotation) : vec3(0.0);
          color = mix(previous, color, skyMix);
        }
        gl_FragColor = vec4(color,1.0);
        // Cancel hull exposure before the shared HDR tone-map pass, retaining
        // the same tone curve and HDR detail at a fixed background exposure.
        gl_FragColor.rgb /= skyExposure;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new Mesh(new BoxGeometry(2, 2, 2), material);
  sky.name = 'EVE background';
  sky.frustumCulled = false;
  sky.renderOrder = -Infinity;
  sky.visible = false;
  const orientation = new Matrix4();
  sky.onBeforeRender = () => {
    if (!binding) return;
    const { viewer, scene } = binding;
    material.uniforms.skyExposure.value = Math.max(0.0001, Number(viewer.exposure) || 1);
    // Automatic orbit rotates the model pivot; pointer orbit rotates the camera.
    // Apply the pivot yaw once; viewMatrix supplies camera rotation without translation.
    material.uniforms.skyOrientation.value.setFromMatrix4(orientation.makeRotationY(scene.yaw));
  };
  let current, currentStars, previous, previousStars, fadeFrame, activeEntry;
  function finishFade() {
    cancelAnimationFrame(fadeFrame);
    fadeFrame = undefined;
    material.uniforms.skyMix.value = 1;
    material.uniforms.hasPrevious.value = false;
    material.uniforms.previousMap.value = null;
    material.uniforms.previousStars.value = null;
    previous = previousStars = null;
  }
  function fadeIn() {
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishFade();
      return;
    }
    material.uniforms.skyMix.value = 0;
    const start = performance.now();
    const tick = (now) => {
      if (disposed || !binding) return;
      const t = Math.min(1, Math.max(0, (now - start) / 500));
      material.uniforms.skyMix.value = t * t * (3 - 2 * t);
      binding.scene.queueRender();
      if (t < 1) fadeFrame = requestAnimationFrame(tick);
      else finishFade();
    };
    fadeFrame = requestAnimationFrame(tick);
  }
  const detach = (owner) => {
    if (binding !== owner) return;
    revision++;
    finishFade();
    const { scene, original } = owner;
    scene.background = original;
    scene.remove(sky);
    scene.queueRender();
    binding = null;
  };
  return {
    isReady(entry) {
      return !entry || prepared.has(keyFor(entry));
    },
    attach(viewer, scene, catalog, race) {
      if (disposed) throw new Error('Background session is closed');
      if (binding) detach(binding);
      const owner = { viewer, scene, original: scene.background };
      binding = owner;
      revision++;
      scene.add(sky);
      if (current) {
        scene.background = null;
        sky.visible = true;
      }
      const select = async (id) => {
        if (binding !== owner) return;
        const token = ++revision;
        const entry = selectedBackground(catalog, race, id);
        const key = keyFor(entry);
        if (key === currentKey) {
          activeEntry=entry;
          scene.queueRender();
          return;
        }
        if (!entry) {
          finishFade();
          sky.visible = false;
          scene.background = owner.original;
          currentStars = null;
          current = null;
          currentKey = '';
          scene.queueRender();
          return;
        }
        const assets = await prepare(entry);
        if (disposed || token !== revision || binding !== owner || !assets) return;
        const { next, stars } = assets;
        finishFade();
        previous = current;
        previousStars = currentStars;
        material.uniforms.previousMap.value = previous;
        material.uniforms.previousStars.value = previousStars;
        material.uniforms.hasPrevious.value = !!previous;
        material.uniforms.previousHasStars.value = !!previousStars;
        material.uniforms.previousRotation.value.copy(material.uniforms.skyRotation.value);
        material.uniforms.starMap.value = stars;
        material.uniforms.hasStars.value = !!stars;
        fileCubeRotation(material.uniforms.skyRotation.value, entry.rotation);
        material.uniforms.skyMap.value = next;
        scene.background = null;
        sky.visible = true;
        current = next;
        activeEntry=entry;
        currentStars = stars;
        currentKey = key;
        fadeIn();
        scene.queueRender();
      };
      return {
        select,
        get exportSource(){return binding===owner&&sky.visible&&current?{entry:activeEntry,texture:current,stars:currentStars}:null;},
        isReady(id) {
          const entry = selectedBackground(catalog, race, id);
          return !entry || prepared.has(keyFor(entry));
        },
        dispose() {
          detach(owner);
        },
      };
    },
    dispose() {
      if (disposed) return;
      if (binding) detach(binding);
      disposed = true;
      revision++;
      finishFade();
      sky.geometry.dispose();
      material.dispose();
      prepared.clear();
      pending.clear();
      currentStars = null;
      current = null;
    },
  };
}
