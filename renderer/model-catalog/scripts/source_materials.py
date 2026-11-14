# SOURCE AUDIT 2026-11-11 [B05/M01-M04]: Publication/export reuses unresolved native material semantics; standard APIs do not clear those semantics.
# See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
"""Publish decoded source maps and parameters; never compose coloured pixels."""
import re
import copy
from build_catalog import read, identity, DIST
from texture_webp import publish, webp_bindings, capped_size
from surface_passes import split_surface_passes, slots, OVERLAY_PROFILE, OVERLAY_TEXTURES, overlay_profile
from projected_patterns import projected_patterns
from material_defaults import runtime_material_parameters

PROFILE = 'quad-runtime-v1'
ROLES = ('AlbedoMap', 'MaterialMap', 'PaintMaskMap', 'RoughnessMap',
         'NormalMap', 'GlowMap', 'DirtMap', 'DustNoiseMap')


def texture_roles(area):
    if re.search(r'/(?:skinned_)?quadenvironmentv5\.fx$', area['effect'], re.I):
        return tuple(role for role in ROLES if role != 'PaintMaskMap') + ('Detail1Map', 'Detail2Map')
    roles = ROLES + (('SailsDetailMap',) if 'SailsDetailMap' in area['textures'] else ())
    if re.search(r'/(?:skinned_)?quad(?:heat)?detailv5\.fx$', area['effect'], re.I):
        roles += ('Detail1Map', 'Detail2Map')
        if 'quadheatdetail' not in area['effect'].lower(): roles += ('Detail3Map',)
    return roles


def attach_source_materials(doc, folder, resources, dist=DIST, prepared_maps=None):
    source = read(folder / 'default-materials.json')
    report = read(folder / 'conversion-report.json')
    sources = {r['resource'].lower(): r for r in read(folder / 'source-manifest.json')['files']}
    decoded = {r['resource'].lower(): r for r in report['source_textures'] if 'file' in r}
    surfaces, overlays = split_surface_passes(source['areas'])
    areas = {a['index']: a for a in surfaces}
    # Republish can be invoked on an already upgraded document.
    generated = {i for i,m in enumerate(doc['materials']) if m.get('extras', {}).get('ccpdecDrawOrder')}
    if generated:
        remap = {old:new for new,old in enumerate(i for i in range(len(doc['materials'])) if i not in generated)}
        doc['materials'] = [m for i,m in enumerate(doc['materials']) if i not in generated]
        for mesh in doc.get('meshes', []):
            mesh['primitives'] = [dict(p,material=remap[p['material']]) for p in mesh['primitives'] if p['material'] not in generated]
    for order, layer in enumerate((a for a in overlays if a.get('opaqueLayer')), 1):
        areas[layer['index']] = layer
        base_index = next(i for i,m in enumerate(doc['materials'])
                          if int(re.match(r'area(\d+)',m['name']).group(1)) == layer['sourceIndex'])
        definition = copy.deepcopy(doc['materials'][base_index])
        definition['name'] = 'area%d_metalrough' % layer['index']
        definition.setdefault('extras', {})['ccpdecDrawOrder'] = order
        material_index = len(doc['materials'])
        doc['materials'].append(definition)
        for mesh in doc.get('meshes', []):
            mesh['primitives'].extend(dict(copy.deepcopy(p),material=material_index)
                                      for p in list(mesh['primitives']) if p.get('material') == base_index)
    def publish_maps(area, roles):
        urls = {}
        for role in roles:
            name = area['textures'][role].lower()
            record = decoded[name]
            max_edge = 2048 if role in ('DirtMap', 'DustNoiseMap') else None
            if prepared_maps is not None:
                target = dist / prepared_maps[(name, max_edge)]['url']
            else:
                content = (folder / record['file']).read_bytes()
                target = publish(dist / 'assets/textures', content, max_edge=max_edge)
            size = capped_size((record['width'], record['height']), max_edge)
            recipe = dict(kind='source-texture', algorithm='dds-rgba8-v1',
                          source=name, checksum=sources[name]['md5'],
                          width=size[0], height=size[1])
            if size != (record['width'], record['height']):
                recipe.update(algorithm='dds-rgba8-channels-lanczos-2k-v1',
                              sourceWidth=record['width'], sourceHeight=record['height'])
            key = identity(recipe)
            resources[key] = dict(key=key, file=target.relative_to(dist).as_posix(),
                                  bytes=target.stat().st_size, recipe=recipe, contentHash=target.stem)
            urls[role] = '../textures/' + target.name
        return urls
    # Rebuild bindings so upgraded models no longer load any baked images.
    images, textures, image_indices = [], [], {}
    for material in doc['materials']:
        area = areas[int(re.match(r'area(\d+)', material['name']).group(1))]
        layers = [layer for layer in overlays if not layer.get('opaqueLayer') and slots(layer) & slots(area)]
        def publish_layers():
            radius = source.get('overlayRadius', source.get('sourceRadius', 0))
            if any(overlay_profile(layer) == OVERLAY_PROFILE for layer in layers) and radius <= 0:
                raise ValueError('Hull overlays require a positive projection radius')
            return [dict(profile=overlay_profile(layer), effect=layer['effect'], parameters=layer['parameters'],
                         blend='alpha' if layer['kind'] == 'transparentAreas' else 'additive',
                         sourceRadius=radius, textures=publish_maps(layer, OVERLAY_TEXTURES))
                    for layer in layers]
        if area.get('effectOnly'):
            material['extras'] = {**material.get('extras', {}), 'ccpdecNative': dict(
                profile='fx-surface-v1', textures={}, effect=area['effect'], overlays=publish_layers())}
            material['pbrMetallicRoughness'] = dict(baseColorFactor=[0,0,0,0], metallicFactor=0, roughnessFactor=1)
            material['alphaMode'] = 'BLEND'
            for key in ('normalTexture', 'emissiveTexture', 'emissiveFactor', 'extensions'):
                material.pop(key, None)
            continue
        params = runtime_material_parameters(area['effect'], area['parameters'])
        patterns = projected_patterns(source, area)
        roles = texture_roles(area) + tuple(p['role'] for p in patterns)
        if 'SailsDetailMap' in roles and 'SailsDetailData' not in params:
            raise ValueError('Sail material lacks detail transform')
        urls = publish_maps(area, roles)
        material['extras'] = {**material.get('extras', {}), 'ccpdecNative': dict(
            profile=PROFILE, textures=urls, parameters=params, effect=area['effect'], surfaceKind=area['kind'])}
        if 'PaintMaskMap' in roles and dict(area.get('options', [])).get('SPACE_OBJECT_TRANSPARENCY') == 'SOT_CLIP':
            # Quad clip samples PaintMaskMap with its own UV selection/tiling.
            clip = dict(uvMix=params.get('GeneralData', [0, 0, 0])[2],
                        tiling=params.get('GeneralTiling', [1, 1])[1])
            material['extras']['ccpdecNative']['clip'] = clip
            material.update(alphaMode='MASK', alphaCutoff=0.5)
            if clip['uvMix']:
                material_index = doc['materials'].index(material)
                for mesh in doc.get('meshes', []):
                    for primitive in mesh['primitives']:
                        if primitive.get('material') == material_index and 'TEXCOORD_1' not in primitive['attributes']:
                            raise ValueError('Cutout material requires secondary UV coordinates')
        if patterns:
            material['extras']['ccpdecNative']['patterns'] = patterns
            material_index = doc['materials'].index(material)
            for mesh in doc.get('meshes', []):
                for primitive in mesh['primitives']:
                    if primitive.get('material') == material_index and '_CCP_SOURCE_POSITION' not in primitive['attributes']:
                        raise ValueError('Projection requires exported native rest coordinates')
        if layers:
            material['extras']['ccpdecNative']['overlays'] = publish_layers()
        if re.search(r'(?:^|/)(?:skinned_)?quadglassv5\.fx$', area['effect'], re.I):
            material.update(alphaMode='BLEND', doubleSided=True)
        def bind(role):
            url = urls[role]
            if url not in image_indices:
                image_indices[url] = len(images)
                images.append(dict(uri=url))
                textures.append(dict(source=len(images)-1, sampler=0))
            return dict(index=image_indices[url], texCoord=0)
        material['pbrMetallicRoughness'] = dict(baseColorTexture=bind('AlbedoMap'), metallicFactor=0, roughnessFactor=1)
        material['normalTexture'] = bind('NormalMap')
        material.pop('emissiveTexture', None)
        material.pop('emissiveFactor', None)
        # Portable specular/IOR/emissive extensions describe the old bake.
        material.pop('extensions', None)
    doc['images'], doc['textures'] = images, textures
    doc['samplers'] = [dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)]
    doc.setdefault('extras', {}).setdefault('ccpdec', {})['materialProfile'] = PROFILE
    for key in ('sourceRadius', 'sourceCenter', 'sourceBounds', 'sourceRadiusOrigin'):
        if key in source:doc['extras']['ccpdec'][key] = source[key]
    webp_bindings(doc)
    used = set()
    def extensions(value):
        if isinstance(value, dict):
            used.update(value.get('extensions', {}))
            for key, child in value.items():
                if key != 'extras': extensions(child)
        elif isinstance(value, list):
            for child in value: extensions(child)
    extensions(doc)
    for key in ('extensionsUsed', 'extensionsRequired'):
        if key in doc:
            doc[key] = [name for name in doc[key] if name in used]
            if not doc[key]: doc.pop(key)
    return doc
