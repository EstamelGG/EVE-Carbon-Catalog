# Modular hangar berths

Verified against the local published catalog (9 modular rooms, 15 berths). Run
`node scripts/check-modular-berths.mjs <published-directory>` from `model-catalog`.
The check compares selected platform roots with the placed glTF geometry,
and verifies final locator transforms for small, medium and capital hull classes.

| Rooms | Small / medium / capital placement |
| --- | --- |
| AIR | Compose the installed platform with its own small or medium ship locator. The medium locator adds a half-turn. |
| Deathless, Deathless FOB | Use the selected instance of the Deathless platform and its local ship locator, including the rotated small FOB pad. |
| Upwell standard, engineering, refinery | Use the assembled small/medium placement; the platform prefabs do not supply another ship locator. The small hangar has a recessed floor. |
| Citadel, engineering and refinery capital | The room's `ship_placement` is a ship origin in open space at (0, 0, 16500), not a floor on which to place a bounding box. |

Local transforms decoded using CarbonEngineJS's BLACK reader from the original
Tranquility SOF hull resources under `res:/dx9/model/spaceobjectfactory/hulls/`:

| Prefab | BLACK content MD5 (game index) | Locator | Local position (m), rounded |
| --- | --- | --- | --- |
| mairpl_s_01a | b13adbf3b8caeaaf4745672c6e1fc1c7 | small_dock_ships | (0, 27, −168.685) |
| mairpl_m_01a | f86c50e2b2b84a96480a7f32c2ecb4bc | medium_dock_ships | (0, 91.819, 336.815); yaw 180° |
| mdepl_s_01a | 6b48f58a1a2f6a34f8b787edafd6b8b8 | small_dock_ships | (0, −0.021, −0.049) |
| mdepl_m_01a | ce049febcca8379f97f09bc17933c7bb | medium_dock_ships | (−0.660, −0.371, −0.206) |

The room owns the platform instance; translations are rotated by that
instance before adding them. Preserve the ship pivot in the horizontal
plane. Room-level Upwell placements were checked against the original
`mgenh_gb01`; capital placements against `mgenh_ch01`.

The ship's vertical display offset on open Deathless and Upwell medium decks
is a viewer estimate inherited from the Python/Deathless visual experiment:
0.48 × hull radius, with a floor at the hull's measured underside. AIR's
elevated locator already provides height; add only the amount needed to keep
the hull above the platform origin. These rules are not client-authored
per-ship clearance, a geometry collision solver, or a claim of exact native parity.

Browser checks: Atron (608) in six small berths, Python (85236) in six medium
berths and Erebus (671) in all three capital rooms. The reported Rokh (24688)
was also exercised in Deathless, Deathless FOB and Upwell. Loading Deathless
from the Rokh's details and selecting the Rokh from an Astrahus returned the
same room anchor, ship pivot and heading. The resulting bottom of the Rokh
bounding box is 147.9 m above the Deathless ship locator (not a measurement
of the distance to every deck triangle).
