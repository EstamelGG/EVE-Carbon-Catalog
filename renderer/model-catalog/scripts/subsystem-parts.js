import {effectsEnabled} from '../src/display-settings.mjs';
import { $scene,$renderer } from '@google/model-viewer/lib/model-viewer-base.js';
import {$loader} from '@google/model-viewer/lib/three-components/CachingGLTFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {subsystemDocument} from './shared-hull.js';
import { assembleGeometry, assembleEffects } from '../src/subsystem-assembly.mjs';
import { resourceURL } from '../src/resource-location.mjs';
import { loadArrayBuffer, trackResource } from '../src/resource-activity.mjs';
import { installNativePreview } from './native-viewer.js';
import { installShipEffects } from './ship-effects.js';
import { gltfDimensions } from './model-bounds.js';
import { replaceSubsystemRecords } from './subsystem-swap.mjs';

function effectViewer(viewer, document) {
  const local = { originalGltfJson: document, appearanceDocument: document, dataset: {} };
  return new Proxy(viewer, {
    get(target, key) {
      return Object.hasOwn(local, key) ? local[key] : Reflect.get(target, key, target);
    },
    set(_target, key, value) {
      local[key] = value;
      return true;
    },
    deleteProperty(_target, key) {
      delete local[key];
      return true;
    },
  });
}

async function parsePart(session, document, url,ktx2Loader) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader(ktx2Loader);
  loader.register((parser) => {
    const load = parser.loadBuffer.bind(parser),
      image = parser.loadTextureImage.bind(parser);
    parser.loadBuffer = (index) => {
      const buffer = parser.json.buffers[index];
      if (!buffer.uri) return load(index);
      const href = new URL(buffer.uri, url).href;
      return session.buffer(JSON.stringify([href, buffer.byteLength]), () =>
        loadArrayBuffer(href, undefined, 'resourceModel'),
      );
    };
    parser.loadTextureImage = (texture, index, textureLoader) => {
      const uri = parser.json.images[index]?.uri;
      return uri
        ? trackResource(
            new URL(uri, url).href,
            () => image(texture, index, textureLoader),
            'resourceTexture',
          )
        : image(texture, index, textureLoader);
    };
    return { name: 'EVE_subsystem_buffers' };
  });
  const parsed = await loader.parseAsync(JSON.stringify(document), new URL('.', url).href);
  for (const [object, association] of parsed.parser.associations)
    if (object.isTexture) object.userData.associations = association;
  return parsed;
}

function geometryDisposer(root) {
  const owned = new Set();
  root.traverse((mesh) => {
    if (mesh.geometry) owned.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      owned.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) owned.add(value);
    }
  });
  return () => {
    for (const resource of owned) resource.dispose();
    owned.clear();
  };
}

export async function installSubsystemParts(viewer, item, settings, installEffects = installShipEffects) {
  const scene = viewer[$scene],
    session = viewer.assetSession,
    records = [],
    roots = new Map();
  scene.model.traverse((root) => {
    if (Number.isInteger(root.userData.eveSubsystemSlot))
      roots.set(root.userData.eveSubsystemSlot, root);
  });
  if (roots.size !== 4) throw Error('Missing subsystem roots');
  let disposed = false,
    mode = 'cruise',
    flightMode = 'cruise',
    visible = effectsEnabled(viewer.displaySettings);
  const resolveURL = (url) => new URL((viewer.assetSession?.resolveURL || resourceURL)(url), location.href).href;
  function applyPlayback(effects) {
    effects.setMode?.(flightMode);
    if (mode === 'paused') effects.setMode?.(mode);
    effects.setVisible?.(visible);
  }
  async function prepare(part, slot, existingRoot = null) {
    let root = existingRoot,
      disposeGeometry,
      disposeNative,
      effects;
    try {
      const url = new URL(resolveURL(part.model));
      url.searchParams.set('v', part.modelRevision || 'material-options-v1');
      const [document, rawEffects] = await Promise.all([
        subsystemDocument(session,url.href,part),
        session.json(resolveURL(part.effects)),
      ]);
      const data = {
        ...part,
        slot,
        url: url.href,
        document,
        effects: rawEffects,
        offset: [0, 0, 0],
      };
      const geometry = assembleGeometry([data]);
      if (!root) {
        const parsed = await parsePart(session, geometry, url.href,viewer[$renderer].loader[$loader].ktx2Loader);
        root = parsed.scene.children[0];
        root.removeFromParent();
        disposeGeometry = geometryDisposer(root);
        root.position.fromArray(part.offset);
        if (settings)
          disposeNative = await installNativePreview(
            viewer,
            settings,
            url.href,
            item.id,
            item.dna,
            { root, document: geometry },
          );
      }
      const packed = part.appearance?rawEffects:await assembleEffects([data], (url) => session.json(url), resolveURL);
      const effectsURL = new URL(
        `__subsystem-effects/${item.id}-${slot}-${part.id}.json?v=${encodeURIComponent(part.modelRevision || '')}`,
        location.href,
      ).href;
      session.remember(effectsURL, packed);
      const context = effectViewer(viewer, geometry);
      effects = await installEffects(context, effectsURL, flightMode, { parent: root });
      // A slot can finish loading after visibility, flight or pause has changed.
      applyPlayback(effects);
      let released = false;
      return {
        part,
        data,
        root,
        context,
        effects,
        dispose() {
          if (released) return;
          released = true;
          effects.dispose();
          disposeNative?.();
          disposeGeometry?.();
        },
      };
    } catch (error) {
      effects?.dispose();
      disposeNative?.();
      disposeGeometry?.();
      throw error;
    }
  }
  const setKillCount = (count) => {
    for (const record of records) record.context.setKillCount?.(count);
  };
  const sync = () => {
    viewer.killMarkCount = records.reduce(
      (sum, record) => sum + (record.context.killMarkCount || 0),
      0,
    );
    viewer.setKillCount = setKillCount;
    viewer.dataset.effects = JSON.stringify(
      records.reduce(
        (sum, record) => {
          const counts = JSON.parse(record.context.dataset.effects || '{}');
          for (const key of ['sprites', 'boosters', 'planes']) sum[key] += counts[key] || 0;
          return sum;
        },
        { sprites: 0, boosters: 0, planes: 0 },
      ),
    );
    setKillCount(viewer.killCount);
    viewer.appearanceDocument = assembleGeometry(
      records.map((record) => ({ ...record.data, offset: record.part.offset })),
    );
    viewer.sourceDimensions = gltfDimensions(viewer.appearanceDocument);
    scene.model.updateWorldMatrix(true, true);
    scene.queueRender();
  };
  const api = {
    async replace(next, isCurrent) {
      const applied = await replaceSubsystemRecords(
        records,
        next.subsystemParts,
        prepare,
        () => !disposed && viewer.isConnected && isCurrent(),
        () => {
          if (viewer.lifecycle) viewer.lifecycle.release('disposeSubsystemLabels');
          else viewer.disposeSubsystemLabels?.();
        },
      );
      if (applied) {
        for (const record of records) applyPlayback(record.effects);
        sync();
      }
      return applied;
    },
    setVisible(value) {
      visible = value !== false;
      for (const record of records) record.effects.setVisible(value);
    },
    setMode(value) {
      mode = value;
      if (value !== 'paused') flightMode = value;
      for (const record of records) record.effects.setMode(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of records) record.dispose();
      if (viewer.setKillCount === setKillCount) {
        delete viewer.setKillCount;
        delete viewer.killMarkCount;
      }
      if (viewer.subsystemAssembly === api) delete viewer.subsystemAssembly;
    },
  };
  try {
    const results = await Promise.allSettled(
      item.subsystemParts.map((part, slot) => prepare(part, slot, roots.get(slot))),
    );
    for (const result of results) if (result.status === 'fulfilled') records.push(result.value);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    sync();
    viewer.subsystemAssembly = api;
    return api;
  } catch (error) {
    api.dispose();
    throw error;
  }
}
