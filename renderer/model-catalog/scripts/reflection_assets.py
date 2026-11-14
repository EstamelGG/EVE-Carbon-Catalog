"""Publish preview cubemaps using data-only, official-source scene decoding."""
import hashlib
from pathlib import Path
from pipeline_common import publish, read, write
from source_resources import SourceResources
from source_preview_scene import read_preview_scenes, PREVIEW_SUN_COLOR, PREVIEW_DIFFUSE_INTENSITY


def publish_scene_cubes(resources, dist, scene):
    scene = dict(scene)
    for role in ('reflection', 'diffuse'):
        resource = scene[role]
        scene[role + 'Source'] = resource
        scene[role] = publish(dist, 'lighting', resources.read(resource), 'dds', verify=True)['url']
    return scene


def ensure_reflection_assets(cache, dist, items):
    cache, dist = Path(cache), Path(dist)
    resources = SourceResources(cache)
    indexes = resources.indexes
    revision=hashlib.sha256(repr([(str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in indexes]).encode()).hexdigest()
    races = sorted({'gallente'} | {i['dna'].split(':')[2] for i in items if i.get('dna') and len(i['dna'].split(':'))>2})
    target = dist/'data/reflection-preview.json'
    if target.is_file():
        old = read(target)
        if old.get('version') == 3 and old.get('sourceRevision') == revision and set(races) <= set(old['races']) and all((dist/s[k]).is_file() for s in old['races'].values() for k in ('reflection','diffuse')):
            return old
    scenes = {race: publish_scene_cubes(resources, dist, scene)
              for race, scene in read_preview_scenes(resources, races).items()}
    result=dict(version=3,sourceRevision=revision,races=scenes,
        sunColor=PREVIEW_SUN_COLOR,diffuseIntensity=PREVIEW_DIFFUSE_INTENSITY,
        source='data-only BLACK scene projection; official Blue reader and Trinity scene defaults',
        provenance=dict(
            blue='d9d67648e0ffaae397e6399b3e072e05c2380080',
            trinity='f644516ae4f921f6f3a3e58dc5d19107781571ec',
            resources=list(resources.used.values()),
            displayPolicy='Sun 1.25 and diffuse 3.14 are application exposure choices retained from the visual baseline.'))
    write(target,result)
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--races', nargs='+', default=['gallente'])
    args = parser.parse_args()
    result = ensure_reflection_assets(args.cache, args.output,
                                     [dict(dna='preview:preview:' + race) for race in args.races])
    print('Published %d data-only preview scenes' % len(result['races']))
