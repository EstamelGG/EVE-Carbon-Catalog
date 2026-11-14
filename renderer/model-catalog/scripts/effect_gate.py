"""Gate effect resources and native sampled bindings; independent of hull export."""
from effect_lighting import TRANSFORM_FIELDS, shader_name, shader_options
from effect_supplements import parameters
from mesh_effect_options import mesh_effect_options
from source_effect_options import material_resource
from source_particle_materials import SPRITES
from source_particle_emitters import resolve_dynamic_emitter
from source_gate_colors import apply_gate_colors
from source_gpu_particle_curves import apply_gpu_curves
from source_line_paths import resolve_line_paths
from resource_errors import MissingResourceError
from animation_color_repair import repair_color_samples

VERSION = 1
MESH_SHADERS = {'ubershader.fx', 'ubershadertwosided.fx', 'ubershaderdistortion.fx',
                'ubershader4layer.fx', 'twocolorflare.fx', 'flare.fx', 'motionvectorramp.fx', 'motionvector.fx', 'volumesphere.fx', 'traffic.fx', 'fxdirectionalv5.fx', 'fx3dv5.fx', 'quadglassv5.fx'}
PARTICLE_SHADERS = {'2layermask.fx', '2layerdynmaskv2.fx', 'motionvector.fx', 'motionvectorramp.fx', '1layerdynv2.fx', 'gateparticles.fx', '1layerdyndistortionv2.fx', '2layermodulatenoatlasv2.fx'}


def compact_animation(animation, draws):
    """Densely relabel targets reachable from the draw graph, preserving shared nodes."""
    pending, seen, records, identities = [draws], set(), [], set()
    while pending:
        value = pending.pop()
        if not isinstance(value, (dict, list)) or id(value) in seen:
            continue
        seen.add(id(value))
        if isinstance(value, list):
            pending.extend(value)
            continue
        records.append(value)
        pending.extend(value.values())
        if value.get('fxID') is not None:
            identities.add(value['fxID'])
        identities.update(value.get('fxParameters', {}).values())

    ordered = sorted(identities)
    targets = [animation['targets'][identity] for identity in ordered]
    mapping = {identity: index for index, identity in enumerate(ordered)}
    remapped_parameters = set()
    for record in records:
        if record.get('fxID') is not None:
            record['fxID'] = mapping[record['fxID']]
        parameters = record.get('fxParameters')
        if parameters is not None and id(parameters) not in remapped_parameters:
            remapped_parameters.add(id(parameters))
            for name, identity in parameters.items():
                parameters[name] = mapping[identity]

    clips = []
    for clip in animation.get('sets', []):
        tracks = [dict(track, target=mapping[track['target']])
                  for track in clip.get('tracks', []) if track['target'] in mapping]
        if tracks:
            clips.append(dict(clip, tracks=tracks))
    spatial_fields = {'translation', 'rotation', 'scaling', 'localTransform', 'staticTransform', 'useSRT', 'boneIndex'}
    spatial_targets = sorted({track['target'] for clip in clips for track in clip['tracks']
                              if track['field'] in spatial_fields})
    return dict(animation, targets=targets, sets=clips,
                transformPlan=dict(version=1, spatialTargets=spatial_targets))


def pack_gate(record, assets, generic=False, read_options=shader_options, read_sprite_materials=None, read_emitters=None,
              read_gpu_curves=None, read_line_paths=None, read_gpu_system=None):
    animation = record.get('sceneAnimation' if generic else 'gateAnimation')
    if not animation or (not generic and not animation.get('sets')):
        return None
    color_targets = set()
    def collect_colors(value):
        if isinstance(value, dict):
            color_targets.update(target for name, target in value.get('fxParameters', {}).items()
                                 if name.endswith('Color'))
            for child in value.values(): collect_colors(child)
        elif isinstance(value, list):
            for child in value:
                if isinstance(child, (dict, list)): collect_colors(child)
    collect_colors(record.get('children', []))
    gate_colors = []
    preview_rates = {}
    meshes, particles, flares, lines, unsupported = [], [], [], [], []
    gpu = animation.get('gpuSystem', {}).get('render', {})
    atlas = next((r['resourcePath'] for r in gpu.get('resources', []) if r['name'] == 'AtlasMap'), None)
    atlas_grid = parameters(gpu).get('AtlasMapSize', [1024, 8])[1]

    def material(area, kind):
        effect = area['effect']
        return dict(shader=shader_name(effect), effectResource=material_resource(effect), blend=kind, fxID=area.get('fxID'),
                    sourceRadius=record.get('sourceRadius'),
                    display=area.get('display', True),
                    parameters=parameters(effect), fxParameters=effect.get('fxParameters', {}),
                    options=mesh_effect_options(effect, assets, read_options),
                    textures={r['name']:(getattr(assets,'traffic_texture',assets.texture)(r['resourcePath'])
                        if shader_name(effect)=='traffic.fx' and r['name']=='PositionMap' else assets.texture(r['resourcePath']))
                        for r in effect.get('resources', [])})

    def optional_material(area, kind, node):
        try:
            return material(area, kind)
        except MissingResourceError as error:
            unsupported.append(dict(node=node.get('name'), reason='missing-effect-resource', resource=error.resource))
            return None

    sprite_materials = None
    emitter_sources = None
    system_bindings = None

    def visit(node, parents):
        nonlocal sprite_materials, emitter_sources, system_bindings
        if node.get('existingSpotlightRig'): return
        if record.get('hangar') and node.get('display') is False and node.get('fxID') not in display_targets:return
        if node.get('displayFilter', 5) not in (3, 4, 5):
            return
        for modifier in node.get('transformModifiers', []):
            if modifier.get('type', '').rsplit('.',1)[-1] not in {
                    'EveChildModifierSRT', 'EveChildModifierBillboard2D', 'EveChildModifierBillboard3D',
                    'EveChildModifierAttachToBone', 'EveChildModifierHalo', 'EveChildModifierCameraOrientedRotationConstrained'}:
                unsupported.append(dict(node=node.get('name'), modifier=modifier.get('type')))
                return
        transform = {k:node[k] for k in (*TRANSFORM_FIELDS, 'fxID') if k in node}
        chain = parents + [transform]
        animated = any(n.get('fxID') in animated_targets for n in chain)
        if node.get('type') == 'trinity.EveChildEffectPropagator':
            p = node.get('propagator', {})
            if p.get('propagationType') != 0 or p.get('localLocators', {}).get('locators'):
                unsupported.append(dict(node=node.get('name'), reason='effect-propagation'))
        if node.get('type') == 'trinity.EveChildLineSet':
            effect = (node.get('lineSet') or {}).get('lineEffect', {})
            def supported_line(line):
                return line.get('type') in ('trinity.EveCircle','trinity.EveBezierCurve') or (
                    line.get('type')=='trinity.EveLineChildContainer' and all(supported_line(l) for l in line.get('lines',[])))
            if node.get('renderType') == 1 and shader_name(effect) == 'lines3d.fx' and all(supported_line(l) for l in node.get('lines', [])):
                paths = resolve_line_paths(node['lines'], read_line_paths, tuple(t.get('name', '') for t in chain))
                lines.append(dict(name=node.get('name'), transforms=chain, paths=paths,
                    baseColor=node['baseColor'],animColor=node['animColor'],brightness=node['brightness'],
                    scrollSpeed=node['scrollSpeed'],textures={r['name']:assets.texture(r['resourcePath']) for r in effect['resources']}))
            else: unsupported.append(dict(node=node.get('name'),reason='line-path-or-material'))
        if node.get('particleEmitters') or node.get('type') == 'trinity.EveChildParticleSystem':
            node['sceneHandled'] = generic
            materials = []
            for kind in ('additiveAreas', 'transparentAreas', 'distortionAreas', 'opaqueAreas'):
                for index, area in enumerate((node.get('mesh') or {}).get(kind, [])):
                    shader = shader_name(area['effect'])
                    if shader in PARTICLE_SHADERS:
                        source_path = None
                        authored_sprite = shader in SPRITES
                        if authored_sprite and read_sprite_materials is not None:
                            if sprite_materials is None:
                                sprite_materials = read_sprite_materials()
                            key = (tuple(t.get('name', '') for t in chain), kind, index)
                            source = sprite_materials.get(key)
                            if source and shader_name(source[1]) == shader:
                                source_path, authored = source
                                # Playback target IDs live in the sampled animation's namespace.
                                # Replace the static inputs, keeping those links for animated parameters.
                                effect = dict(authored, fxParameters=area['effect'].get('fxParameters', {}))
                                area = dict(area, effect=effect)
                        packed = optional_material(area, kind, node)
                        if packed:
                            if authored_sprite:
                                packed['staticMaterialSource'] = source_path or area['effect'].get('sourceFile') or 'capture'
                                if generic and source_path and authored.get('cloudBrightnessBinding'):
                                    if packed['fxParameters'].get('Brightness') not in animated_targets:
                                        packed['brightnessController'] = authored['cloudBrightnessBinding']
                                        packed['fxParameters'] = {name: target for name, target in
                                                                  packed['fxParameters'].items() if name != 'Brightness'}
                                if not generic and not animation.get('sourceResource') and source_path and authored.get('gateColorBinding'):
                                    gate_colors.append((packed, authored['gateColorBinding']))
                            materials.append(packed)
                    else:
                        unsupported.append(dict(node=node.get('name'), shader=shader_name(area['effect'])))
            particle_node = len(particles)
            for emitter_index, emitter in enumerate(node.get('particleEmitters', [])):
                emitter = {k:v for k,v in emitter.items() if k not in ('particleSystem',)}
                source_system = None
                if emitter['type'] == 'trinity.Tr2DynamicEmitter' and read_emitters is not None:
                    if emitter_sources is None:
                        emitter_sources = read_emitters()
                    key = (tuple(t.get('name', '') for t in chain), emitter_index)
                    source = emitter_sources.get(key)
                    emitter = resolve_dynamic_emitter(emitter, source, animation.get('targets', []))
                    if source and emitter['generatorSource'] == source[0] and 'system' in source[1]:
                        source_system = dict(source[1]['system'], systemSource=source[0])
                    if (source and 'previewRate' in source[1] and 'fxID' in emitter
                            and emitter.get('rateSource') == source[0] == emitter['generatorSource']):
                        preview_rates[emitter['fxID']] = emitter['rate']
                gpu_emitter = emitter['type'] == 'trinity.Tr2GpuUniqueEmitter'
                if gpu_emitter:
                    if read_gpu_system and system_bindings is None:
                        system_bindings = read_gpu_system()
                    key = (tuple(t.get('name', '') for t in chain), emitter_index)
                    source = read_gpu_curves().get(key) if read_gpu_curves else None
                    emitter = apply_gpu_curves(emitter, source)
                if emitter['type'] not in {'trinity.Tr2GpuUniqueEmitter', 'trinity.Tr2DynamicEmitter', 'trinity.Tr2StaticEmitter'}:
                    unsupported.append(dict(node=node.get('name'), emitter=emitter['type']))
                    continue
                if not gpu_emitter and not materials:
                    continue
                if gpu_emitter and not (system_bindings or atlas):
                    raise ValueError('Missing native GPU particle atlas')
                systems = node.get('particleSystems', [])
                index = emitter.get('systemIndex')
                if source_system is not None:
                    systems = [source_system]
                elif index is not None:
                    systems = [systems[index]]
                static = emitter['type'] == 'trinity.Tr2StaticEmitter'
                particle_data = assets.geometry(emitter['geometryResourcePath'], emitter.get('meshIndex',0), mode='particles') if static else None
                particles.append(dict(name=node.get('name'), transforms=chain, emitter=emitter,
                    meshDisplay=(node.get('mesh') or {}).get('display', True),
                    systems=systems, materials=materials, staticParticles=particle_data,
                    atlas=assets.texture(system_bindings['atlas'] if system_bindings else atlas) if gpu_emitter else None,
                    atlasGrid=system_bindings['grid'] if gpu_emitter and system_bindings else atlas_grid))
                particles[-1].update({field:node[field] for field in ('minScreenSize','lodSphereRadius','reflectionMode') if field in node})
                if gpu_emitter and system_bindings:
                    particles[-1]['noiseVolume'] = assets.texture(system_bindings['noise'])
                    if 'atlasDDS' in system_bindings:
                        particles[-1]['atlasDDS'] = system_bindings['atlasDDS']
                if emitter['type'] == 'trinity.Tr2DynamicEmitter' and len(node['particleEmitters']) > 1:
                    particles[-1]['particleNodeIndex'] = particle_node
        elif node.get('type') == 'trinity.EveChildQuad':
            if not generic or animated or node.get('fxID') in animated_targets or (
                    record.get('hangar') and node.get('sourceFile')):
                shader = shader_name(node.get('effect', {}))
                if shader not in ('flarequad.fx', 'flarequadsoft.fx'):
                    unsupported.append(dict(node=node.get('name'), shader=shader, reason='quad-shader'))
                    return
                node['sceneHandled'] = generic
                flare = dict(name=node.get('name'), shader=shader, transforms=chain, fxID=node.get('fxID'),
                             color=node.get('color', [1,1,1,1]), brightness=node.get('brightness',1))
                if node.get('minScreenSize'):
                    flare['minScreenSize'] = node['minScreenSize']
                flares.append(flare)
        else:
            mesh = node.get('mesh') or {}
            for kind in ('additiveAreas', 'transparentAreas', 'distortionAreas', 'opaqueAreas'):
                for area in mesh.get(kind, []):
                    if area.get('sceneHandled'): continue
                    if record.get('hangar') and area.get('index') in (99,999): continue
                    if record.get('hangar') and area.get('display') is False and area.get('fxID') not in display_targets:continue
                    if generic and not (record.get('hangar') or animated or kind == 'distortionAreas' or shader_name(area['effect']) in ('ubershader4layer.fx', 'quadglassv5.fx')
                        or area.get('fxID') in animated_targets
                        or any(i in animated_targets for i in area['effect'].get('fxParameters', {}).values())):
                        continue
                    if shader_name(area['effect']) not in MESH_SHADERS:
                        if generic and not animated and ((kind=='opaqueAreas' and shader_name(area['effect'])=='texturecolor.fx')
                                or (kind=='additiveAreas' and shader_name(area['effect'])=='ubershadercube.fx')):
                            continue  # Owned by the supplemental material packer.
                        warning = dict(node=node.get('name'), shader=shader_name(area['effect']))
                        if record.get('hangar') and node.get('sourceFile') and warning['shader'] == 'quadv5.fx':
                            warning['parentPath'] = [p.get('name', '') for p in parents]
                        unsupported.append(warning)
                        continue
                    if shader_name(area['effect'])=='fxdirectionalv5.fx' and not record.get('sourceRadius'):
                        unsupported.append(dict(node=node.get('name'),reason='missing-directional-radius'));continue
                    area['sceneHandled'] = generic
                    packed = optional_material(area, kind, node)
                    if not packed: continue
                    if packed['shader']=='traffic.fx':
                        if not mesh.get('instanceGeometryResPath'):
                            unsupported.append(dict(node=node.get('name'),reason='missing-traffic-instances'));continue
                        meshes.append(dict(name=node.get('name'),transforms=chain,material=packed,meshDisplay=mesh.get('display',True),
                            traffic=assets.geometry(mesh['instanceGeometryResPath'],mesh.get('instanceMeshIndex',0),mode='particles')))
                        continue
                    meshes.append(dict(name=node.get('name'), transforms=chain, material=packed,
                        meshDisplay=mesh.get('display', True),
                        geometry=assets.geometry(mesh['geometryResPath'],mesh.get('meshIndex',0),area['index'],area['count'])))
        for child in node.get('objects', []):
            visit(child, chain)

    animated_targets = {t['target'] for s in animation.get('sets', []) for t in s.get('tracks', [])}
    display_targets = {t['target'] for s in animation.get('sets', []) for t in s.get('tracks', []) if t['field']=='display'}
    for node in record['children'] + (record.get('assemblyEffects', []) if generic else []):
        if generic or 'fxID' in node:
            visit(node, [])
    if preview_rates:
        # Also upgrades existing capture records. Keep independently animated
        # tracks, which override the settled baseline during playback.
        targets = [dict(t, rate=preview_rates[i]) if i in preview_rates else t
                   for i, t in enumerate(animation['targets'])]
        animation = dict(animation, targets=targets)
    animation = apply_gate_colors(animation, gate_colors)
    if not animation.get('sourceResource'):
        animation = repair_color_samples(animation, color_targets)
    packed_animation={k:v for k,v in animation.items() if k != 'gpuSystem'}
    if record.get('hangar'):
        for haze in record.get('hazes',[]):
            meshes.append(dict(name='Hangar haze',haze=True,transforms=[dict(translation=haze['position'],
                rotation=haze['rotation'],scaling=haze['scaling'])],material=dict(shader='hazespherical.fx',
                parameters=dict(HazeControl=haze['hazeData'],HazeColor=haze['color']),textures={})))
        packed_animation=compact_animation(packed_animation,[meshes,particles,flares,lines])
        packed_animation['hangar']=True
    result = dict(version=VERSION, animation=packed_animation,
                meshes=meshes, particles=particles, flares=flares, lines=lines, unsupported=unsupported,
                limitations=['soft-depth','volumetric-fog','gpu-particle-simulation-approximation'])
    max_particles = (system_bindings or animation.get('gpuSystem', {})).get('maxParticles')
    if max_particles is not None and any(p['emitter']['type'] == 'trinity.Tr2GpuUniqueEmitter' for p in particles):
        result['gpuMaxParticles'] = max_particles
    return result
