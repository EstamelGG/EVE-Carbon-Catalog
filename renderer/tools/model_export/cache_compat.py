"""Audited compatible exporter hashes; unknown future code invalidates."""
import hashlib

# Adding locks changes neither exported geometry nor decoded pixels. Match the
# exact audited file bytes, rather than blindly freezing a semantic version.
# Directional overlays previously failed before export; successful ordinary
# hull exports and DDS pixels are unchanged by this additive feature.
ALIASES = {
    # Batched animation keys retain the same sampled values and interpolation.
    'c459c3f3ad5a1cd55b58878b76c34aa040ebaeba21d0e090078aca231e50cdcb': 'df3157ca974c4de8fedcf1f956033bda905420a0bf04668da6758eef5ee03a2c',
    '8ac56496984c5ff47c9cba39be425ebf25fe2fbddb3debafdd04891f1044e3c8': 'df3157ca974c4de8fedcf1f956033bda905420a0bf04668da6758eef5ee03a2c',

    # Projected patterns, independent FX, and validation of invalid topology.
    '236a567045ed7d2bd87500ab67f515bfc6839124039d23d6d500397f5a8afaf5': 'df3157ca974c4de8fedcf1f956033bda905420a0bf04668da6758eef5ee03a2c',
    '6a765c789cbf30098d04525fcfae40f69d682ef1873ec84468f3908c6b42d88c': 'df3157ca974c4de8fedcf1f956033bda905420a0bf04668da6758eef5ee03a2c',

    '73f3780384e0b9110711fcc2eea96d49e49958ebe2defffbf62e5c61b31c8438': 'df3157ca974c4de8fedcf1f956033bda905420a0bf04668da6758eef5ee03a2c',
    '5b002e5b80ba92a96c1871db80a43f88a5449d3b56d8663bb0bb688b15e04d05': 'df3157ca974c4de8fedcf1f956033bda905420a0bf04668da6758eef5ee03a2c',

    '599c241eac49fb99d1997072900413745d68ad08eaa63a6541395c6dfed841c9': '85ab81348a198bea9bce173acdcd173c31067ef32c0928de3cc199aca85c9bfa',
    '686fc06dcbe6761ca831f726eb7d21c2ca1a092f3cb52d18c4d3a6a64a8383be': 'df3157ca974c4de8fedcf1f956033bda905420a0bf04668da6758eef5ee03a2c',
    '4084e50048155df7eab6d98143eac3c5a288cc6417d0f445dd41ff03691b9cb2': '85ab81348a198bea9bce173acdcd173c31067ef32c0928de3cc199aca85c9bfa',
}


def fingerprint(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return ALIASES.get(digest, digest)
