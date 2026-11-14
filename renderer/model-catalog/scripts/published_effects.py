"""Validate published effect dependencies without importing Blender."""
import json


def texture_urls(value):
    if isinstance(value, dict):
        if 'url' in value:
            yield value['url']
        if value.get('video'):
            yield from value.get('playlist', [])
        for child in value.values():
            yield from texture_urls(child)
    elif isinstance(value, list):
        for child in value:
            yield from texture_urls(child)


def load_effects(path, dist, refresh=False):
    """Refresh skips incomplete outputs; normal publishing must still fail."""
    try:
        result = json.loads(path.read_text(encoding='utf-8-sig'))
        for url in set(texture_urls(result)):
            dependency = dist / url
            if not dependency.is_file() or dependency.stat().st_size == 0:
                raise FileNotFoundError('Missing effect dependency: ' + str(dependency))
        return result
    except (FileNotFoundError, json.JSONDecodeError):
        if not refresh:
            raise
        print('EFFECT_REFRESH_SKIPPED', path.name, 'incomplete output; needs rebuild', flush=True)
        return None
