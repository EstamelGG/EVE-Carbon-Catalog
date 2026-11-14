"""Source-authored child mesh and projected decal recipes; no type-specific tuning."""
import json

from effect_lighting import TRANSFORM_FIELDS, shader_name, shader_options
from mesh_effect_options import mesh_effect_options
from resource_errors import MissingResourceError


def parameters(effect):
    values = dict(effect.get('constParameters', []))
    values.update({p['name']: p['value'] for p in effect.get('parameters', [])})
    return values


def omit_empty_decals(supplements):
    # Projection can be evaluated only after the hull mesh task finishes.
    supplements['decals'] = [d for d in supplements['decals'] if d['geometry'].get('indices') != []]


def pack_supplements(record, assets, lighting=None, read_options=shader_options):
    meshes, flares, decals, unsupported = [], [], [], []
    def rig_key(path):
        return json.dumps([{k: node[k] for k in TRANSFORM_FIELDS if k in node}
                           for node in path], sort_keys=True)
    source_paths = {tuple(rig['sourceRigPath']) for rig in (lighting or {}).get('sets', []) if 'sourceRigPath' in rig}
    owned_rigs = {rig_key(rig['parents'] + [rig['node']])
                  for rig in (lighting or {}).get('sets', []) if 'node' in rig}

    def prepare_textures(node, area, textures, roles, cube=False):
        try:
            return {role: (assets.cube_texture(textures[role]) if cube and role == 'MainCubeMap'
                           else assets.texture(textures[role])) for role in roles}
        except MissingResourceError as error:
            # Only this supplemental draw is unavailable. Never substitute a
            # different mask or drop the primary hull, and disclose the loss.
            unsupported.append(dict(node=node.get('name'), reason='missing-effect-resource',
                                    area=area['index'], resource=error.resource))
            return None
    def visit(node, parents, path):
        if node.get('display') is False:
            return
        if node.get('existingSpotlightRig'):
            # Legacy callers without a plan retain their old ownership rule.
            # A rejected authored rig must remain available to supplements.
            if lighting is None or lighting['mode'] == 'smart' or path in source_paths or rig_key(parents + [node]) in owned_rigs:
                return
            if not any(node.get(k) for k in ('objects', 'mesh', 'effect')):
                unsupported.append(dict(node=node.get('name'), reason='missing-spotlight-capture'))
                return
        # Native HIGH profile: don't draw alternative lower-LOD rigs on top.
        if node.get('displayFilter', 5) not in (3, 4, 5): return
        transform = {k: node[k] for k in TRANSFORM_FIELDS if k in node}
        chain = parents + [transform]
        modifiers = [m['type'] for m in node.get('transformModifiers', [])]
        allowed = {'trinity.EveChildModifierSRT', 'trinity.EveChildModifierBillboard2D',
                   'trinity.EveChildModifierBillboard3D',
                   'trinity.EveChildModifierHalo', 'trinity.EveChildModifierCameraOrientedRotationConstrained'}
        if set(modifiers) - allowed:
            unsupported.append(dict(node=node.get('name'), reason='transform', types=modifiers))
            return
        if node.get('type') == 'trinity.EveChildParticleSystem' and not node.get('sceneHandled'):
            unsupported.append(dict(node=node.get('name'), reason='gpu-particles'))
        if not node.get('sceneHandled') and node.get('type') == 'trinity.EveChildQuad' and shader_name(node.get('effect', {})) == 'flarequad.fx':
            flare = dict(parents=parents, node=transform, color=node['color'], brightness=node['brightness'])
            if node.get('minScreenSize'):
                flare['minScreenSize'] = node['minScreenSize']
            flares.append(flare)
        mesh = {} if node.get('sceneHandled') else node.get('mesh') or {}
        for kind in ('additiveAreas', 'transparentAreas', 'distortionAreas', 'opaqueAreas'):
            for area in mesh.get(kind, []):
                if area.get('display') is False or area.get('sceneHandled'): continue
                effect = area['effect']
                textures = {r['name']: r['resourcePath'] for r in effect.get('resources', [])}
                p = parameters(effect)
                cube_roles = ('DiffuseMap1', 'DiffuseMap2', 'MaskMap', 'MainCubeMap')
                if (kind == 'additiveAreas' and shader_name(effect) == 'ubershadercube.fx'
                        and all(role in textures for role in cube_roles)
                        and {'DiffuseColor', 'ScaleAlongNormal'} <= p.keys()):
                    prepared = prepare_textures(node, area, textures, cube_roles, cube=True)
                    if prepared is None: continue
                    meshes.append(dict(name=node.get('name'), transforms=chain,
                        material='uber-cube',
                        geometry=assets.geometry(mesh['geometryResPath'], mesh.get('meshIndex', 0), area['index'], area['count']),
                        shader=assets.shader(effect), parameters=p,
                        textures=prepared))
                    continue
                # The native effect can contain an opaque depth-writing core
                # beneath its additive shell (e.g. Triglavian energy fields).
                # Preserve that authored mesh; dropping it exposes the back glow.
                if (kind == 'opaqueAreas' and shader_name(effect) == 'texturecolor.fx'
                        and 'DiffuseMap' in textures and 'DiffuseColor' in p):
                    prepared = prepare_textures(node, area, textures, ['DiffuseMap'])
                    if prepared is None: continue
                    meshes.append(dict(name=node.get('name'), transforms=chain,
                        material='texture-color', blend='opaque',
                        geometry=assets.geometry(mesh['geometryResPath'], mesh.get('meshIndex', 0), area['index'], area['count']),
                        shader=assets.shader(effect), parameters=p,
                        textures=prepared))
                    continue
                if kind != 'additiveAreas' or shader_name(effect) not in ('ubershader.fx', 'ubershadertwosided.fx'):
                    unsupported.append(dict(node=node.get('name'), reason=kind, shader=shader_name(effect)))
                    continue
                try:
                    options = mesh_effect_options(effect, assets, read_options)
                except MissingResourceError as error:
                    unsupported.append(dict(node=node.get('name'), reason='missing-effect-resource', resource=error.resource))
                    continue
                layers = {'ONE': 1, 'TWO': 2, 'THREE': 3}.get(options.get('DIFFUSE_MAP_COUNT'),
                    sum('DiffuseMap' + str(n) in textures for n in range(1, 4)))
                two_sided = shader_name(effect) == 'ubershadertwosided.fx'
                supported = (options.get('VARIATION', 'REGULAR') == 'REGULAR' and layers in (1, 2, 3)
                    and {'DiffuseColor', 'FresnelFactors'} <= p.keys())
                if not supported:
                    unsupported.append(dict(node=node.get('name'), reason=kind, shader=shader_name(effect)))
                    continue
                roles = ['DiffuseMap' + str(n) for n in range(1, layers + 1)] + ['MaskMap']
                if any(role not in textures for role in roles):
                    unsupported.append(dict(node=node.get('name'), reason='missing-uber-inputs'))
                    continue
                prepared = prepare_textures(node, area, textures, roles)
                if prepared is None: continue
                meshes.append(dict(name=node.get('name'), transforms=chain, layers=layers,
                    twoSided=two_sided,
                    maskTransform=options.get('MASK_TRANSFORM', 'OFF') == 'ON',
                    maskClamp=options.get('MASK_TEXTURE_SAMPLING', 'WRAP') != 'WRAP',
                    geometry=assets.geometry(mesh['geometryResPath'], mesh.get('meshIndex', 0), area['index'], area['count']),
                    shader=assets.shader(effect), parameters=p,
                    textures=prepared))
        for index, child in enumerate(node.get('objects', [])):
            visit(child, chain, path + (index, child.get('name', '')))
    for node in record['children']:
        if record.get('gateAnimation', {}).get('sets') and 'fxID' in node:
            continue  # Animated gate renderer owns these nodes, including hidden states.
        visit(node, [], (node.get('name', ''),))
    for index, decal in enumerate(record.get('decals', [])):
        effect = decal['decalEffect']
        if decal.get('display') is False: continue
        kind = shader_name(effect)
        counter = kind == 'decalcounterv5.fx'
        glow = kind == 'decalglowv5.fx'
        if kind not in ('decalv5.fx', 'decalcounterv5.fx', 'decalglowv5.fx'):
            unsupported.append(dict(node='decal:' + str(index), reason='decal-shader', shader=shader_name(effect)))
            continue
        buffers = decal.get('staticIndexBuffers', [])
        project = decal.get('sourceProjection', False)
        if (not buffers and not project) or (buffers and not buffers[0]): continue
        textures = {r['name']: r['resourcePath'] for r in effect['resources'] if r['name'].startswith('Decal')
                    or (kind == 'decalv5.fx' and r['name'] == 'NormalMap')}
        # Counter decals are emissive masks, not painted albedo decals. Native
        # ships supply only DecalTransparencyMap plus their glow parameters.
        roles = {'DecalTransparencyMap'} if counter else {'DecalAlbedoMap', 'DecalTransparencyMap', 'DecalRoughnessMap', 'DecalFresnelMap'}
        if glow: roles = {'DecalTransparencyMap', 'DecalGlowMap'}
        p = parameters(effect)
        if glow and not {'DecalTextureScaling', 'DecalTextureOffset', 'DecalIntensityData', 'DecalGlowColor'} <= p.keys():
            unsupported.append(dict(node='decal:' + str(index), reason='missing-glow-parameters', shader=kind))
            continue
        if counter and not {'DecalTextureScaling', 'DecalIntensityData', 'DecalGlowColor'} <= p.keys():
            unsupported.append(dict(node='decal:' + str(index), reason='missing-counter-parameters', shader=kind))
            continue
        if not roles <= textures.keys():
            unsupported.append(dict(node='decal:' + str(index), reason='missing-decal-inputs', shader=kind))
            continue
        try:
            prepared = {role: assets.texture(path) for role, path in textures.items()}
        except MissingResourceError as exc:
            unsupported.append(dict(node='decal:' + str(index), reason='missing-decal-resource', resource=exc.resource))
            continue
        if project:
            transform = {key: decal[key] for key in ('position', 'rotation', 'scaling')}
            geometry = assets.geometry(record['geometry'], 0, indices=buffers[0] if buffers else None,
                                       projection=transform)
        else:
            geometry = assets.geometry(record['geometry'], 0, indices=buffers[0])
        layer = dict(position=decal['position'], rotation=decal['rotation'], scaling=decal['scaling'],
                     geometry=geometry, textures=prepared, shader=dict(resource=effect['effectFilePath']))
        if counter or glow:
            layer.update(material='glow' if glow else 'kill-counter', parameters=p)
        bone = decal.get('parentBoneIndex', -1)
        if bone >= 0 or counter or glow:
            layer['parentBoneIndex'] = bone
        decals.append(layer)
    return dict(version=1, meshes=meshes, flares=flares, decals=decals, unsupported=unsupported,
                limitations=['controller-transitions', 'gpu-particles', 'scene-refraction', 'soft-depth', 'volumetric-fog'])
