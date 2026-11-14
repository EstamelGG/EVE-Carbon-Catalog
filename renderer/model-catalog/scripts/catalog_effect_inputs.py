"""Share the standalone SOF qualification used by the regular catalog worker.

Object selection follows CCP Trinity's EveSOF::SetupEffects / SetupChildSet:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L557-L569
Filtering a mixed publication batch and writing its complete result are local build policy.
"""
from pathlib import Path
import os
from tempfile import TemporaryDirectory

from catalog_json import read_json, write_json
from process_log import run_logged
from sof_attachments import attachment_definitions
from sof_geometry import geometry_for_dna
from sof_light_locators import light_inputs_for_catalog
from sof_resources import SofResources
from source_static_ship import standalone_ship, static_ship_inputs


def static_catalog_scene(resources, item):
    if item.get('categoryID') != 6 or not item.get('dna'):
        return None
    definitions = attachment_definitions(resources, item['dna'])
    if standalone_ship(item, definitions) is None:
        return None
    geometry = geometry_for_dna(resources, item['dna'])
    return static_ship_inputs(item, resources, definitions, geometry)


def catalog_effect_inputs(items, cache, output, log, timeout):
    root = Path(__file__).resolve().parents[2]
    cache = cache.resolve()
    resources = SofResources(cache)
    records = {}
    remaining = []
    for item in items:
        if item.get('available'):
            scene = static_catalog_scene(resources, item)
            if scene is None:
                remaining.append(item)
            else:
                records[str(item['id'])] = scene['effects']
    if remaining:
        client = cache / 'tq/bin64/exefile.exe'
        if not client.is_file():
            ids = ', '.join(str(item['id']) for item in remaining)
            raise FileNotFoundError(f'场景特效仍需客户端处理，物品 {ids}。未找到 {client}')
        with TemporaryDirectory(dir=output.parent) as folder:
            batch = Path(folder)
            write_json(batch / 'catalog.json', {'items': remaining})
            write_json(batch / 'lights.json', light_inputs_for_catalog(cache, remaining))
            env = dict(os.environ, EVE_ROOT=str(cache), EVE_CLIENT_SERVICE='tq',
                       PYTHONHOME=str(root / 'viewer/runtime/python27'),
                       PYTHONPATH=str(root / 'viewer/runtime/python27/Lib'),
                       CCPDEC_CATALOG_FILE=str(batch / 'catalog.json'),
                       CCPDEC_EFFECTS_FILE=str(batch / 'effects.json'),
                       CCPDEC_SOURCE_LIGHT_INPUTS=str(batch / 'lights.json'))
            run_logged([str(client), '/noconsole', '/py', str(root / 'model-catalog/scripts/capture_effects.py')],
                       log, cwd=client.parent, env=env, timeout=timeout, label=log.stem)
            captured = read_json(batch / 'effects.json')
            for item in remaining:
                records[str(item['id'])] = captured[str(item['id'])]
    write_json(output, records)
