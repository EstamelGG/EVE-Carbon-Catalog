"""Publish shared effect geometry and animation for builds and offline migration."""
import hashlib
import json
import re
from pathlib import Path

from pipeline_common import atomic_bytes, publish
from shared_effect_animation import ANIMATION_URL, split_animation, valid_samples

GEOMETRY_URL = re.compile(r'assets/effect-geometry/[0-9a-f]{64}\.json\Z')


def is_geometry(value):
    return isinstance(value, dict) and isinstance(value.get('position'), list) and isinstance(value.get('indices'), list)


def geometry_bytes(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def split_geometry(value, emit):
    """Replace only complete geometry objects; retain every field and number."""
    if is_geometry(value): return {'url': emit(geometry_bytes(value))}
    if isinstance(value, dict):
        return {k:split_geometry(v, emit) if isinstance(v, (dict,list)) else v for k,v in value.items()}
    if isinstance(value, list):
        # Scalar arrays (including animation samples) are immutable here.
        return [split_geometry(v, emit) if isinstance(v, (dict,list)) else v for v in value]
    return value


def publish_effects(dist, effects):
    dist = Path(dist)
    resources = {}
    def emit(content, kind='effect-geometry'):
        digest = hashlib.sha256(content).hexdigest()
        url = 'assets/'+kind+'/'+digest+'.json'
        if url not in resources:
            path = dist/url
            # Unlike a size-only test, this also detects a corrupt cached asset.
            if not path.is_file() or path.read_bytes() != content: atomic_bytes(path, content)
            resources[url] = dict(key=digest, file=url, bytes=len(content), recipe={'kind':kind+'-v1'})
        return url
    document = split_geometry(effects, emit)
    document = split_animation(document, lambda content: emit(content, 'effect-animation'))
    # An already migrated document remains valid and records its dependencies.
    from published_effects import texture_urls
    for url in set(texture_urls(document)):
        geometry = bool(GEOMETRY_URL.fullmatch(url))
        animation = bool(ANIMATION_URL.fullmatch(url))
        if (geometry or animation) and url not in resources:
            content = (dist/url).read_bytes()
            valid = is_geometry if geometry else valid_samples
            if hashlib.sha256(content).hexdigest() != Path(url).stem or not valid(json.loads(content)):
                raise ValueError('Invalid shared effect resource: '+url)
            emit(content, 'effect-geometry' if geometry else 'effect-animation')
    effect = publish(dist, 'effects', json.dumps(document, ensure_ascii=False,
                     separators=(',', ':'), allow_nan=False).encode('utf-8'), 'json', verify=True)
    return effect, list(resources.values())


def publish_catalog_effects(dist, effects, resources):
    """Publish refreshed catalog effects using the same physical keys as v2 assembly."""
    from published_effects import load_effects, texture_urls
    effect, shared = publish_effects(dist, effects)
    document = load_effects(dist / effect['url'], dist)
    urls = set(texture_urls(document))
    size = effect['bytes'] + sum((dist / url).stat().st_size for url in urls)
    for row in shared:
        resources[row['key']] = row
    digest = effect['contentHash']
    resources[digest] = dict(key=digest, file=effect['url'], bytes=effect['bytes'], recipe={'kind': 'effects-v2'})
    return dict(effects=effect['url'], effectsBytes=size)
