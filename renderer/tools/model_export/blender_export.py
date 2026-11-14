"""Blender worker. No global add-on installation, online service or atlas bake."""
from pathlib import Path
import sys
import hashlib
from contextlib import nullcontext
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cache_compat import fingerprint
import bpy
import numpy as np
from mathutils import Vector
from core import read_json, write_json, inside, png_size, DEPENDENCY_REVISION
from pixels import write_png, grid, sample_repeat
from source_texture import decode_2d_png
from glb import audit
from gltf_skin_tangents import coherent_skin_tangents
from materials import build_portable
from conversion_cache import ConversionCache, material_recipe
from surface_passes import split_surface_passes, OVERLAY_PROFILE, overlay_profile


def uv_array(mesh):
    values = np.empty(len(mesh.loops) * 2, np.float32)
    mesh.uv_layers['UV0'].data.foreach_get('uv', values)
    return values


def studio(obj):
    scene = bpy.context.scene
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    center, radius = (lo + hi) / 2, (hi - lo).length / 2
    bpy.ops.object.camera_add(location=center + Vector((1.3, -1.7, 1.1)).normalized() * radius * 3.4)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.clip_end, camera.data.lens = radius * 30, 50
    scene.camera = camera
    for direction, power, size in [((1, -1, 2), 1500, 1.8), ((-1, -.5, 1), 900, 1.6), ((0, 2, 1), 1800, 1.2)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(direction) * radius * 2)
        light = bpy.context.object
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
        light.data.energy, light.data.shape, light.data.size = power * radius * radius * .08, 'DISK', radius * size
    scene.world.color = (.12, .12, .12)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.render.resolution_x, scene.render.resolution_y = 1100, 850
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'


def export_obj(obj, path, reports, output):
    # OBJ has one UV stream. On sail faces only, fold the extra crop coordinates
    # into a temporary mesh and crop normal/emission too. GLB and Blend keep UV0.
    duplicate = obj.copy()
    duplicate.data = obj.data.copy()
    bpy.context.collection.objects.link(duplicate)
    for index, report in reports.items():
        if 'sail_crop' not in report:
            continue
        crop = report['sail_crop']
        mesh = duplicate.data
        for polygon in mesh.polygons:
            if index <= polygon.material_index < index + report['count']:
                for loop in polygon.loop_indices:
                    mesh.uv_layers['UV0'].data[loop].uv = mesh.uv_layers[crop['uv']].data[loop].uv
        mat = mesh.materials[index].copy()
        for slot in range(index, index + report['count']):
            mesh.materials[slot] = mat
        for node in mat.node_tree.nodes:
            if node.type != 'TEX_IMAGE':
                continue
            linked_uv = node.inputs['Vector'].links[0].from_node
            if linked_uv.uv_map != 'UV0':
                linked_uv.uv_map = 'UV0'
                continue
            image = node.image.copy()
            image.colorspace_settings.name = 'Non-Color'
            pixels = np.empty(len(image.pixels), np.float32)
            image.pixels.foreach_get(pixels)
            pixels = pixels.reshape(image.size[1], image.size[0], 4)
            values = sample_repeat(pixels, *grid(crop['size'], crop['source_domain']))
            target = output / 'textures' / ('obj_crop_' + node.image.name)
            write_png(target, values)
            cropped = bpy.data.images.load(str(target), check_existing=False)
            cropped.colorspace_settings.name = node.image.colorspace_settings.name
            node.image = cropped
            bpy.data.images.remove(image)
    for uv in list(duplicate.data.uv_layers):
        if uv.name != 'UV0':
            duplicate.data.uv_layers.remove(uv)
    bpy.ops.object.select_all(action='DESELECT')
    duplicate.select_set(True)
    bpy.context.view_layer.objects.active = duplicate
    bpy.ops.wm.obj_export(filepath=str(path), export_selected_objects=True, export_materials=True,
                          path_mode='RELATIVE', forward_axis='NEGATIVE_Z', up_axis='Y')
    # OBJ's legacy MTL supports map_Ks, while Blender ignores Specular Tint.
    mtl = path.with_suffix('.mtl')
    lines, index = [], None
    for line in mtl.read_text().splitlines():
        if line.startswith('newmtl area'):
            index = int(line.split('area', 1)[1].split('.')[0].split('_')[0])
        if line.startswith('Ks ') and index is not None:
            lines.extend(['Ks 1.000000 1.000000 1.000000', 'map_Ks ../textures/area%d_f0.png' % index])
        else:
            lines.append(line)
    mtl.write_text('\n'.join(lines) + '\n')
    bpy.data.objects.remove(duplicate, do_unlink=True)


def main():
    config = read_json(sys.argv[sys.argv.index('--') + 1])
    output, addon = Path(config['output']), Path(config['addon'])
    sys.path.insert(0, str(addon / 'addons'))
    for package in (addon / 'packages').iterdir():
        if (package / 'src').is_dir():
            sys.path.insert(0, str(package / 'src'))
    from hull_tangent_frames import read_hull_gr2
    from carbon_eve_resources.gr2_importer.addon import import_meshes
    data = read_json(output / 'default-materials.json')
    manifest = read_json(output / 'source-manifest.json')
    for folder in ('textures', 'source-textures', 'converted'):
        (output / folder).mkdir()
    report = dict(version=config['version'], dependency_revision=DEPENDENCY_REVISION, blender=bpy.app.version_string,
                  dna=data.get('dna'), typeID=data.get('typeID'), warnings=[], source_textures=[], areas=[], glb=[])
    cache = ConversionCache(config['conversion_cache']) if config.get('conversion_cache') else None
    profile = dict(blender=bpy.app.version_string, dependency=DEPENDENCY_REVISION,
                   scripts={name: fingerprint(Path(__file__).parent / name)
                            for name in ('materials.py', 'pixels.py', 'surface_policy.py', 'source_texture.py', 'conversion_cache.py', 'blender_export.py')})
    # Both build code and shared art policy participate in cache invalidation.
    from surface_policy import POLICY_PATH
    profile['materialPolicy'] = fingerprint(POLICY_PATH)
    source_records = {r['resource'].lower(): r for r in manifest['files']}
    resources, source_images = {}, {}
    for record in manifest['files']:
        resource, path = record['resource'], inside(output, record['extracted'])
        resources[resource] = str(path)
        if 'dds' not in record:
            continue
        dds = record['dds']
        entry = dict(resource=resource, source_width=dds['width'], source_height=dds['height'])
        if dds['volume'] or dds['cubemap'] or dds.get('arraySize', 1) > 1:
            entry['status'] = 'raw DDS preserved; non-2D texture not flattened'
            report['source_textures'].append(entry)
            continue
        target = output / 'source-textures' / (path.stem + '.png')
        decode_recipe = dict(kind='dds-decode', profile=profile, resource=resource.lower(), md5=record['md5'], dds=dds)
        with cache.lock(decode_recipe) if cache else nullcontext():
            hit = cache.restore(decode_recipe, {'image': target}) if cache else None
            if hit is not None:
                print('DDS_CACHE_HIT', resource, flush=True)
            else:
                target.write_bytes(decode_2d_png(path, (dds['width'], dds['height'])))
                if cache:
                    cache.store(decode_recipe, {'image': target}, {})
        if png_size(target) != (dds['width'], dds['height']):
            raise ValueError('PNG dimensions do not match original DDS')
        source_images[resource.lower()] = target
        resources[resource] = str(target)
        entry.update(file=str(target.relative_to(output)).replace('\\', '/'), width=dds['width'], height=dds['height'], status='original top mip; RGBA; no resize')
        report['source_textures'].append(entry)
    print('SOURCE_TEXTURES_VERIFIED', len(source_images), flush=True)
    graph = read_hull_gr2(inside(output, next(f['extracted'] for f in manifest['files'] if f['resource'].lower() == data['geometry'].lower())))
    mesh_index = data.get('meshIndex', 0)
    graph['meshes'] = [graph['meshes'][mesh_index]]
    print('GEOMETRY_PARSED', mesh_index, flush=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    collection = bpy.data.collections.new(config['name'])
    bpy.context.scene.collection.children.link(collection)
    from carbon_eve_resources.gr2_importer import addon as importer
    from mesh_safety import safe_mesh_import
    areas, overlays = split_surface_passes(data['areas'])
    visible_slots = {i for a in areas for i in range(a['index'], a['index'] + a['count'])}
    with safe_mesh_import(importer, visible_slots) as mesh_cleanup:
        pairs = import_meshes(graph, collection, instance_name=config['name'], scale=1, rot_x_deg=90,
                              use_smoothing_groups=False, smoothing_angle_deg=60, flip_uv_v=True,
                              skip_lods=False, try_unpack_tangents=True)
    report['meshCleanup'] = mesh_cleanup
    if len(pairs) != 1:
        raise ValueError('Expected one static hull; assembly export is not supported')
    obj = pairs[0][0]
    armature=None;actions=[]
    if config.get('animated'):
        from carbon_eve_resources.gr2_importer.addon import import_armature,apply_skinning,import_animations,import_morph_animations
        armature,arm_info=import_armature(graph,collection,instance_name=config['name'],scale=1,rot_x_deg=90,bone_tail_mode='LOCAL_Y')
        if armature:
            apply_skinning(obj,pairs[0][1],armature)
            from animation_batch import import_animations_batched
            actions=import_animations_batched(importer,graph,armature,arm_info,instance_name=config['name'],resample=True,
                max_keys_per_bone=0,action_length_mode='DURATION',clamp_keys_to_duration=True,action_end_padding_frames=0)
        actions+=import_morph_animations(graph,pairs,config['name'],clamp_keys_to_duration=True,
            action_length_mode='DURATION',action_end_padding_frames=0)
        for action in actions:action.use_fake_user=True
        report['animationClips']=[dict(name=a.get('carbon_animation_clip',a.name),frames=list(a.frame_range)) for a in actions]
        report['bonePalette']=[b.get('name','') for b in pairs[0][1].get('boneBindings',[])]
    print('GEOMETRY_IMPORTED', flush=True)
    mesh = obj.data
    original_faces = len(mesh.polygons)
    mesh.validate(clean_customdata=False)
    mesh.update()
    source_uv = uv_array(mesh)
    from carbon_eve_resources import ship
    ship.store_rest_position(obj)
    # Discard depth/decal passes only when already covered by a surface pass.
    areas, overlays = split_surface_passes(data['areas'])
    if overlays:
        if not config.get('runtime_materials'):
            raise ValueError('Hull overlays require the runtime material export path')
        if any(overlay_profile(a) == OVERLAY_PROFILE for a in overlays) and data.get('sourceRadius', 0) <= 0:
            raise ValueError('Hull overlays need sourceRadius; recapture source metadata')
        report['surfaceOverlayProfile'] = OVERLAY_PROFILE
        report['surfaceOverlays'] = overlays
    projections = bool(config.get('runtime_materials') and data.get('customMasks'))
    if overlays or projections:
        # glTF converts ordinary POSITION axes. Keep native rest coordinates in
        # a custom attribute for the original directional projection formula.
        source_position = mesh.attributes.new('_CCP_SOURCE_POSITION', 'FLOAT_VECTOR', 'POINT')
        for value, vertex in zip(source_position.data, mesh.vertices):
            value.vector = vertex.co
    used_slots = {p.material_index for p in mesh.polygons}
    covered = set()
    for a in areas:
        slots = set(range(a['index'], a['index'] + a['count']))
        if covered & slots:
            raise ValueError('Overlapping surface passes require explicit compositing')
        covered.update(slots)
    if used_slots - covered:
        raise ValueError('Material capture does not cover mesh slots: ' + str(used_slots - covered))
    if any('quaddetail' in a['effect'].lower() for a in areas):
        report['warnings'].append('quaddetail overlay is not fully reproduced; original detail maps and parameters retained')
    if data.get('customMasks') and not projections:
        report['warnings'].append('Projected pattern nodes retained in native.blend; portable output (if requested) explicitly omits projected patterns')
    report['warnings'].append('Hull only; no turrets/children/decals; original BRDF and heat states are approximated' if config.get('animated') else 'Static hull only; no turrets/children/decals/animation; original BRDF, heat states, dirt and angle-dependent color shifts are approximated')
    if any(a['kind'] != 'opaqueAreas' for a in areas):
        report['warnings'].append('Portable transparent/additive surface passes are approximated as opaque PBR')
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    studio(obj)
    if 'blend' in config['formats']:
        from carbon_eve_resources.quad.materials import build_area_material
        from carbon_eve_resources.quad.interface import load_family
        family, effects = load_family(), []
        for area in areas:
            fx = dict(effectFilePath=area['effect'], constParameters=[dict(name=k, value=v) for k, v in area['parameters'].items()],
                      resources=[dict(name=k, resourcePath=v) for k, v in area['textures'].items()])
            effects.append(fx)
            material, error = build_area_material(dict(name='native_area%d' % area['index'], effect=fx), family, resources, area['index'])
            if material is None:
                raise ValueError(error)
            for slot in range(area['index'], area['index'] + area['count']):
                mesh.materials[slot] = material
            for node in list(material.node_tree.nodes):
                if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
                    uv = material.node_tree.nodes.new('ShaderNodeUVMap')
                    uv.uv_map = 'UV0'
                    material.node_tree.links.new(uv.outputs['UV'], node.inputs['Vector'])
        ship.apply_ship_globals([obj])
        ship.apply_custom_masks(obj, data.get('customMasks', []), effects)
        for i, mask in enumerate(data.get('customMasks', [])):
            obj['carbon_mask%d_wrap' % i] = (float(mask['clampU']), float(mask['clampV']), 0.)
        ship.drive_ship_sockets([obj], obj)
        for image in bpy.data.images:
            if image.has_data and image.source == 'FILE':
                image.pack()
        bpy.ops.wm.save_as_mainfile(filepath=str(output / 'converted' / (config['name'] + '-native.blend')))
    portable = any(f in config['formats'] for f in ('glb', 'obj'))
    if portable:
        primary, alternate, area_reports = {}, {}, {}
        for area in areas:
            item = dict(index=area['index'], count=area['count'], effect=area['effect'])
            recipe = material_recipe(area, source_records, profile) if cache else None
            mat, mr = build_portable(obj, area, source_images, output, item, cache=cache, recipe=recipe,
                                     runtime=config.get('runtime_materials', False))
            for slot in range(area['index'], area['index'] + area['count']):
                primary[slot], alternate[slot] = mat, mr
                mesh.materials[slot] = mat
            area_reports[area['index']] = item
            report['areas'].append(item)
            print('AREA_COMPLETE', area['index'], flush=True)
        mesh.uv_layers.active_index = mesh.uv_layers.find('UV0')
        mesh.uv_layers['UV0'].active_render = True
        if 'obj' in config['formats']:
            export_obj(obj, output / 'converted' / (config['name'] + '.obj'), area_reports, output)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        if armature:armature.select_set(True)
        bpy.context.view_layer.objects.active = obj
        if 'glb' in config['formats']:
            variants = [('-metalrough', alternate)] if config.get('metalrough_only') else [('', primary), ('-metalrough', alternate)]
            for suffix, mapping in variants:
                for slot, mat in mapping.items():
                    mesh.materials[slot] = mat
                path = output / 'converted' / (config['name'] + suffix + '.glb')
                with coherent_skin_tangents() if armature else nullcontext():
                    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                        export_animations=bool(config.get('animated')), export_skins=bool(config.get('animated')),
                        export_morph=bool(config.get('animated')), export_animation_mode='ACTIONS', export_tangents=True,
                        export_image_format='AUTO', export_attributes=bool(overlays or projections))
                report['glb'].append(audit(path, area_reports, bool(suffix)))
        for slot, mat in primary.items():
            mesh.materials[slot] = mat
        if 'blend' in config['formats']:
            for image in bpy.data.images:
                if image.has_data and image.source == 'FILE':
                    image.pack()
            bpy.ops.wm.save_as_mainfile(filepath=str(output / 'converted' / (config['name'] + '.blend')))
    if not np.array_equal(source_uv, uv_array(mesh)):
        raise ValueError('Original UV0 was modified')
    mesh.calc_loop_triangles()
    report.update(vertices=len(mesh.vertices), triangles=len(mesh.loop_triangles), original_faces=original_faces,
                  removed_invalid_faces=original_faces - len(mesh.polygons), original_uv_unchanged=True,
                  uv_loop_count=len(mesh.loops), custom_normals=mesh.has_custom_normals,
                  resolution_policy='Source PNG dimensions == original DDS top mip; independent axes/channels; no whole-hull bake',
                  limitations='Resolution preservation does not imply identical shader/lighting or recovery of missing source detail')
    if config['preview']:
        scene.render.filepath = str(output / 'preview.png')
        bpy.ops.render.render(write_still=True)
    write_json(output / 'conversion-report.json', report)
    print('EXPORT_COMPLETE', config['name'], flush=True)


if __name__ == '__main__':
    main()
