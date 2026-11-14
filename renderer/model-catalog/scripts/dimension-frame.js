import { Matrix4, Vector3 } from 'three';
import { beforeSceneRender } from './effect-resources.js';

export const dimensionAxisColors = ['#f07878', '#76d99a', '#76adff'];

// Use the hull's world rotation as well as the camera: turntable auto-rotation
// changes the model orientation without changing the public camera orbit.
export function dimensionFramePoints(modelMatrix, viewMatrix, dimensions) {
  const sizes = [dimensions.x, dimensions.y, dimensions.z];
  const longest = Math.max(...sizes);
  if (sizes.some(size => !Number.isFinite(size) || size < 0) || longest <= 0)
    throw new Error('Invalid dimension frame bounds');
  // One uniform scale preserves even very thin hulls without enlarging axes.
  const [x, y, z] = sizes.map(size => size / longest);
  const rotation = new Matrix4().extractRotation(modelMatrix);
  rotation.premultiply(new Matrix4().extractRotation(viewMatrix));
  return Array.from({length:8}, (_, i) => new Vector3(
    i & 1 ? x : -x, i & 2 ? y : -y, i & 4 ? z : -z,
  ).applyMatrix4(rotation));
}

export function dimensionFrameAxes(points) {
  return dimensionAxisColors.map((color, axis) => ({
    axis, color,
    direction: points[1 << axis].clone().sub(points[0]).multiplyScalar(0.5),
  }));
}

export function installDimensionFrame(scene, canvas, dimensions) {
  const context = canvas.getContext('2d');
  let previous = '';
  const draw = camera => {
    if (!scene.model) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const points = dimensionFramePoints(scene.model.matrixWorld, camera.matrixWorldInverse, dimensions);
    const key = `${ratio}:${points.map(p => p.toArray().join(',')).join(';')}`;
    if (key === previous) return;
    previous = key;
    const width = 76, height = 66, scale = 21;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const axes = dimensionFrameAxes(points).sort((a,b) => a.direction.z - b.direction.z);
    const ox = width / 2, oy = height / 2;
    for (const {color, direction} of axes) {
      const dx = direction.x * scale, dy = -direction.y * scale;
      const length = Math.hypot(dx, dy);
      const ux = length ? dx / length : 0, uy = length ? dy / length : 0;
      const head = Math.min(5, length * 0.35);
      const x = ox + dx, y = oy + dy;
      context.strokeStyle = color;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(ox, oy);
      context.lineTo(x, y);
      context.moveTo(x - ux * head - uy * head * 0.55, y - uy * head + ux * head * 0.55);
      context.lineTo(x, y);
      context.lineTo(x - ux * head + uy * head * 0.55, y - uy * head - ux * head * 0.55);
      context.stroke();
    }
    context.fillStyle = '#b8c3cb';
    context.fillRect(ox - 1.5, oy - 1.5, 3, 3);
    context.font = '9px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const placed = [];
    for (const {axis, color, direction} of axes) {
      const dx = direction.x, dy = -direction.y;
      const distance = Math.hypot(dx, dy);
      const ux = distance > 0.00001 ? dx / distance : Math.cos(axis * 2.1);
      const uy = distance > 0.00001 ? dy / distance : Math.sin(axis * 2.1);
      const x = Math.max(8, Math.min(width - 8, ox + dx * scale + ux * 11));
      let y = Math.max(8, Math.min(height - 8, oy + dy * scale + uy * 11));
      for (const previous of placed) {
        if (Math.abs(x - previous.x) < 14 && Math.abs(y - previous.y) < 14)
          y = previous.y + 14 <= height - 8 ? previous.y + 14 : previous.y - 14;
      }
      placed.push({x,y});
      context.fillStyle = color;
      context.fillText(['X','Y','Z'][axis], x, y);
    }
  };
  draw(scene.getCamera());
  const unsubscribe = beforeSceneRender(scene, draw);
  return () => {
    unsubscribe();
    context.clearRect(0, 0, canvas.width, canvas.height);
  };
}
