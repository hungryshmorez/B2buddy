Unmodified copies of three files from the supplied archive `trippy_effects_for_trippy_me_by_SOFAKINGSADBOI.zip`.
The archive contains no licence file; it was supplied by the project owner for this game. Confirm terms before public redistribution.

| File here | Used by | How |
|---|---|---|
| webgl-shaders.js | src/game/fx/trippyShaders.ts | GLSL for `liquidDistortion` and `fractalNoise` copied verbatim (checked by test) |
| datamosh-effects.js | src/game/fx/trippy.ts | slices / RGB split / block movement / noise ported to pure functions |
| effects.css | src/game/ui/game.css | `.crt-effect` and `.vhs-tracking` ported as `.tfx-crt` / `.tfx-vhs` |

Not used: neural-effects, sparkle-effects, videoCube, chatbot, pixel sorting, compression artifacts (see docs/SPECTATOR-SHOW.md).
