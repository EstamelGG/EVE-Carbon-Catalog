# Deathless hangar and Python, 2026-11-13

Both repositories have the annotated tag `baseline/deathless-python-8.7fps-20261113`. The renderer baseline is `8336f25faa1eecc6719d28a3f1f4bc51d598a7de`. The catalog is `12964494df108c986ce2efe82228156b0afd3833`.

The catalog displayed item 85236 in a foreground Edge window on an RTX 4070 using ANGLE D3D11. The model viewport was 974 × 742 at DPR 1. Each sample discarded 24 warm-up intervals and measured 96 intervals between distinct rendered frames using the scene render callback. GPU pass timings came from separate runs using asynchronous WebGL timer queries. A query around the main scene includes its nested opaque buffer draw.

| Run | Mean FPS | P95 frame time |
| --- | ---: | ---: |
| Original fixed view | 8.70 | 129.9 ms |
| Optimized fixed view, two runs | 53.17 / 53.88 | 20.0 / 19.7 ms |
| Optimized orbit, two runs | 50.01 / 50.83 | 21.3 / 21.0 ms |

The orbit advanced by 0.004 radians per browser frame around the default view. Effects continued to animate in both modes. The PNGs show the same default camera at different animation times. Dynamic smoke and video can differ. They support visual inspection, not a synchronized pixel comparison.

- Double-sided transparent rendering increments Three material versions during each draw. Disposing the derived emission material on each increment discarded its compiled programs. The renderer now refreshes the standard material in place. Baseline CPU sampling identified WebGL program queries and shader uploads in steady-state rendering. After the fix the transparent emission pass measured about 0.53 ms on the GPU versus 53.74 ms in the original trace.
- The hangar glTF declares 3,339 skins and references four of them from mesh nodes. Removing empty branches ending in unused joints reduced the active room from 2,240 to 136 bones and from 9,355 to 618 ordinary Object3D nodes. Bound skeletons, animation targets and their ancestors are retained.
- Static light transforms, material keys and effect parameter bindings are reused. Animated values, flickering lights and video lighting continue to update.
- Per-placement frustum compaction and additional flare caches showed no repeatable gain and were dropped.

The optimized trace still submitted 2.46 million triangles in 370 opaque buffer draws plus about 2.51 million in the main color pass. The inclusive GPU time for the main scene was 14.33 ms. A remaining research candidate is screen-error-bounded geometry LOD on distant static architecture only. Evaluate silhouette, normal maps, material boundaries and camera transitions before enabling it. The measured build retains the original meshes, textures, effect settings and framebuffer sizes. Sustained 60 FPS has not been demonstrated.
