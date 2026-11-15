import {
  AddEquation,
  BufferGeometry,
  CustomBlending,
  Data3DTexture,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  GLSL3,
  LinearFilter,
  OneFactor,
  PlaneGeometry,
  RepeatWrapping,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import {loadSourceImage} from './source-image.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { withEffectColor } from './effect-color.js';
import { resourceURL } from '../src/resource-location.mjs';
import { trackResource, readResourceBody } from '../src/resource-activity.mjs';
import { createEffectVideo } from './effect-video.js';

/** One viewer owns one scope. Pending loads are also disposed after teardown. */
export function createEffectResources(loadTexture = loadSourceImage, resolveURL = resourceURL, binaryURL = url => url) {
  const owned = new Set(),
    textures = new Map(),
    geometries = new Map();
  let disposed = false, playing = false;
  const videos = new Map();

  function own(resource) {
    if (disposed) resource.dispose();
    else owned.add(resource);
    return resource;
  }

  async function texture(record, { repeat = false } = {}) {
    if (record.video) {
      const key=JSON.stringify(record.playlist?.length ? record.playlist : [record.url]);
      let player=videos.get(key);
      if (!player) {
        player=createEffectVideo(record, undefined, resolveURL);
        if (disposed) {player.dispose();return player.texture;}
        videos.set(key,player);
        player.setPlaying(playing);
      }
      if (!repeat) return player.texture;
      if (!player.repeatingTexture) {
        const view=own(player.texture.clone());
        view.wrapS=view.wrapT=RepeatWrapping;
        player.repeatingTexture=view;
      }
      return player.repeatingTexture;
    }
    record = { ...record, url: resolveURL(record.url) };
    const source = binaryURL(record.url);
    const key = JSON.stringify([record.url, record.volume, record.cube, record.dds, record.float32, repeat, record.colorSpace]);
    if (!textures.has(key)) {
      textures.set(
        key,
        trackResource(record.url, async progress => {
          let result;
          if (record.cube || record.dds) {
            result = await new DDSLoader().loadAsync(source, event => progress(event.loaded, event.lengthComputable ? event.total : 0));
          } else if (record.float32) {
            // Earlier float textures carry four channels and omit the count.
            const [width,height,channels=4] = record.float32;
            const response = await fetch(source);
            if (!response.ok) throw new Error(`Missing float effect texture: ${record.url}`);
            const bytes = await readResourceBody(response, progress);
            if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || ![1,4].includes(channels) || bytes.byteLength!==width*height*channels*4)
              throw new Error('Invalid float effect texture');
            result = new DataTexture(new Float32Array(bytes),width,height,channels===1?RedFormat:RGBAFormat,FloatType);
            result.minFilter = result.magFilter = LinearFilter;
            if (repeat) result.wrapS = result.wrapT = RepeatWrapping;
            result.needsUpdate = true;
          } else if (record.volume) {
            const response = await fetch(source);
            if (!response.ok) throw new Error(`Missing effect volume: ${record.url}`);
            const bytes = new Uint8Array(await readResourceBody(response, progress));
            if (bytes.length !== record.volume.reduce((n, d) => n * d, 4))
              throw new Error('Invalid effect volume');
            // The builder publishes the top mip as RGBA8 in Z/Y/X order,
            // with X contiguous. Linear filtering and repeat are preview choices.
            // https://github.com/mrdoob/three.js/blob/r183/src/textures/Data3DTexture.js
            result = new Data3DTexture(bytes, ...record.volume);
            result.format = RGBAFormat;
            result.type = UnsignedByteType;
            result.minFilter = result.magFilter = LinearFilter;
            result.wrapS = result.wrapT = result.wrapR = RepeatWrapping;
            result.needsUpdate = true;
          } else {
            result = await loadTexture(source, event => progress(event.loaded, event.lengthComputable ? event.total : 0), record.url);
            if (result.isData3DTexture) {
              result.wrapS=result.wrapT=result.wrapR=RepeatWrapping;
              result.minFilter=result.magFilter=LinearFilter;
              result.needsUpdate=true;
            }
            // A shared image can also be bound as linear data by another
            // material. Change only this cache entry's sampler view.
            if (record.colorSpace !== undefined && result.colorSpace !== record.colorSpace) {
              const view = own(result.clone());
              if (loadTexture === loadSourceImage) own(result);
              view.colorSpace = record.colorSpace;
              view.needsUpdate = true;
              result = view;
            }
            result.flipY = false;
            if (repeat) result.wrapS = result.wrapT = RepeatWrapping;
          }
          return own(result);
        }, 'resourceTexture').catch(error => { textures.delete(key); throw error; }),
      );
    }
    return textures.get(key);
  }

  function geometry(data) {
    const key = data.sharedGeometryURL || data.checksum || data;
    if (!geometries.has(key)) {
      const result = own(new BufferGeometry());
      result.setAttribute('position', new Float32BufferAttribute(data.position, 3));
      result.setAttribute('normal', new Float32BufferAttribute(data.normal, 3));
      result.setAttribute('uv', new Float32BufferAttribute(data.uv, 2));
      result.setIndex(data.indices);
      geometries.set(key, result);
    }
    return geometries.get(key);
  }

  function plane() {
    if (!geometries.has('unit-plane')) geometries.set('unit-plane', own(new PlaneGeometry(1, 1)));
    return geometries.get('unit-plane');
  }

  function additiveMaterial(vertexShader, fragmentShader, uniforms) {
    const material = own(
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader,
        fragmentShader: withEffectColor(fragmentShader),
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
        blendEquation: AddEquation,
      }),
    );
    material.userData.eveBloomEmission = true;
    return material;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const video of videos.values()) video.dispose();
    videos.clear();
    for (const resource of owned) resource.dispose();
    owned.clear();
    textures.clear();
    geometries.clear();
  }
  return { own, texture, geometry, plane, additiveMaterial, dispose, resolveURL, binaryURL,
    setPlaying(value) {playing=Boolean(value);for(const video of videos.values())video.setPlaying(playing);} };
}

const renderHooks = new WeakMap();

/** Multiple installers may unsubscribe in any order without restoring stale hooks. */
export function beforeSceneRender(scene, callback, {first=false, last=false, afterUpdates=false} = {}) {
  let state = renderHooks.get(scene);
  if (!state) {
    state = { previous: scene.onBeforeRender, callbacks: new Set(), finalCallbacks: new Set(), afterUpdates: new Set() };
    state.wrapper = function (renderer, currentScene, camera, ...args) {
      state.previous?.call(this, renderer, currentScene, camera, ...args);
      for (const update of state.callbacks) update(camera, renderer);
      for (const update of state.finalCallbacks) update(camera, renderer);
      for (const update of state.afterUpdates) update(camera,renderer);
    };
    scene.onBeforeRender = state.wrapper;
    renderHooks.set(scene, state);
  }
  if(afterUpdates)state.afterUpdates.add(callback);
  else if(last)state.finalCallbacks.add(callback);
  else if(first)state.callbacks=new Set([callback,...state.callbacks]);else state.callbacks.add(callback);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    state.callbacks.delete(callback);
    state.finalCallbacks.delete(callback);
    state.afterUpdates.delete(callback);
    if (!state.callbacks.size && !state.finalCallbacks.size && !state.afterUpdates.size) {
      if (scene.onBeforeRender === state.wrapper) scene.onBeforeRender = state.previous;
      renderHooks.delete(scene);
    }
  };
}
