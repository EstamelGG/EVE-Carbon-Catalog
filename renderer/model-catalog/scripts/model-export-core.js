import {BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, PropertyBinding, Vector3} from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

function visible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
function inEffects(object) {
  for (let node = object; node; node = node.parent) if (node.userData.eveEffects) return true;
  return false;
}
function standard(material) {
  return material && material.visible && material.colorWrite && !material.isShaderMaterial;
}
// Both exporters must respect material groups and the active draw range.
function ranges(mesh, accept) {
  const geometry = mesh.geometry;
  const count = geometry.index?.count ?? geometry.attributes.position.count;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = Array.isArray(mesh.material) ? geometry.groups : [{start:0, count, materialIndex:0}];
  return groups.flatMap(group => {
    const material = materials[group.materialIndex];
    const start = Math.max(group.start, geometry.drawRange.start);
    const end = Math.min(count, group.start + group.count, geometry.drawRange.start + geometry.drawRange.count);
    const length = Math.floor((end - start) / 3) * 3;
    return length > 0 && accept(material) ? [{start, count:length, material}] : [];
  });
}

export function exportOBJ(model) {
  model.updateWorldMatrix(true, true);
  const root = new Group(), material = new MeshBasicMaterial();
  const point = new Vector3();
  model.traverse(object => {
    if (!object.isMesh || !visible(object) || inEffects(object) || !object.geometry.attributes.position) return;
    const selected = ranges(object, standard);
    if (!selected.length || object.geometry.isInstancedBufferGeometry) return;
    object.skeleton?.update();
    const instanceCount = object.isInstancedMesh ? object.hangarSourceMatrices?.length??object.count : 1;
    for (let instance = 0; instance < instanceCount; instance++) {
      const transform = object.matrixWorld.clone();
      if (object.isInstancedMesh) {
        const local = new Matrix4();if(object.hangarSourceMatrices)local.copy(object.hangarSourceMatrices[instance]);else object.getMatrixAt(instance, local);transform.multiply(local);
      }
      const positions = [], indices = [], remap = new Map();
      const reflected = transform.determinant() < 0;
      for (const range of selected) for (let i = range.start; i < range.start + range.count; i += 3) {
        const triangle = [];
        for (let corner = 0; corner < 3; corner++) {
          const index = object.geometry.index?.getX(i + corner) ?? i + corner;
          if (!remap.has(index)) {
            object.getVertexPosition(index, point).applyMatrix4(transform);
            remap.set(index, positions.length / 3); positions.push(point.x, point.y, point.z);
          }
          triangle.push(remap.get(index));
        }
        if (reflected) [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
        indices.push(...triangle);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      const mesh = new Mesh(geometry, material);
      mesh.name = (object.name || 'Mesh').replace(/[\r\n]/g, ' ');
      root.add(mesh);
    }
  });
  if (!root.children.length) { material.dispose(); throw new Error('No exportable geometry'); }
  root.updateMatrixWorld(true);
  try { return new OBJExporter().parse(root); }
  finally { root.children.forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
}

export function prepareGLB(model, {animations = [], materialFor = material => material, lights = []} = {}) {
  model.updateWorldMatrix(true, true);
  const root = cloneSkeleton(model), copies = new Map(), geometries = [], materials = new Map();
  const pair = (source, copy) => {
    copies.set(source, copy);
    source.children.forEach((child, index) => pair(child, copy.children[index]));
  };
  pair(model, root);
  // Include the displayed transform without reparenting or touching the live model.
  model.matrixWorld.decompose(root.position, root.quaternion, root.scale);
  root.updateMatrix();
  let skipped = 0, meshCount = 0;
  for (const [source, copy] of copies) {
    if(source.hangarSourceMatrices){copy.count=source.hangarSourceMatrices.length;source.hangarSourceMatrices.forEach((matrix,i)=>copy.setMatrixAt(i,matrix));}
    copy.userData = {};
    if (source.isCamera || (source.isLight && !source.isPointLight && !source.isDirectionalLight && !source.isSpotLight)) {
      copy.removeFromParent(); continue;
    }
    if (source.isLight && !visible(source)) { copy.removeFromParent(); continue; }
    if (!source.isMesh && !source.isLine && !source.isPoints) continue;
    if (!visible(source)) { copy.removeFromParent(); continue; }
    const supported = material => standard(material) && standard(materialFor(material, source));
    if (!source.isMesh || source.geometry.isInstancedBufferGeometry) {
      // Shader-generated vertex layouts cannot be represented by standard glTF.
      copy.removeFromParent(); skipped++; continue;
    }
    const selected = ranges(source, supported);
    const original = Array.isArray(source.material) ? source.material : [source.material];
    if (original.some(material => !supported(material))) skipped++;
    if (!selected.length) { copy.removeFromParent(); continue; }
    const geometry = source.geometry.clone(), indices = [], selectedMaterials = [];
    geometry.clearGroups();
    for (const range of selected) {
      const fallback = materialFor(range.material, source);
      if (!materials.has(fallback)) {
        const material = fallback.clone();
        // Native shader metadata refers to external resources, not portable glTF material data.
        material.userData = {}; materials.set(fallback, material);
      }
      const start = indices.length;
      for (let i = range.start; i < range.start + range.count; i++) indices.push(source.geometry.index?.getX(i) ?? i);
      geometry.addGroup(start, range.count, selectedMaterials.length);
      selectedMaterials.push(materials.get(fallback));
    }
    geometry.setIndex(indices); geometry.setDrawRange(0, indices.length);
    copy.geometry = geometry; copy.material = selectedMaterials;
    geometries.push(geometry); meshCount++;
  }
  if (!meshCount) throw new Error('No exportable geometry');
  const scene = new Group(); scene.name = 'EVE model export'; scene.add(root);
  for (const source of lights) {
    if (!visible(source) || copies.has(source) || !(source.isPointLight || source.isSpotLight || source.isDirectionalLight)) continue;
    source.updateWorldMatrix(true, false);
    const light = source.clone(false);
    source.matrixWorld.decompose(light.position, light.quaternion, light.scale);
    if (source.target) {
      const target = source.target.getWorldPosition(new Vector3());
      light.quaternion.setFromRotationMatrix(new Matrix4().lookAt(light.position, target, source.up));
      light.target = new Group(); light.target.position.set(0, 0, -1); light.add(light.target);
    }
    scene.add(light);
  }
  const clips = animations.flatMap(animation => {
    const clip = animation.clone();
    clip.tracks = clip.tracks.flatMap(track => {
      const binding = PropertyBinding.parseTrackName(track.name);
      const source = PropertyBinding.findNode(model, binding.nodeName);
      const copy = copies.get(source);
      if (!copy || (!copy.parent && copy !== root)) return [];
      track.name = binding.nodeName ? track.name.replace(binding.nodeName, copy.uuid) : copy.uuid + track.name;
      return [track];
    });
    return clip.tracks.length ? [clip] : [];
  });
  scene.userData.exportNotes = {excludedEffectObjects:skipped, materials:'Standard glTF materials; native shaders and postprocessing are not included.'};
  scene.updateMatrixWorld(true);
  return {scene, clips, skipped, dispose() {
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }};
}

export async function exportGLB(model, options = {}) {
  const snapshot = prepareGLB(model, options);
  try {
    const exporter = new GLTFExporter();
    if (options.textureUtils) exporter.setTextureUtils(options.textureUtils);
    const data = await exporter.parseAsync(snapshot.scene, {binary:true, onlyVisible:false, animations:snapshot.clips});
    return {data, skipped:snapshot.skipped};
  } finally { snapshot.dispose(); }
}
