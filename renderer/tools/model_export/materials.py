# SOURCE AUDIT 2026-11-11 [B05/M01-M03]: Palette/paint, normals and glow reviewed in segments 10, 11 and 78. Portable roughness and specular encoding reviewed in segment 105.
# See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
# Reference: https://github.com/carbonenginejs/tools-blender/blob/a4e0e709ac3dc80bd83846ed26f687757a154c48/addons/carbon_eve_resources/quad/reference.py
"""Portable per-area textures. Source files and native UV0 are always retained."""
import math
import bpy
import numpy as np
from surface_policy import glow_response, is_glass_effect, paint_diffuse, paint_fresnel, surface_alpha, perceptual_roughness
from pixels import grid, linearize, resize_up, sample_repeat, size_for, specular_to_metalrough, tangent_normal, weights, write_png


def build_portable(obj, area, source_images, output, report, cache=None, recipe=None, runtime=False):
    if runtime:
        # Retain source UVs/tangents in the GLB. The web shader interprets the
        # raw normal channels and computes every material colour at draw time.
        mat = bpy.data.materials.new('area%d_metalrough' % area['index'])
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes.get('Principled BSDF')
        uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UV0'
        report['runtimeMaterial'] = True
        report['textures'] = {}
        for role, slot in [('AlbedoMap', 'mr_basecolor'), ('NormalMap', 'normal')]:
            image = bpy.data.images.load(str(source_images[area['textures'][role].lower()]), check_existing=False)
            image.colorspace_settings.name = 'sRGB' if role == 'AlbedoMap' else 'Non-Color'
            tex = nodes.new('ShaderNodeTexImage'); tex.image = image
            links.new(uv.outputs['UV'], tex.inputs['Vector'])
            report['textures'][slot] = dict(width=image.size[0], height=image.size[1], uv='UV0', sourceRole=role)
            if role == 'AlbedoMap': links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            else:
                normal = nodes.new('ShaderNodeNormalMap'); normal.uv_map = 'UV0'
                links.new(tex.outputs['Color'], normal.inputs['Color'])
                links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
        return mat, mat
    index, params, textures = area['index'], area['parameters'], area['textures']
    glass = is_glass_effect(area['effect'])
    arrays = {}
    def read(role):
        if role not in arrays:
            image = bpy.data.images.load(str(source_images[textures[role].lower()]), check_existing=False)
            image.colorspace_settings.name = 'Non-Color'
            values = np.empty(len(image.pixels), np.float32)
            image.pixels.foreach_get(values)
            values = values.reshape(image.size[1], image.size[0], 4)
            bpy.data.images.remove(image)
            if role == 'AlbedoMap':
                values[:, :, :3] = linearize(values[:, :, :3])
            arrays[role] = values
        return arrays[role]

    maps, images, uv_names = {}, {}, {}
    sail_domain = None
    sail_size = None
    sail_uv = 'UV0'
    if 'SailsDetailMap' in textures:
        detail = read('SailsDetailMap')
        repeat, angle = params['SailsDetailData'][:2]
        mesh = obj.data
        polygons = [p for p in mesh.polygons if index <= p.material_index < index + area['count']]
        # Wrap only when both the shader and interpolation are periodic. An area
        # wider than half a tile is valid; it does not imply a seam crossing.
        sail_wrap = abs(repeat - round(repeat)) <= 1e-6 and abs(angle) <= 1e-6
        if sail_wrap:
            for polygon in polygons:
                uv = np.array([mesh.uv_layers['UV0'].data[l].uv[:] for l in polygon.loop_indices])
                if not np.allclose(uv - uv[0], (uv % 1) - (uv[0] % 1), atol=1e-6):
                    sail_wrap = False
                    break
        points = np.array([mesh.uv_layers['UV0'].data[l].uv[:] for p in polygons for l in p.loop_indices])
        if sail_wrap:
            points %= 1
        lo, hi = points.min(0) - .001, points.max(0) + .001
        base_size = size_for([read(role) for role in ('AlbedoMap', 'MaterialMap', 'PaintMaskMap', 'RoughnessMap')])
        c, s = abs(math.cos(angle)), abs(math.sin(angle))
        # The derivative of the rotated sampling coordinates sets texel density.
        detail_density = np.array([c * detail.shape[1] + s * detail.shape[0],
                                   s * detail.shape[1] + c * detail.shape[0]]) * abs(repeat)
        density = np.maximum(base_size, detail_density)
        sail_size = tuple(int(math.ceil(x)) for x in density * (hi - lo))
        if max(sail_size) > 16384:
            raise ValueError('Sail detail would exceed 16384 pixels; no automatic reduction permitted')
        sail_domain = (lo, hi)
        sail_uv = 'UVSails%d' % index
        target = mesh.uv_layers.new(name=sail_uv)
        for poly in mesh.polygons:
            for loop in poly.loop_indices:
                uv = np.array(mesh.uv_layers['UV0'].data[loop].uv[:])
                target.data[loop].uv = ((uv % 1 if sail_wrap else uv) - lo) / (hi - lo) if index <= poly.material_index < index + area['count'] else uv
        report['sail_crop'] = dict(size=list(sail_size), source_density=density.tolist(),
                                   source_domain=[lo.tolist(), hi.tolist()], uv=sail_uv, wrapped=sail_wrap,
                                   method='Local material composite, >= original detail texels per UV unit; UV0 untouched')

    def inputs(roles, sails=True):
        source = [read(role) for role in roles]
        if sail_domain is not None and sails:
            u, v = grid(sail_size, sail_domain)
            result = {role: sample_repeat(a, u, v) for role, a in zip(roles, source)}
            if 'MaterialMap' in result:
                repeat, angle = params['SailsDetailData'][:2]
                # UV0 is V-flipped on import. Rotate in the source's authored UV
                # convention, then flip back for Blender image sampling.
                c, s = math.cos(angle), math.sin(angle)
                du = repeat * (u * c - (1 - v) * s)
                dv = 1 - repeat * (u * s + (1 - v) * c)
                detail = sample_repeat(read('SailsDetailMap'), du, dv)[:, :, 0]
                mask = result['MaterialMap'][:, :, 0]
                mask += (detail - mask) * weights(mask)[..., 0]
            return result
        size = size_for(source)
        return {role: resize_up(a, size) for role, a in zip(roles, source)}

    def save(key, value, roles, color=False, uv='UV0'):
        name = 'area%d_%s' % (index, key)
        path = output / 'textures' / (name + '.png')
        if glass and key in ('basecolor', 'mr_basecolor'):
            mask = inputs(['PaintMaskMap'])['PaintMaskMap'][:, :, 0]
            alpha = 1 - resize_up(mask, (value.shape[1], value.shape[0]))
            value = np.dstack((value, alpha))
        write_png(path, value, color)
        image = bpy.data.images.load(str(path), check_existing=False)
        image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        images[key], uv_names[key] = image, uv
        report.setdefault('textures', {})[key] = dict(file=str(path.relative_to(output)).replace('\\', '/'),
            width=image.size[0], height=image.size[1], uv=uv,
            sources=[dict(role=role, resource=textures[role], width=read(role).shape[1], height=read(role).shape[0]) for role in roles])
        return image

    def layers(role):
        return np.array([params['Mtl%d%s' % (j, role)][:3] for j in range(1, 5)], dtype=np.float32)

    roles = ('basecolor', 'f0', 'roughness', 'normal', 'normal_directx', 'emission', 'mr_basecolor', 'metallic', 'orm')
    targets = {role: output / 'textures' / ('area%d_%s.png' % (index, role)) for role in roles}
    cached = cache.restore(recipe, targets) if cache else None
    if cached is not None:
        report['textures'] = cached['textures']
        emission_scale = cached['emissionScale']
        for role, record in report['textures'].items():
            record['file'] = targets[role].relative_to(output).as_posix()
            images[role] = bpy.data.images.load(str(targets[role]), check_existing=False)
            images[role].colorspace_settings.name = 'sRGB' if role in ('basecolor', 'f0', 'emission', 'mr_basecolor') else 'Non-Color'
            uv_names[role] = record['uv']
        print('MATERIAL_CACHE_HIT', index, flush=True)
    else:
        common = ['MaterialMap', 'PaintMaskMap']
        for key, roles in [('basecolor', ['AlbedoMap'] + common), ('f0', common), ('roughness', ['RoughnessMap'] + common)]:
            values = inputs(roles)
            paint = np.clip(values['PaintMaskMap'][:, :, 0] * params.get('GeneralData', [0])[0], 0, 1)
            weight = weights(values['MaterialMap'][:, :, 0])
            if key == 'basecolor':
                result = paint_diffuse(values['AlbedoMap'][:, :, :3], weight @ layers('DiffuseColor'), paint)
            elif key == 'f0':
                result = paint_fresnel(weight @ layers('FresnelColor'), paint)
            else:
                gloss = weight @ np.array([params['Mtl%dGloss' % j][0] for j in range(1, 5)], dtype=np.float32)
                result = surface_alpha(gloss, values['RoughnessMap'][:, :, 0], paint)
            maps[key] = np.clip(result, 0, 1)
            if key == 'roughness':
                # Principled and glTF take perceptual roughness. Keep alpha in maps
                # so the packed variant can resample it at its own resolution.
                result = perceptual_roughness(maps[key])
            save(key, result, roles + (['SailsDetailMap'] if sail_domain else []), key != 'roughness', sail_uv)
        # Normals and emission do NOT inherit another channel's resolution or crop.
        normal = tangent_normal(read('NormalMap'))
        save('normal', normal * .5 + .5, ['NormalMap'])
        normal[:, :, 1] *= -1
        save('normal_directx', normal * .5 + .5, ['NormalMap'])
        glow = glow_response(read('GlowMap')[:, :, 0], area['effect'])
        emission = glow[:, :, None] * np.array(params.get('GeneralGlowColor', params.get('GeneralHeatGlowColor', [0, 0, 0]))[:3], dtype=np.float32)
        emission_scale = max(1, float(emission.max()))
        save('emission', emission / emission_scale, ['GlowMap'], True)
        size = size_for([maps['basecolor'], maps['f0']])
        base, metallic = specular_to_metalrough(resize_up(maps['basecolor'], size), resize_up(maps['f0'], size))
        save('mr_basecolor', base, ['AlbedoMap'] + common, True, sail_uv)
        save('metallic', metallic, ['AlbedoMap'] + common, False, sail_uv)
        # glTF green stores perceptual roughness, not internal alpha.
        # glTF packs metallic+roughness into one image, so prepack at the larger
        # resolution ourselves and record it instead of relying on exporter resizing.
        orm_size = size_for([metallic, maps['roughness']])
        orm = np.stack([np.ones((orm_size[1], orm_size[0]), np.float32),
                        perceptual_roughness(resize_up(maps['roughness'], orm_size)), resize_up(metallic, orm_size)], axis=-1)
        save('orm', orm, ['AlbedoMap', 'RoughnessMap'] + common, False, sail_uv)
        if cache:
            cache.store(recipe, targets, dict(textures=report['textures'], emissionScale=emission_scale))

    def material(metalrough):
        mat = bpy.data.materials.new('area%d%s' % (index, '_metalrough' if metalrough else ''))
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes.get('Principled BSDF')
        def tex(key):
            node = nodes.new('ShaderNodeTexImage')
            node.image = images[key]
            node.extension = 'REPEAT' if uv_names[key] == 'UV0' else 'EXTEND'
            uv = nodes.new('ShaderNodeUVMap')
            uv.uv_map = uv_names[key]
            links.new(uv.outputs['UV'], node.inputs['Vector'])
            return node.outputs['Color']
        base_color = tex('mr_basecolor' if metalrough else 'basecolor')
        links.new(base_color, bsdf.inputs['Base Color'])
        if glass:
            mat.surface_render_method = 'BLENDED'
            links.new(base_color.node.outputs['Alpha'], bsdf.inputs['Alpha'])
        if metalrough:
            split = nodes.new('ShaderNodeSeparateColor')
            links.new(tex('orm'), split.inputs['Color'])
            links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
            links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
        else:
            links.new(tex('roughness'), bsdf.inputs['Roughness'])
            scale = nodes.new('ShaderNodeMix')
            scale.data_type = 'RGBA'
            scale.blend_type = 'MULTIPLY'
            scale.inputs[0].default_value = 1
            scale.inputs[7].default_value = (25, 25, 25, 1)
            scale.clamp_result = False
            links.new(tex('f0'), scale.inputs[6])
            links.new(scale.outputs[2], bsdf.inputs['Specular Tint'])
        n = nodes.new('ShaderNodeNormalMap')
        n.uv_map = 'UV0'
        links.new(tex('normal'), n.inputs['Color'])
        links.new(n.outputs[0], bsdf.inputs['Normal'])
        links.new(tex('emission'), bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission_scale
        mat['source_effect'] = area['effect']
        return mat
    return material(False), material(True)
