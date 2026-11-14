"""Original palette/paint policy shared with the web renderer.

Four equally spaced palette stops are our asset interpretation, not a claim
about a missing Carbon shader. Paint roughness .6 is an explicit art choice.
Equations: Khronos glTF 51fde5dc47ac3178594e58a548f936e2910a8239,
extensions/2.0/Khronos/KHR_materials_ior/README.md (IOR -> F0), and
extensions/2.0/Archived/KHR_materials_pbrSpecularGlossiness/README.md
(alpha = (1 - gloss)^2). The glow-response controls separately fit measured
first-generation preview output (docs/source-remediation-78-evidence.json).
"""
import json
from pathlib import Path
import numpy as np

POLICY_PATH = Path(__file__).resolve().parents[2] / 'shared/material-policy.json'
POLICY = json.loads(POLICY_PATH.read_text(encoding='utf-8'))
PAINT_F0 = ((POLICY['paintIOR'] - 1) / (POLICY['paintIOR'] + 1)) ** 2
PAINT_GLOSS = 1 - POLICY['paintPerceptualRoughness']


def weights(mask):
    """Partition of unity: interpolate only the two adjacent palette stops."""
    position = np.clip(np.asarray(mask), 0, 1) * 3
    return np.maximum(1 - abs(position[..., None] - np.arange(4, dtype=position.dtype)), 0)


def paint_diffuse(albedo, base, coverage):
    tint = base * (1 - coverage[..., None]) + coverage[..., None]
    return np.clip(albedo * tint, 0, 1)


def paint_fresnel(base, coverage):
    return np.clip(base * (1 - coverage[..., None]) + PAINT_F0 * coverage[..., None], 0, 1)


def surface_alpha(gloss, texture, coverage):
    return np.clip(1 - (gloss * texture * (1 - coverage) + PAINT_GLOSS * coverage), 0, 1) ** 2


def perceptual_roughness(alpha):
    """glTF/Principled input, distinct from the internal microfacet alpha."""
    return np.sqrt(np.clip(alpha, 0, 1))


def is_glass_effect(effect):
    shader = effect.replace('\\', '/').rsplit('/', 1)[-1].lower()
    return shader in ('quadglassv5.fx', 'skinned_quadglassv5.fx')


def glow_response(mask, effect):
    """Monotone preview response fitted to measured grayscale output (segment 78)."""
    family = 'glass' if is_glass_effect(effect) else 'hull'
    low, middle = POLICY['glowResponse'][family]
    x = np.clip(mask, 0, 1)
    return x * x * ((1 - x) * ((1 - x) * low + x * middle) + x * ((1 - x) * middle + x))
