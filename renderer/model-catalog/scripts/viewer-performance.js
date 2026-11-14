// Inspect resources by identity: shared buffers/materials/textures count once.
export function sceneResources(scenes) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    buffers = new Set();
  const objects = [];
  let geometryBytes = 0;
  const addTexture = (value) => {
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(addTexture);
  };
  for (const scene of scenes) {
    addTexture(scene.environment);
    addTexture(scene.background);
    scene.traverse((object) => {
      const geometry = object.geometry;
      if (geometry && !geometries.has(geometry)) {
        geometries.add(geometry);
        for (const attribute of [
          geometry.index,
          ...Object.values(geometry.attributes),
          ...Object.values(geometry.morphAttributes || {}).flat(),
        ]) {
          const array = attribute?.isInterleavedBufferAttribute
            ? attribute.data.array
            : attribute?.array;
          if (array && !buffers.has(array)) {
            buffers.add(array);
            geometryBytes += array.byteLength;
          }
        }
      }
      const list = (Array.isArray(object.material) ? object.material : [object.material]).filter(
        Boolean,
      );
      for (const material of list) {
        if (materials.has(material)) continue;
        materials.add(material);
        Object.values(material).forEach(addTexture);
        Object.values(material.uniforms || {}).forEach((uniform) => addTexture(uniform?.value));
      }
      if (!geometry) return;
      let visible = true;
      for (let parent = object; parent; parent = parent.parent)
        if (!parent.visible) visible = false;
      objects.push({
        name: object.name || object.type,
        type: object.type,
        visible,
        instances: object.isInstancedMesh ? object.count : 1,
        vertices: geometry.attributes.position?.count || 0,
        triangles: object.isMesh
          ? Math.floor((geometry.index?.count || geometry.attributes.position?.count || 0) / 3)
          : 0,
        materials: list.map((m) => m.name || m.type),
        geometry: geometry.uuid,
      });
    });
  }
  const textureList = [...textures].map((texture) => {
    const images = Array.isArray(texture.image) ? texture.image : [texture.image];
    const image = images[0] || {};
    // RGBA8 base + mip chain estimate. Compressed mip payloads use actual bytes.
    const compressedBytes = (texture.mipmaps || []).reduce(
      (sum, mip) => sum + (mip.data?.byteLength || 0),
      0,
    );
    const estimatedBytes = texture.isCompressedTexture
      ? compressedBytes || null
      : image.width && image.height
        ? Math.round(
            image.width *
              image.height *
              (image.depth || 1) *
              images.length *
              4 *
              (texture.generateMipmaps ? 4 / 3 : 1),
          )
        : null;
    return {
      name: texture.name || texture.uuid,
      width: image.width || null,
      height: image.height || null,
      faces: images.length,
      compressed: !!texture.isCompressedTexture,
      estimatedBytes,
    };
  });
  return {
    objects: objects.length,
    visibleObjects: objects.filter((o) => o.visible).length,
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
    geometryBytes,
    estimatedTextureBytes: textureList.reduce((sum, t) => sum + (t.estimatedBytes || 0), 0),
    unknownTextureSizes: textureList.filter((t) => t.estimatedBytes === null).length,
    geometryList: [...geometries].map((g) => ({
      id: g.uuid,
      name: g.name,
      vertices: g.attributes.position?.count || 0,
      indices: g.index?.count || 0,
      groups: g.groups.length,
      drawRange: {
        start: g.drawRange.start,
        count: Number.isFinite(g.drawRange.count) ? g.drawRange.count : 'all',
      },
      bufferBytes: [
        ...new Set(
          [
            g.index,
            ...Object.values(g.attributes),
            ...Object.values(g.morphAttributes || {}).flat(),
          ]
            .map((a) => (a?.isInterleavedBufferAttribute ? a.data.array : a?.array))
            .filter(Boolean),
        ),
      ].reduce((sum, a) => sum + a.byteLength, 0),
    })),
    objectList: objects,
    materialList: [...materials].map((m) => ({
      name: m.name || m.uuid,
      type: m.type,
      transparent: m.transparent,
      opacity: m.opacity,
      side: m.side,
    })),
    textureList,
  };
}

// Count at info.update, so resets between postprocessing passes cannot erase draws.
// One observer per open diagnostics panel; restore the renderer on close.
const observers = new WeakMap();
export function observeRenderer(renderer, now = () => performance.now()) {
  const existing = observers.get(renderer);
  if (existing) {
    existing.references++;
    return existing.handle();
  }
  const shared = { references: 1 };
  observers.set(renderer, shared);
  const native = renderer.threeRenderer,
    info = native.info;
  const originalRender = renderer.render,
    originalUpdate = info.update;
  let active,
    samples = [],
    lastFrame = null;
  info.update = function (...args) {
    const before = { ...info.render };
    const result = originalUpdate.apply(this, args);
    if (active)
      for (const key of ['calls', 'triangles', 'lines', 'points'])
        active[key] += info.render[key] - before[key];
    return result;
  };
  renderer.render = function (...args) {
    const start = now();
    const counts = [...renderer.scenes].map((scene) => [scene, scene.renderCount]);
    active = { calls: 0, triangles: 0, lines: 0, points: 0 };
    try {
      return originalRender.apply(this, args);
    } finally {
      if (counts.some(([scene, count]) => scene.renderCount !== count)) {
        lastFrame = { ...active, cpuSubmitMs: now() - start, timestamp: now() };
        samples.push(lastFrame);
      }
      active = null;
    }
  };
  const observation = {
    sample() {
      const time = now();
      samples = samples.filter((frame) => time - frame.timestamp < 2000);
      const average = (key) =>
        samples.length
          ? samples.reduce((sum, frame) => sum + frame[key], 0) / samples.length
          : null;
      return {
        windowMs: 2000,
        renderedFrames: samples.length,
        fps: samples.length / 2,
        averageCpuSubmitMs: average('cpuSubmitMs'),
        averageDrawCalls: average('calls'),
        averageTriangles: average('triangles'),
        averageLines: average('lines'),
        averagePoints: average('points'),
        lastFrame,
        idle: !samples.length,
      };
    },
    dispose() {
      renderer.render = originalRender;
      info.update = originalUpdate;
      observers.delete(renderer);
    },
  };
  shared.handle = () => {
    let disposed = false;
    return {
      sample: observation.sample,
      dispose() {
        if (disposed) return;
        disposed = true;
        if (--shared.references === 0) observation.dispose();
      },
    };
  };
  return shared.handle();
}
