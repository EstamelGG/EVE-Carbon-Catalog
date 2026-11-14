"""Lossless sharing of sampled values; timing and target bindings stay inline."""
import json
import math
import re

ANIMATION_URL = re.compile(r'assets/effect-animation/[0-9a-f]{64}\.json\Z')
MIN_SHARED_BYTES = 1024


def valid_samples(values):
    def sample(value):
        if isinstance(value, (int, float)): return math.isfinite(value)
        return isinstance(value, list) and bool(value) and all(type(v) in (int,float) and math.isfinite(v) for v in value)
    return isinstance(values,list) and bool(values) and all(sample(v) for v in values)


def split_animation(document, emit):
    # Called on the publisher's private copy, never on capture/task input data.
    for name in ('gate', 'scene'):
        animation = (document.get(name) or {}).get('animation') or {}
        for clip in animation.get('sets', []):
            for track in clip.get('tracks', []):
                values = track.get('values')
                if not isinstance(values,list): continue  # already shared
                content = json.dumps(values,ensure_ascii=False,separators=(',', ':'),allow_nan=False).encode('utf-8')
                if len(content) >= MIN_SHARED_BYTES:
                    if not valid_samples(values): raise ValueError('Invalid animation samples')
                    track['values'] = {'url':emit(content)}
    return document
