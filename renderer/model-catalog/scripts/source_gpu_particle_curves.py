"""Resolve GPU emitter parameters and the particle system's authored shader bindings."""
from sof_texture_schema import fields
from source_particle_emitters import EmitterProjection
from source_particle_materials import SCHEMAS, particle_children
from source_equipment import EquipmentProjection, EFFECT_SCHEMAS, effect_inputs

# Blue exposes these persisted fields on Tr2GpuSharedEmitter and Tr2GpuUniqueEmitter.
# https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2GpuSharedEmitter_Blue.cpp
# Tr2GpuSharedEmitter.cpp zero-initializes params and sets the midpoint to 0.5.
GPU_TYPE = 'Tr2GpuUniqueEmitter'
SCHEMA = dict(SCHEMAS, EveChildParticleSystem=dict(SCHEMAS['EveChildParticleSystem'], particleEmitters='links'),
              Tr2GpuUniqueEmitter=fields(string='name', I='textureIndex turbulenceFrequency',
                  f='rate emissionDensity maxEmissionDensity maxDisplacement inheritVelocity angle innerAngle radius '
                    'minSpeed maxSpeed minLifeTime maxLifeTime sizeVariance colorMidpoint velocityStretchRotation '
                    'drag turbulenceAmplitude gravity attractorStrength', **{'?': 'continuousEmitter scaledByParent',
                    '3f': 'position direction sizes attractorPosition', '4f': 'color0 color1 color2 color3'}))
DEFAULTS = dict(sizes=[0, 0, 0], sizeVariance=0., colorMidpoint=0.5, velocityStretchRotation=0.,
                **{f'color{i}': [0, 0, 0, 0] for i in range(4)})
FORCE_DEFAULTS = dict(gravity=0., drag=0., attractorStrength=0., attractorPosition=[0., 0., 0.],
                      turbulenceAmplitude=0., turbulenceFrequency=1, scaledByParent=False)


BIRTH_DEFAULTS = dict(position=[0., 0., 0.], direction=[0., 1., 0.], radius=0., angle=0.,
                      innerAngle=0., minSpeed=0., maxSpeed=0., inheritVelocity=1.,
                      minLifeTime=0., maxLifeTime=0.,
                      emissionDensity=0., maxEmissionDensity=10000., maxDisplacement=1000.)


def gpu_system_bindings(resources, dist=None):
    # Tr2GpuParticleSystem_Blue.cpp declares the named effects; each effect's
    # serialized TriTextureParameter identifies the texture used by its shader.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2GpuParticleSystem_Blue.cpp
    path = 'res:/fisfx/gpuparticles/system.black'
    reader = EquipmentProjection(resources.read(path), EFFECT_SCHEMAS)
    schema = fields(object='emit clear setDrawParameters setSortParameters sort sortStep sortInner',
                    record='update render', I='maxParticles')
    system = reader.root('Tr2GpuParticleSystem', schema)
    update = effect_inputs(system['update'])
    render = effect_inputs(system['render'])
    bindings = dict(atlas=render['textures']['AtlasMap'], grid=render['parameters']['AtlasMapSize'][1],
                    noise=update['textures']['NoiseMap'], maxParticles=system.get('maxParticles', 1024 * 1024))
    if dist is not None:
        authored = publish_atlas_mips(resources, bindings['atlas'], dist)
        if authored:
            bindings['atlasDDS'] = authored
    return bindings


def publish_atlas_mips(resources, path, dist):
    # DDS_HEADER / DXT5: 16 bytes per 4x4 block at every level, down to 1x1.
    # https://learn.microsoft.com/windows/win32/direct3ddds/dds-header
    import struct
    from pipeline_common import publish
    content = resources.read(path)
    if len(content) < 128 or content[:4] != b'DDS ' or content[84:88] != b'DXT5':
        return None
    height, width = struct.unpack_from('<2I', content, 12)
    levels, = struct.unpack_from('<I', content, 28)
    header_size, flags = struct.unpack_from('<2I', content, 4)
    format_size, format_flags = struct.unpack_from('<2I', content, 76)
    caps2, = struct.unpack_from('<I', content, 112)
    if (header_size != 124 or not flags & 0x20000 or format_size != 32 or not format_flags & 4 or
            caps2 or min(width, height) <= 0 or
            width & (width - 1) or height & (height - 1) or
            levels != max(width, height).bit_length() or levels <= 1):
        return None
    size = 128
    for _ in range(levels):
        size += ((width + 3) // 4) * ((height + 3) // 4) * 16
        width, height = max(1, width // 2), max(1, height // 2)
    if size != len(content):
        raise ValueError('Invalid GPU atlas mip chain: ' + path)
    return dict(url=publish(dist, 'textures', content, 'dds')['url'], dds=True)


class CurveProjection(EmitterProjection):
    particle_fields = {'name', 'particleEmitters'}


def curve_emitters(reader, node, parents=()):
    chain = (*parents, node.get('name', ''))
    for ordinal, bounds in enumerate(node.get('particleEmitters', [])):
        if bounds and reader.class_at(bounds) == GPU_TYPE:
            raw = reader.record_at(bounds)
            defaults = DEFAULTS | FORCE_DEFAULTS | BIRTH_DEFAULTS
            yield (chain, ordinal), (raw.get('name', ''), {k: raw.get(k, v) for k, v in defaults.items()})
    for child in node.get('objects', []):
        yield from curve_emitters(reader, child, chain)


def gpu_curves_for_dna(resources, dna):
    found = {}
    for path, _, reader, root in particle_children(resources, dna, CurveProjection, SCHEMA, (b'tr2gpuuniqueemitter',)):
        try:
            entries = list(curve_emitters(reader, root))
        except ValueError as error:
            if not str(error).startswith(('Unsupported published field:', 'Unsupported published class:')):
                raise
            continue
        for key, (name, curves) in entries:
            source = (resources.key(path), name, curves)
            found[key] = source if key not in found or found[key] == source else None
    return found


def apply_gpu_curves(emitter, source):
    """Preserve settled controller overrides in old records while identifying raw inputs."""
    if not source or source[1] != emitter.get('name', ''):
        origin = emitter.get('sourceFile') or 'capture'
        return dict(emitter, curveSource=origin, forceSource=origin, birthSource=origin)
    path, _, curves = source
    overrides = {k: emitter[k] for k, v in curves.items() if k in emitter and emitter[k] != v}
    return {**emitter, **curves, **overrides, 'curveSource': path, 'forceSource': path, 'birthSource': path,
            'capturedBirthFields': sorted(overrides.keys() & BIRTH_DEFAULTS.keys()),
            'capturedCurveFields': sorted(overrides.keys() & DEFAULTS.keys()),
            'capturedForceFields': sorted(overrides.keys() & FORCE_DEFAULTS.keys())}
