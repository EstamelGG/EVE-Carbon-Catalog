"""Version 2 pipeline contracts. No reads from legacy build checkpoints/caches."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from pipeline_rpc import read_json

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
WORK = ROOT / '.work/pipeline-v2'
VERSIONS = dict(capture=1, plan=2, source=1, decode=3, texture=1, geometry=3, mesh=1, assemble=1, preview=2)


def key(kind, inputs):
    content = json.dumps([kind, VERSIONS[kind], inputs], sort_keys=True, ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(content.encode()).hexdigest()


def read(path):
    return read_json(path)


def write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    atomic_bytes(path, content)


def atomic_bytes(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name+'.', suffix='.tmp', delete=False) as f:
        temporary = Path(f.name)
        f.write(content)
    try:
        for attempt in range(40):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt == 39: raise
                time.sleep(.05)
    finally:
        temporary.unlink(missing_ok=True)


def matches_digest(path, size, digest):
    if not path.is_file() or path.stat().st_size != size:
        return False
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest() == digest


def publish(dist, kind, content, extension, *, verify=False):
    digest = hashlib.sha256(content).hexdigest()
    url = 'assets/%s/%s.%s' % (kind, digest, extension)
    path = Path(dist) / url
    # Hash naming is a storage contract, not the scheduling/deduplication key.
    valid = matches_digest(path, len(content), digest) if verify else path.is_file() and path.stat().st_size == len(content)
    if not valid:
        atomic_bytes(path, content)
    return dict(url=url, bytes=len(content), contentHash=digest)


def resolve_refs(value, results):
    if isinstance(value, dict):
        if '$task' in value:
            return results[value['$task']][value.get('field', 'value')]
        return {k: resolve_refs(v, results) for k, v in value.items()}
    if isinstance(value, list): return [resolve_refs(v, results) for v in value]
    return value
