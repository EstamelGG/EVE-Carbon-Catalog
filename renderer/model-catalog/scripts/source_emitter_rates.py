"""Settle the CPU emitter rate bindings in a stationary, undocked SOF preview.

CCP Trinity (MIT), Tr2StateMachine, Tr2ActionAnimateCurveSet::Update,
Tr2ActionPlayCurveSet::Start, Tr2ControllerExpression.cpp (ShipSpeed and ShipMaxSpeed),
TriCurveSet::Apply and TriValueBinding::CopyValue. BLACK IDs link bindings to
actual emitters even when two child meshes use the same emitter name.
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Controllers
"""
from hashlib import sha256

from source_curve_math import expression_value, f32, scalar_value
from source_gate_colors import GateCurveReader
from source_light_rig import LIGHT_RIG_SCHEMAS

# The five CPU rates in this revision have stationary bindings and no exported
# clip tracks. A changed rig needs a new writer audit before omitting samples.
AUDITED_RIG = 'd771f7466afac7782926f6d57def2884948bc055e59f1222135453d382977db7'

CONTROLLERS = {
    'Tr2Controller': dict(name='string', stateMachines='records', variables='records'),
    'Tr2ControllerFloatVariable': dict(name='string', defaultValue='f', variableType='I'),
    'Tr2StateMachine': dict(name='string', states='records', startState='ref'),
    'Tr2StateMachineState': dict(name='string', actions='records', transitions='records'),
    'Tr2StateMachineTransition': dict(name='string', condition='string'),
    'Tr2ActionAnimateCurveSet': dict(value='string', curveSet='record'),
    'Tr2ActionPlayCurveSet': dict(curveSetName='string', rangeName='string'),
    'Tr2ActionSetValue': dict(path='string', attribute='string', value='string'),
    'Tr2CurveSetRange': dict(name='string', startTime='f', endTime='f', looped='?'),
    'Tr2CurveScalarExpression': LIGHT_RIG_SCHEMAS['Tr2CurveScalarExpression'],
}


def bound_float(binding, value):
    return f32(f32(value * binding.get('scale', 1)) + binding.get('offset', [0])[0])


def preview_emitter_rates(content, container_schema, speed_fraction=0):
    if sha256(content).hexdigest() != AUDITED_RIG:
        return {}
    reader = GateCurveReader(content, container_schema)
    reader.schemas.update(CONTROLLERS)
    reader.schemas['EveChildContainer'].update(controllers='ref_list', alwaysOn='?')
    reader.schemas['TriCurveSet']['ranges'] = 'records'
    root = reader.record_at(reader.object_bounds())
    timelines = {s['name']: s for s in root['curveSets']}

    def record(ref):
        reader.binding_definition = ref
        return reader.record_at(reader.references[ref])

    controller = record(root['controllers'][0])
    variables = {v['name']: v.get('defaultValue', 0) for v in controller['variables']}
    times = []
    for machine in controller['stateMachines']:
        state = record(machine['startState'])
        # Resolve the initial transition with the authored controller defaults.
        for transition in state.get('transitions', []):
            variable, literal = transition['condition'].split('==')
            if variables[variable.strip()] == float(literal):
                state = next(s for s in machine['states'] if s['name'] == transition['name'])
                break
        for action in state.get('actions', []):
            if action.get('curveSet'):
                term = action['value']
                time = speed_fraction if term == 'ShipSpeed()/ShipMaxSpeed()' else variables[term]
                times.append((action['curveSet'], time))
            elif action.get('curveSetName'):
                timeline = timelines[action['curveSetName']]
                interval = next(r for r in timeline['ranges'] if r['name'] == action['rangeName'])
                times.append((timeline, interval.get('startTime', 0)))

    outputs = [b for ref in timelines['play_start']['bindings']
               if (b := record(ref)).get('destinationAttribute') == 'rate']
    expressions = {b['sourceObject']: dict(record(b['sourceObject'])) for b in outputs}
    for timeline, time in times:
        for ref in timeline.get('bindings', []):
            binding = record(ref)
            target = expressions.get(binding.get('destinationObject'))
            if target is not None:
                value = scalar_value(record(binding['sourceObject']), time)
                target[binding['destinationAttribute']] = bound_float(binding, value)

    return {b['destinationObject']: bound_float(b, expression_value(expressions[b['sourceObject']], 0))
            for b in outputs}
