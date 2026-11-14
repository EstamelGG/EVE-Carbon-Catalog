"""Build the CPU simulation inputs from a Tr2ParticleSystem BLACK definition.

CCP Trinity (MIT), Tr2ParticleSystem and Tr2ParticleElementDeclaration constructors,
and the matching force classes' constructors and *Blue declarations.
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Particle
"""

from copy import copy

SYSTEM = dict(name='', applyAging=True, updateSimulation=True, applyForce=True,
              requiresSorting=False, isGlobal=False, useSimTimeRebase=False, maxParticleCount=0)
ELEMENT = dict(elementType=4, customName='', dimension=1, usageIndex=0, usedByGPU=True)
STANDARD_NAMES = ('LIFETIME', 'POSITION', 'VELOCITY', 'MASS')
FORCES = {
    'Tr2ParticleDirectForce': dict(force=[1, 1, 1]),
    'EveParticleDirectForce': dict(force=[1, 1, 1]),
    'Tr2ParticleAttractorForce': dict(position=[0, 0, 0], magnitude=1),
    'Tr2ParticleDragForce': dict(drag=0.1),
    'Tr2ParticleFluidDragForce': dict(drag=1),
    'Tr2ParticleTurbulenceForce': dict(amplitude=[1, 1, 1], frequency=[1, 1, 1, 1], noiseLevel=3, noiseRatio=0.5),
}
FORCE_FIELDS = dict(force='3f', position='3f', magnitude='f', drag='f', amplitude='3f',
                    frequency='4f', noiseLevel='I', noiseRatio='f')


def system_reader(emitter_reader):
    # The emitter projection stops once it has the slot declarations. Read the
    # whole system separately: the flags and force list can follow those slots.
    schemas = dict(emitter_reader.schemas)
    schemas['Tr2ParticleSystem'] = dict(schemas['Tr2ParticleSystem'], forces='links',
        constraints='link_count', emitParticleOnDeathEmitter='has_link', emitParticleDuringLifeEmitter='has_link')
    schemas.update({cls: {k: FORCE_FIELDS[k] for k in defaults} for cls, defaults in FORCES.items()})
    reader = copy(emitter_reader)
    reader.schemas = schemas
    reader.objects = {}
    reader.types = {}
    reader.references = emitter_reader.references.copy()
    reader.definitions = emitter_reader.definitions.copy()
    return reader


def authored_system(reader, bounds):
    # Read-only runtime counters and bounds are not simulation inputs. Retain
    # the fallback for systems requiring child emitters or constraint objects.
    raw = reader.record_at(bounds)
    if raw.get('constraints') or raw.get('emitParticleOnDeathEmitter') or raw.get('emitParticleDuringLifeEmitter'):
        return None
    elements = []
    for entry in raw.get('elements', []):
        element = dict(ELEMENT, **entry)
        kind = element['elementType']
        element['name'] = element['customName'] if kind == 4 else STANDARD_NAMES[kind]
        elements.append(dict(element, type='trinity.Tr2ParticleElementDeclaration'))
    forces = []
    for link in raw.get('forces', []):
        if not link or reader.class_at(link) not in FORCES:
            return None
        cls = reader.class_at(link)
        forces.append(dict(FORCES[cls], **reader.record_at(link), type='trinity.' + cls))
    return dict({k: raw.get(k, v) for k, v in SYSTEM.items()}, elements=elements, forces=forces,
                type='trinity.Tr2ParticleSystem')
