"""Read dynamic emitter recipes and bind generators to the authored system declaration.

CCP Trinity f644516, trinity/Particle: Tr2DynamicEmitter::Rebind, the three
attribute generators and Tr2ParticleElementDeclaration::GetDimension.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle/Tr2DynamicEmitter.cpp
"""
from bisect import bisect_left

from source_emitter_rates import preview_emitter_rates
from source_particle_systems import authored_system, system_reader
from source_particle_materials import ParticleProjection, SCHEMAS, particle_children


SPHERE = 'Tr2SphereShapeAttributeGenerator'
UNIFORM = 'Tr2RandomUniformAttributeGenerator'
INTEGER = 'Tr2RandomIntegerAttributeGenerator'
SPHERE_DEFAULTS = dict(position=[0, 0, 0], rotation=[0, 0, 0, 1], minPhi=0, maxPhi=360,
                       minTheta=0, maxTheta=360, minRadius=0, maxRadius=0, distributionExponent=1,
                       controlPosition=True, controlVelocity=True, minSpeed=0, maxSpeed=0, parentVelocityFactor=1)
RANGE = dict(elementType='I', customName='string', minRange='4f', maxRange='4f')
SCHEMA = dict(SCHEMAS,
    EveChildParticleSystem=dict(SCHEMAS['EveChildParticleSystem'], particleEmitters='emitter_list',
                                particleSystems='links'),
    Tr2DynamicEmitter=dict(name='string', rate='f', maxParticles='i', generators='records', particleSystem='link'),
    Tr2ParticleSystem=dict(name='string', elements='records', requiresSorting='?', updateSimulation='?',
        applyForce='?', applyAging='?', isGlobal='?', useSimTimeRebase='?', maxParticleCount='I',
        forces='objects', constraints='objects', emitParticleOnDeathEmitter='object', emitParticleDuringLifeEmitter='object'),
    Tr2ParticleElementDeclaration=dict(elementType='I', customName='string', dimension='I', usageIndex='I', usedByGPU='?'),
    Tr2SphereShapeAttributeGenerator={**dict.fromkeys(SPHERE_DEFAULTS, 'f'), 'position':'3f', 'rotation':'4f',
                                     'controlPosition':'?', 'controlVelocity':'?'},
    Tr2RandomUniformAttributeGenerator=RANGE, Tr2RandomIntegerAttributeGenerator=RANGE)


class EmitterProjection(ParticleProjection):
    particle_fields = {'name', 'particleEmitters', 'particleSystems'}

    def __init__(self, content, schemas):
        super().__init__(content, schemas)
        self.definitions = []

    def object_bounds(self):
        # Blue BlackWriter assigns increasing IDs in file order. System
        # declarations may be revisited after a later emitter has been read.
        offset = self.offset
        ref = self.value('I')
        if not ref:
            return None
        known = self.references.get(ref)
        if known:
            if offset + 8 == known[0]:
                self.offset = known[1]
            return known
        index = bisect_left(self.definitions, (offset,))
        if index and ref <= self.definitions[index - 1][1]:
            return None  # The definition was inside an opaque child.
        size = self.value('I')
        bounds = (self.offset, self.offset + size)
        self.take(size)
        self.definitions.insert(index, (offset, ref))
        self.references[ref] = bounds
        return bounds

    def field(self, kind):
        if kind == 'has_link':
            offset = self.offset
            reference = self.value('I')
            self.offset = offset
            self.object_bounds()
            return bool(reference)
        if kind == 'link_count':
            count = self.value('I')
            for _ in range(count):
                self.object_bounds()
            return count
        if kind == 'link':
            return self.object_bounds()
        if kind == 'links':
            return [self.object_bounds() for _ in range(self.value('I'))]
        if kind == 'emitter_list':
            emitters = []
            for _ in range(self.value('I')):
                bounds = self.object_bounds()
                emitter = None
                if bounds and self.class_at(bounds) == 'Tr2DynamicEmitter':
                    emitter = self.record_at(bounds)
                emitters.append(emitter)
            return emitters
        return super().field(kind)


STANDARD = ('LIFETIME', 'POSITION', 'VELOCITY', 'MASS')
WIDTH = (2, 3, 3, 1)


def element_key(field):
    kind = field.get('elementType', 4)
    return (kind, field.get('customName', '') if kind == 4 else '')


def bind_generators(reader, emitter, system):
    dimensions = {}
    for element in system.get('elements', []):
        if element is None:
            return None
        key = element_key(element)
        kind = key[0]
        if kind > 4 or key in dimensions:
            return None
        dimensions[key] = element.get('dimension', 1) if kind == 4 else WIDTH[kind]
    bound = set()
    generators = []
    for raw in emitter.get('generators', []):
        if raw is None:
            return None
        cls = reader.types[id(raw)]
        if cls == SPHERE:
            recipe = dict(SPHERE_DEFAULTS, **raw)
            keys = {(k, '') for k, enabled in ((1, recipe['controlPosition']), (2, recipe['controlVelocity'])) if enabled}
            recipe['name'] = ' + '.join(STANDARD[k] for k, _ in sorted(keys)) or 'NONE'
        elif cls in (UNIFORM, INTEGER):
            k = element_key(raw)
            width = dimensions.get(k, 0)
            if not 1 <= width <= 4:
                return None
            keys = {k}
            recipe = dict(elementType=k[0], customName=raw.get('customName', ''), dimension=width,
                          name=k[1] if k[0] == 4 else STANDARD[k[0]],
                          minRange=raw.get('minRange', [0]*4), maxRange=raw.get('maxRange', [0]*4))
        else:
            return None
        if not keys <= dimensions.keys() or keys & bound:
            return None
        bound.update(keys)
        generators.append(dict(recipe, type='trinity.' + cls, valid=True))
    return generators if bound == dimensions.keys() else None


def node_emitters(reader, node, settled_by_object, system_inputs, parent=()):
    chain = (*parent, node.get('name', ''))
    systems = node.get('particleSystems', [])
    for index, emitter in enumerate(node.get('particleEmitters', [])):
        if not emitter or not emitter.get('particleSystem') or emitter['particleSystem'] not in systems:
            continue
        if reader.class_at(emitter['particleSystem']) != 'Tr2ParticleSystem':
            continue
        system = reader.record_at(emitter['particleSystem'], required_fields={'elements'})
        generators = bind_generators(reader, emitter, system)
        if generators is not None:
            recipe = dict(type='trinity.Tr2DynamicEmitter', name=emitter.get('name', ''),
                    rate=emitter.get('rate', 0), maxParticles=emitter.get('maxParticles', -1),
                    systemIndex=systems.index(emitter['particleSystem']), generators=generators)
            bounds = emitter['particleSystem']
            if bounds not in system_inputs:
                try:
                    system_inputs[bounds] = authored_system(system_reader(reader), bounds)
                except ValueError as error:
                    if not str(error).startswith(('Unsupported published field:', 'Unsupported published class:')):
                        raise
                    system_inputs[bounds] = None
            if system_inputs[bounds] is not None:
                recipe['system'] = system_inputs[bounds]
            if id(emitter) in settled_by_object:
                recipe['previewRate'] = settled_by_object[id(emitter)]
            yield (chain, index), recipe
    for child in node.get('objects', []):
        yield from node_emitters(reader, child, settled_by_object, system_inputs, chain)


def emitters_for_dna(resources, dna):
    results = {}
    for path, content, reader, root in particle_children(resources, dna, EmitterProjection, SCHEMA, (b'tr2dynamicemitter',)):
        try:
            rates = preview_emitter_rates(content, SCHEMA['EveChildContainer'])
            settled = {id(reader.objects[reader.references[ref][0]]): rate for ref, rate in rates.items()}
            entries = list(node_emitters(reader, root, settled, {}))
        except ValueError as error:
            if not str(error).startswith(('Unsupported published class:', 'Unsupported published field:')):
                raise
            continue
        for key, recipe in entries:
            value = (resources.key(path), recipe)
            results[key] = value if key not in results or results[key] == value else None
    return results


def resolve_dynamic_emitter(emitter, source, targets):
    if not source:
        return dict(emitter, generatorSource=emitter.get('sourceFile') or 'capture')
    path, recipe = source
    # node_emitters resolves particleSystem against this owner's ordered BLACK references.
    # An older scene record may provide an index to cross-check or omit the field.
    index = emitter.get('systemIndex')
    if index is None:
        matches_system = 'system' in recipe
    else:
        matches_system = index == recipe['systemIndex']
    if recipe['name'] != emitter.get('name', '') or not matches_system:
        return dict(emitter, generatorSource=emitter.get('sourceFile') or 'capture')
    result = dict(recipe, generatorSource=path)
    result.pop('system', None)
    preview_rate = result.pop('previewRate', None)
    target = emitter.get('fxID')
    if target is not None:
        result['fxID'] = target
    if preview_rate is not None:
        result.update(rate=preview_rate, rateSource=path)
        return result
    has_rate_target = target is not None and 0 <= target < len(targets) and 'rate' in targets[target]
    sampled_rate = emitter.get('rate', recipe['rate'])
    if not has_rate_target and sampled_rate != recipe['rate']:
        result.update(rate=sampled_rate, rateSource='capture')
    return result
