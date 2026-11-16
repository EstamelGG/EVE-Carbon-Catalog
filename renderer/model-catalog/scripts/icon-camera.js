import { $scene } from '@google/model-viewer/lib/model-viewer-base.js';
import { Vector3 } from 'three';

// Screenshot framing uses posed, drawn hull vertices. Ambient effects should
// never shrink the hull merely because a flare or particle travels far away.
export async function frameIcon(viewer, {azimuth, polar, fov, fill = 0.9} = {}) {
  if (!(fill > 0 && fill < 1)) throw Error('Icon fill must be between zero and one');
  const initial = viewer.getCameraOrbit();
  const standardView = !viewer.equipmentPreview;
  azimuth ??= standardView ? 25 : initial.theta * 180 / Math.PI;
  polar ??= standardView ? 65 : initial.phi * 180 / Math.PI;
  fov ??= standardView ? 25 : viewer.getFieldOfView();
  if (!Number.isFinite(azimuth) || !(polar > 0 && polar < 180)) throw Error('Invalid icon orbit');
  const center = viewer.getBoundingBoxCenter();
  if (fov !== undefined) {
    if (!(fov > 0 && fov < 180)) throw Error('Invalid icon field of view');
    viewer.setAttribute('min-field-of-view', `${Math.min(8,fov)}deg`);
    viewer.setAttribute('max-field-of-view', `${Math.max(60,fov)}deg`);
    viewer.fieldOfView = `${fov}deg`;
  }
  viewer.setAttribute('min-camera-orbit', `auto auto ${initial.radius * 0.001}m`);
  viewer.setAttribute('max-camera-orbit', `auto auto ${initial.radius * 3}m`);
  viewer.cameraTarget = `${center.x}m ${center.y}m ${center.z}m`;
  viewer.cameraOrbit = `${azimuth}deg ${polar}deg ${initial.radius}m`;
  await viewer.updateComplete;
  viewer.jumpCameraToGoal();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const scene = viewer[$scene], camera = scene.getCamera();
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const point = new Vector3(), points = [];
  scene.model.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    for (let node = mesh; node; node = node.parent) {
      if (!node.visible || node.userData.eveEffects) return;
      if (node === scene.model) break;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every(material => !material.visible || !material.colorWrite)) return;
    mesh.skeleton?.update();
    const {index, attributes, drawRange} = mesh.geometry;
    const end = Math.min(index?.count ?? attributes.position.count, drawRange.start + drawRange.count);
    const visited = new Set();
    for (let i = drawRange.start; i < end; i++) {
      const vertex = index ? index.getX(i) : i;
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      mesh.getVertexPosition(vertex, point);
      point.applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if (![point.x,point.y,point.z].every(Number.isFinite)) throw Error('Invalid hull vertex for icon framing');
      points.push([point.x, point.y, point.z]);
    }
  });
  if (!points.length) throw Error('No visible hull vertices for icon framing');
  const before = viewer.getCameraOrbit().radius;
  const tanY = Math.tan(camera.fov * Math.PI / 360), tanX = tanY * camera.aspect;
  function targetRange(distance) {
    let left = -Infinity, right = Infinity, bottom = -Infinity, top = Infinity;
    for (const [x,y,z] of points) {
      const depth = distance - before - z;
      left = Math.max(left, x - depth * fill * tanX);
      right = Math.min(right, x + depth * fill * tanX);
      bottom = Math.max(bottom, y - depth * fill * tanY);
      top = Math.min(top, y + depth * fill * tanY);
    }
    return {left, right, bottom, top, fits:left <= right && bottom <= top};
  }
  let near = 0;
  for (const point of points) near = Math.max(near, before + point[2]);
  near += Math.max(before * 0.00001, 0.000001);
  let distance = near;
  for (const [x,y,z] of points)
    distance = Math.max(distance, before + z + Math.max(Math.abs(x) / (fill * tanX), Math.abs(y) / (fill * tanY)));
  if (!Number.isFinite(distance)) throw Error('Invalid icon framing distance');
  for (let step = 0; step < 32; step++) {
    const middle = (near + distance) / 2;
    if (targetRange(middle).fits) distance = middle;
    else near = middle;
  }
  if (!Number.isFinite(distance) || distance <= 0) throw Error('Invalid icon framing distance');
  const range = targetRange(distance);
  function centeredOffset(axis, low, high) {
    for (let step = 0; step < 20; step++) {
      const middle = (low + high) / 2;
      let minimum = Infinity, maximum = -Infinity;
      for (const point of points) {
        const projected = (point[axis] - middle) / (distance - before - point[2]);
        minimum = Math.min(minimum, projected);
        maximum = Math.max(maximum, projected);
      }
      if (minimum + maximum > 0) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }
  const delta = new Vector3(centeredOffset(0,range.left,range.right), centeredOffset(1,range.bottom,range.top), 0)
    .applyMatrix4(camera.matrixWorld).sub(camera.getWorldPosition(new Vector3()));
  const inverseTarget = scene.target.parent.matrixWorld.clone().invert();
  delta.applyMatrix4(inverseTarget).sub(new Vector3().applyMatrix4(inverseTarget));
  viewer.cameraTarget = `${center.x + delta.x}m ${center.y + delta.y}m ${center.z + delta.z}m`;
  // Allow the fitted distance while retaining finite clipping planes.
  viewer.setAttribute('max-camera-orbit', `auto auto ${Math.max(initial.radius * 3, distance * 2)}m`);
  viewer.cameraOrbit = `${azimuth}deg ${polar}deg ${distance}m`;
  await viewer.updateComplete;
  viewer.jumpCameraToGoal();
  return {azimuth, polar, fov:camera.fov, fill, distance, vertices:points.length};
}

export async function renderIcon(viewer, options) {
  const scene = viewer[$scene], model = scene.model;
  const visible = model.visible, background = scene.background, skies = [];
  scene.traverse(node => { if (node.name === 'EVE background') skies.push([node,node.visible]); });
  const frame = async () => {
    scene.queueRender();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return createImageBitmap(await viewer.toBlob({mimeType:'image/png'}));
  };
  let backdrop, foreground;
  try {
    model.visible = false;
    backdrop = await frame();
    model.visible = visible;
    const framing = await frameIcon(viewer, options);
    for (const [sky] of skies) sky.visible = false;
    scene.background = null;
    foreground = await frame();
    const canvas = document.createElement('canvas');
    canvas.width = foreground.width;
    canvas.height = foreground.height;
    const context = canvas.getContext('2d');
    context.drawImage(backdrop,0,0,canvas.width,canvas.height);
    context.drawImage(foreground,0,0);
    const image = await new Promise((resolve,reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(Error('Icon PNG export failed')), 'image/png'));
    return {image, framing};
  } finally {
    model.visible = visible;
    scene.background = background;
    for (const [sky,state] of skies) sky.visible = state;
    backdrop?.close();
    foreground?.close();
    scene.queueRender();
  }
}
