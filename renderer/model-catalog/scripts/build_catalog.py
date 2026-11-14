"""Build the local SDE catalog and 24 ordinary empire T1 frigates.

Run with Blender's bundled Python 3.11. Existing CCPDec exports are untouched.
Source/recipe identities avoid repeated computation; content hashes share files.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
EXPORTER = REPO / 'tools/model_export'
sys.path.insert(0, str(EXPORTER))
from package import find_blender, preferences
from sde import resolve_type
from gltf_uvs import compact_uv_channels
from process_log import run_logged
from cache_lock import file_lock
from cache_compat import fingerprint
from surface_passes import split_surface_passes
from catalog_json import read_json as read, write_json

DIST = ROOT / 'dist'
WORK = ROOT / '.work'
RACES = {4: ('amarr', '艾玛', 'Amarr'), 1: ('caldari', '加达里', 'Caldari'),
         8: ('gallente', '盖伦特', 'Gallente'), 2: ('minmatar', '米玛塔尔', 'Minmatar')}


def write(path, value):
    """Publish catalog metadata after the JSON file has been replaced."""
    write_json(path, value)
    if path.resolve() == (DIST / 'data/catalog.json').resolve():
        from catalog_parts import publish_catalog_parts
        publish_catalog_parts(path, value, write)


def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                                    allow_nan=False).encode()).hexdigest()


def store_resource(target, content):
    """One writer per semantic key, even with two export workers."""
    with file_lock(WORK / 'resource-locks' / (identity(str(target.resolve())) + '.lock')):
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            temporary = target.with_suffix(target.suffix + '.tmp')
            temporary.write_bytes(content)
            temporary.replace(target)


def source_index(cache):
    from source_resources import SourceResources
    index = SourceResources(cache).index
    if not index:
        raise ValueError('SharedCache resource index is missing')
    return {resource: row[2].lower() for resource, row in index.items()}


def reusable_capture(folder, index):
    try:
        if read(folder / 'status.json').get('status') != 'complete':
            return False
        return all(index.get(f['resource'].lower()) == f['md5'].lower()
                   for f in read(folder / 'source-manifest.json')['files'])
    except (OSError, ValueError, KeyError):
        return False


def archive_unused_resources(resources):
    """Keep dist distributable without deleting earlier generated conversions."""
    keep = {r['file'] for r in resources.values()}
    for kind, suffix in [('textures', '.png'), ('textures', '.webp'), ('geometry', '.bin')]:
        folder = DIST / 'assets' / kind
        for path in folder.glob('*' + suffix):
            if path.relative_to(DIST).as_posix() in keep:
                continue
            if not path.resolve().is_relative_to(DIST.resolve()):
                raise ValueError('Refusing to move a resource outside dist')
            target = WORK / 'superseded-assets' / kind / path.name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.move(str(path), str(target))


def rows(folder, name):
    with (folder / (name + '.jsonl')).open(encoding='utf-8-sig') as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def names(row):
    n = row.get('name', {})
    return {'zh': n.get('zh') or n.get('en') or str(row['_key']), 'en': n.get('en', '')}


def catalog(sde, include_blueprints=False, tables=None):
    from model_scope import is_wreck
    read_rows = tables.rows if tables is not None else lambda name: rows(sde, name)
    groups = {r['_key']: r for r in read_rows('groups') if include_blueprints or r.get('categoryID') != 9}
    categories = {r['_key']: r for r in read_rows('categories')}
    graphics = {r['_key']: r for r in read_rows('graphics')}
    items, sample = [], []
    for row in read_rows('types'):
        graphic = graphics.get(row.get('graphicID'))
        group = groups.get(row.get('groupID'))
        if not graphic or not group or not (graphic.get('sofHullName') or graphic.get('graphicFile')):
            continue
        if is_wreck(row):
            continue
        item = dict(id=row['_key'], name=names(row), groupID=row['groupID'],
                    categoryID=group['categoryID'], graphicID=row['graphicID'], raceID=row.get('raceID'),
                    published=bool(row.get('published')), metaGroupID=row.get('metaGroupID'), available=False)
        items.append(item)
        if (row.get('published') and row['groupID'] == 25 and row.get('raceID') in RACES
                and row.get('metaGroupID') in (None, 1)):
            sample.append(item)
    ids = {s['id'] for s in sample}
    tech = {r['_key']: next((a['value'] for a in r.get('dogmaAttributes', []) if a['attributeID'] == 422), None)
            for r in read_rows('typeDogma') if r['_key'] in ids}
    sample[:] = [s for s in sample if tech.get(s['id']) == 1]
    if len(sample) != 24 or any(sum(s['raceID'] == r for s in sample) != 6 for r in RACES):
        raise ValueError('SDE no longer matches 6 ordinary T1 frigates per empire; review selection')
    by_group = {}
    for item in items:
        by_group.setdefault(item['groupID'], []).append(item)
    tree = []
    for cid, cat in categories.items():
        children = [dict(id=gid, name=names(groups[gid]), count=len(members)) for gid, members in by_group.items()
                    if groups[gid]['categoryID'] == cid]
        if children:
            tree.append(dict(id=cid, name=names(cat), groups=sorted(children, key=lambda g: g['name']['en']),
                             count=sum(g['count'] for g in children)))
    metadata = next(read_rows('_sde'))
    return dict(version=1, sde=metadata, categories=sorted(tree, key=lambda c: (c['id'] != 6, c['name']['en'])),
                races=[dict(id=r, slug=v[0], zh=v[1], en=v[2]) for r, v in RACES.items()],
                sampleIDs=sorted(s['id'] for s in sample), sampleScope='published ordinary empire T1 frigates; faction variants excluded',
                items=items), sorted(sample, key=lambda s: (list(RACES).index(s['raceID']), s['id']))


def download(url, destination):
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'CCPDec-local-catalog/1.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        content = response.read()
    destination.write_bytes(content)


def vendor():
    lock_path = ROOT / 'vendor-lock.json'
    if lock_path.exists():
        lock = read(lock_path)
    else:
        with urllib.request.urlopen('https://registry.npmjs.org/@google/model-viewer/latest', timeout=60) as response:
            meta = json.load(response)
        lock = dict(package='@google/model-viewer', version=meta['version'], tarball=meta['dist']['tarball'],
                    integrity=meta['dist'].get('integrity'))
        write(lock_path, lock)
    target = DIST / 'vendor/model-viewer.min.js'
    if not target.exists():
        with urllib.request.urlopen(lock['tarball'], timeout=90) as response:
            content = response.read()
        import base64
        if lock.get('integrity', '').startswith('sha512-'):
            if base64.b64encode(hashlib.sha512(content).digest()).decode() != lock['integrity'][7:]:
                raise ValueError('model-viewer package integrity mismatch')
        with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
            for member, name in [('package/dist/model-viewer.min.js', 'model-viewer.min.js'),
                                 ('package/LICENSE', 'LICENSE-model-viewer')]:
                body = archive.extractfile(member).read()
                dest = DIST / 'vendor' / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(body)
    if not (DIST / 'vendor/model-viewer-ao.min.js').exists():
        npm = shutil.which('npm.cmd') or shutil.which('npm')
        if not npm:
            raise RuntimeError('Install Node.js to build the local viewer with ambient occlusion')
        subprocess.run([npm, 'ci', '--no-audit', '--no-fund'], cwd=ROOT, check=True)
        subprocess.run([npm, 'run', 'build:viewer'], cwd=ROOT, check=True)
    return lock


def glb_parts(path):
    blob = path.read_bytes()
    if struct.unpack_from('<III', blob) != (0x46546c67, 2, len(blob)):
        raise ValueError('Invalid GLB')
    size, kind = struct.unpack_from('<II', blob, 12)
    if kind != 0x4e4f534a:
        raise ValueError('Missing GLB JSON')
    doc = json.loads(blob[20:20 + size])
    offset = 20 + size
    bsize, kind = struct.unpack_from('<II', blob, offset)
    if kind != 0x004e4942:
        raise ValueError('Missing GLB BIN')
    return doc, blob[offset + 8:offset + 8 + bsize]


def texture_recipe(area, role, manifest, converter):
    """Conservative identity; normals/emission need only their effective inputs."""
    params, textures = area['parameters'], area['textures']
    if role == 'normal':
        relevant = ['NormalMap']
        effective = {}
    elif role == 'emission':
        relevant = ['GlowMap']
        effective = {'glow': params.get('GeneralGlowColor', params.get('GeneralHeatGlowColor', [0, 0, 0]))}
    else:
        # Preserve every parameter for composites, including solar-panel cropping.
        relevant = sorted(textures)
        effective = params
    sources = {k: dict(resource=textures[k].lower(), checksum=manifest[textures[k].lower()]['md5'])
               for k in relevant if textures.get(k)}
    recipe = dict(kind='texture', role=role, sources=sources, parameters=effective, converter=converter)
    if role in ('mr_basecolor', 'emission'):
        # The effect selects glass alpha and the emissive transfer curve.
        recipe['effect'] = (area.get('effect') or '').replace('\\', '/').lower()
    return recipe


def externalize(folder, tid, converter):
    from texture_webp import publish, webp_bindings
    data, report = read(folder / 'default-materials.json'), read(folder / 'conversion-report.json')
    manifest = {r['resource'].lower(): r for r in read(folder / 'source-manifest.json')['files']}
    glb = folder / 'converted' / ('ship-%s-metalrough.glb' % tid)
    doc, binary = glb_parts(glb)
    areas = {a['index']: a for a in split_surface_passes(data['areas'])[0]}
    reports = {a['index']: a for a in report['areas']}
    image_recipes = {}
    for material in doc['materials']:
        area_id = int(re.match(r'area(\d+)', material['name']).group(1))
        pbr = material['pbrMetallicRoughness']
        slots = {'mr_basecolor': pbr.get('baseColorTexture'), 'orm': pbr.get('metallicRoughnessTexture'),
                 'normal': material.get('normalTexture'), 'emission': material.get('emissiveTexture')}
        for role, info in slots.items():
            if info is None:
                continue
            image_index = doc['textures'][info['index']]['source']
            if reports[area_id].get('runtimeMaterial'):
                source_role = reports[area_id]['textures'][role]['sourceRole']
                source_name = areas[area_id]['textures'][source_role].lower()
                recipe = dict(kind='source-texture', algorithm='dds-rgba8-v1', source=source_name,
                              checksum=manifest[source_name]['md5'],
                              width=reports[area_id]['textures'][role]['width'],
                              height=reports[area_id]['textures'][role]['height'])
            else:
                recipe = texture_recipe(areas[area_id], role, manifest, converter)
            if role in ('mr_basecolor', 'orm') and not reports[area_id].get('runtimeMaterial'):
                recipe['sail_crop'] = reports[area_id].get('sail_crop')
            old = image_recipes.get(image_index)
            if old and old != recipe:
                raise ValueError('Exporter merged images with different semantic recipes')
            image_recipes[image_index] = recipe
    resources = []
    for i, img in enumerate(doc.get('images', [])):
        recipe = image_recipes[i]
        key = identity(recipe)
        view = doc['bufferViews'][img['bufferView']]
        start = view.get('byteOffset', 0)
        content = binary[start:start + view['byteLength']]
        if not content.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('Expected PNG image')
        target = publish(DIST / 'assets/textures', content)
        content_hash = target.stem
        relative = target.relative_to(DIST).as_posix()
        resources.append(dict(key=key, file=relative, bytes=target.stat().st_size, recipe=recipe, contentHash=content_hash))
        img.pop('bufferView')
        img.pop('mimeType', None)
        img['uri'] = '../textures/' + target.name
    # Retain only geometry views. This removes embedded images from the shared BIN.
    used = set()
    for accessor in doc['accessors']:
        if 'bufferView' in accessor:
            used.add(accessor['bufferView'])
        if 'sparse' in accessor:
            for k in ('indices', 'values'):
                used.add(accessor['sparse'][k]['bufferView'])
    packed, views, remap = bytearray(), [], {}
    for old in sorted(used):
        view = dict(doc['bufferViews'][old])
        packed.extend(b'\0' * ((-len(packed)) % 4))
        start = view.get('byteOffset', 0)
        offset = len(packed)
        packed.extend(binary[start:start + view['byteLength']])
        view.update(buffer=0, byteOffset=offset)
        remap[old] = len(views)
        views.append(view)
    for accessor in doc['accessors']:
        if 'bufferView' in accessor:
            accessor['bufferView'] = remap[accessor['bufferView']]
        if 'sparse' in accessor:
            for k in ('indices', 'values'):
                accessor['sparse'][k]['bufferView'] = remap[accessor['sparse'][k]['bufferView']]
    geom_recipe = dict(kind='geometry', resource=data['geometry'].lower(),
                       checksum=manifest[data['geometry'].lower()]['md5'], meshIndex=data.get('meshIndex', 0),
                       converter=converter, accessors=doc['accessors'], views=views,
                       sail_crops=[a.get('sail_crop') for a in report['areas']])
    geom_key = identity(geom_recipe)
    relative = 'assets/geometry/' + geom_key + '.bin'
    target = DIST / relative
    store_resource(target, packed)
    resources.append(dict(key=geom_key, file=relative, bytes=len(packed), recipe=geom_recipe))
    doc['bufferViews'] = views
    doc['buffers'] = [dict(uri='../geometry/' + geom_key + '.bin', byteLength=len(packed))]
    # Material/mesh instance definitions remain in each small glTF document.
    doc.setdefault('extras', {})['ccpdec'] = dict(typeID=tid, dna=data['dna'], staticHull=not bool(doc.get('animations')),
                                               bonePalette=report.get('bonePalette',[]))
    model = 'assets/models/%s.gltf' % tid
    compact_uv_channels(doc)
    webp_bindings(doc)
    write(DIST / model, doc)
    return dict(model=model, triangles=report['triangles'], vertices=report['vertices'],
                warnings=report['warnings'], modelBytes=len(packed) + sum({r['file']:r['bytes'] for r in resources if r['recipe']['kind'] in ('texture', 'source-texture')}.values()),
                resources=resources)


def export_ship(item, args, converter):
    tid = item['id']
    metadata = args.metadata.get(tid) if getattr(args, 'metadata', None) else resolve_type(args.sde, tid)
    work_key = identity(dict(dna=metadata['dna'], converter=converter))[:16]
    folder = WORK / ('%s-%s' % (tid, work_key))
    candidates = sorted(WORK.glob('%s-%s*' % (tid, work_key)), key=lambda p: p.stat().st_mtime, reverse=True)
    cached = next((p for p in candidates if p.is_dir() and reusable_capture(p, args.source_index)), None)
    if cached:
        folder = cached
        print('  复用已校验的本地导出: ' + folder.name, flush=True)
        if getattr(args, 'strict_assembly', False) and read(folder / 'default-materials.json').get('children', 0):
            raise ValueError('Assembly has child geometry; a complete assembly exporter is required')
    else:
        if folder.exists():
            # Preserve failed attempts for inspection and retry into a new folder.
            import time
            folder = WORK / ('%s-%s-retry-%s' % (tid, work_key, time.time_ns()))
        print('EXPORT_START', tid, item['name']['en'], flush=True)
        command = [sys.executable, '-X', 'utf8', str(EXPORTER / 'export.py'), '--type-id', str(tid),
                   '--name', 'ship-%s' % tid, '--dna', metadata['dna'], '--blender', str(args.blender),
                   '--cache', str(args.cache), '--output', str(folder), '--formats', 'glb', '--animated',
                   '--metalrough-only', '--runtime-materials', '--conversion-cache', str(WORK / 'conversion-cache')]
        if getattr(args, 'strict_assembly', False): command.append('--strict-assembly')
        env = os.environ.copy()
        env.pop('PYTHONHOME', None)
        env.pop('PYTHONPATH', None)
        env['PYTHONUTF8'] = '1'
        log_path = WORK / ('%s-process.log' % tid)
        run_logged(command, log_path, env=env, timeout=1800, label='模型导出')
    print('  阶段: 整理 glTF、共享原始贴图（颜色由网页实时计算）', flush=True)
    result = externalize(folder, tid, converter)
    result.update(dna=metadata['dna'], available=True, exportWork=folder.name)
    print('EXPORT_READY', tid, item['name']['en'], flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sde', type=Path, default=REPO / 'decode_output/sde')
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--blender', type=Path)
    parser.add_argument('--jobs', type=int, default=2)
    parser.add_argument('--catalog-only', action='store_true')
    args = parser.parse_args()
    args.blender = args.blender or find_blender()
    args.cache = args.cache or Path(preferences()['eve_shared_cache_root'])
    args.source_index = source_index(args.cache)
    WORK.mkdir(parents=True, exist_ok=True)
    data, sample = catalog(args.sde)
    data['viewer'] = vendor()
    data['viewer'].pop('integrity', None)
    write(DIST / 'data/catalog.json', data)
    print('CATALOG_READY', len(data['categories']), 'categories;', len(data['items']), 'items;', len(sample), 'sample ships', flush=True)
    if args.catalog_only:
        return
    converter = dict(version=2, animated=True, blender=str(args.blender.parent.name),
                     scripts={n: fingerprint(EXPORTER / n)
                              for n in ['blender_export.py', 'materials.py', 'pixels.py', 'glb.py', 'core.py', 'conversion_cache.py']},
                     dependency=read(EXPORTER / '.deps/tools-blender/ccpdec-dependency.json')['revision'])
    resources, failures = {}, []
    with ThreadPoolExecutor(max_workers=max(1, min(args.jobs, 2))) as pool:
        futures = {pool.submit(export_ship, item, args, converter): item for item in sample}
        for future in as_completed(futures):
            item = futures[future]
            try:
                result = future.result()
                for r in result.pop('resources'):
                    resources[r['key']] = r
                result.pop('exportWork', None)
                item.update(result)
            except Exception as exc:
                failures.append(dict(id=item['id'], error=str(exc)))
                print('EXPORT_FAILED', item['id'], repr(exc), flush=True)
            data['readyCount'] = sum(s.get('available', False) for s in sample)
            write(DIST / 'data/catalog.json', data)
            write(DIST / 'data/resources.json', dict(converter=converter, resources=list(resources.values())))
            write(WORK / 'build-status.json', dict(ready=data['readyCount'], expected=len(sample), failures=failures))
    if failures:
        raise SystemExit('Some exports failed; inspect .work/build-status.json')
    with (WORK / 'web-materials.log').open('w', encoding='utf-8') as log:
        subprocess.run([str(args.blender), '--background', '--factory-startup', '--python-exit-code', '1',
                        '--python', str(ROOT / 'scripts/web_materials.py')], stdout=log, stderr=subprocess.STDOUT,
                       check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    from source_preview_lighting import build_preview
    from source_resources import SourceResources
    write(WORK / 'native-preview.json', build_preview(SourceResources(args.cache)))
    with (WORK / 'native-materials.log').open('w', encoding='utf-8') as log:
        subprocess.run([str(args.blender), '--background', '--factory-startup', '--python-exit-code', '1',
                        '--python', str(ROOT / 'scripts/native_assets.py')], stdout=log, stderr=subprocess.STDOUT,
                       check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    resources = {r['key']: r for r in read(DIST / 'data/resources.json')['resources']}
    from catalog_effect_inputs import catalog_effect_inputs
    catalog_effect_inputs(data['items'], args.cache, WORK / 'native-effects.json', WORK / 'native-effects.log', 180)
    with (WORK / 'effect-assets.log').open('w', encoding='utf-8') as log:
        subprocess.run([str(args.blender), '--background', '--factory-startup', '--python-exit-code', '1',
                        '--python', str(ROOT / 'scripts/effect_assets.py'), '--', str(args.cache)],
                       stdout=log, stderr=subprocess.STDOUT, check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    run_logged([str(args.blender), '--background', '--factory-startup', '--python-exit-code', '1',
                '--python', str(ROOT / 'scripts/plane_assets.py'), '--', str(args.cache)],
               WORK / 'plane-assets.log', timeout=900, label='转换动态光幕')
    resources = {r['key']: r for r in read(DIST / 'data/resources.json')['resources']}
    archive_unused_resources(resources)
    print('DEMO_ASSETS_READY', data['readyCount'], 'ships;', len(resources), 'shared resources', flush=True)


if __name__ == '__main__':
    main()
