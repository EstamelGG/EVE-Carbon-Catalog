"""Material-free interchange validation and packaging, without Blender imports."""
import hashlib
import json
import os
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import zipfile
from core import read_json, write_json, VERSION


def audit_geometry_glb(path, triangles):
    blob = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<III', blob)
    if magic != 0x46546c67 or version != 2 or length != len(blob):
        raise ValueError('Invalid GLB container')
    size, kind = struct.unpack_from('<II', blob, 12)
    if kind != 0x4e4f534a:
        raise ValueError('Missing GLB JSON chunk')
    doc = json.loads(blob[20:20+size])
    for key in ('images', 'textures', 'materials', 'animations', 'skins'):
        if doc.get(key):
            raise ValueError('Unexpected non-geometry content: ' + key)
    count = 0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            attributes = primitive['attributes']
            if any(key.startswith('COLOR_') for key in attributes) or 'material' in primitive:
                raise ValueError('Vertex color or material survived geometry-only export')
            if 'NORMAL' not in attributes or 'TEXCOORD_0' not in attributes:
                raise ValueError('Authored normals or UV0 missing')
            if primitive.get('mode', 4) != 4:
                raise ValueError('Expected triangle mesh')
            count += doc['accessors'][primitive['indices']]['count'] // 3
    if count != triangles:
        raise ValueError('Triangle count changed: %s != %s' % (count, triangles))
    return dict(triangles=count, materials=0, textures=0, vertex_colors=0, normals=True, uv0=True)


def verified_zip(folder, target, files, *, type_id=None):
    folder, target = Path(folder), Path(target)
    if target.exists():
        raise FileExistsError(target)
    files = sorted(Path(p) for p in files)
    manifest = dict(exporter_version=VERSION, files=[])
    if type_id is not None:
        manifest['typeID'] = type_id
    for path in files:
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        manifest['files'].append(dict(path=path.relative_to(folder).as_posix(),
                                      bytes=path.stat().st_size, sha256=digest))
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')
    (folder / 'package-manifest.json').write_bytes(manifest_bytes)
    target.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=target.parent) as staging:
        stage = Path(staging) / target.name
        with zipfile.ZipFile(stage, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in files:
                archive.write(path, target.stem + '/' + path.relative_to(folder).as_posix())
            archive.writestr(target.stem + '/package-manifest.json', manifest_bytes)
        # Reading each entry to EOF verifies its ZIP CRC as well as our SHA-256.
        with zipfile.ZipFile(stage) as archive:
            for entry in manifest['files']:
                with archive.open(target.stem + '/' + entry['path']) as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                        raise ValueError('ZIP checksum mismatch: ' + entry['path'])
            if json.loads(archive.read(target.stem + '/package-manifest.json')) != manifest:
                raise ValueError('ZIP manifest mismatch')
        if os.name == 'nt':
            stage.rename(target)
        else:
            os.link(stage, target)
    return len(files) + 1


def create_geometry_zip(folder, target, metadata):
    name = metadata['slug']
    for ext in ('.glb', '.obj', '.fbx', '.blend'):
        if not (folder / 'converted' / (name + ext)).is_file():
            raise ValueError('Missing geometry deliverable: ' + ext)
    write_json(folder / 'model.json', metadata)
    (folder / 'README.md').write_text(
        '# %s / typeID %s\n\n' % (metadata['name'].get('en', name), metadata['typeID'])
        + 'Material-free static hull: GLB, OBJ, FBX (Unity), and Blender. No textures, paint materials, '
        'vertex colors or MTL. UVs, authored normals, original scale and hull origin are retained; '
        'no decimation or subdivision. Preview gray is applied only by the preview renderer.\n\n'
        + 'Use FBX in Unity with Scale Factor 1, Convert Units enabled, Normals=Import, Weld Vertices disabled; assign one shared neutral gray material. '
        'The original hull may be hundreds of metres across. Scale a parent object for a small prototype; do not rescale source meshes.\n\n'
        + 'Only the primary SOF hull mesh is included. No turrets, child assemblies, decals, lights, animation, '
        'shader displacement, alpha cutouts or normal-map surface detail. Thin surfaces may need a double-sided gray shader. '
        'See conversion-report.json for exact mesh counts, bounds and source references.\n', encoding='utf-8')
    files = [p for p in (folder / 'converted').iterdir() if p.suffix in ('.glb', '.obj', '.fbx', '.blend')]
    files.extend(p for p in (folder / 'raw').iterdir() if p.is_file())
    files.extend(folder / p for p in ('README.md', 'model.json', 'source-manifest.json', 'conversion-report.json'))
    if (folder / 'preview.png').exists():
        files.append(folder / 'preview.png')
    return verified_zip(folder, target, files)
