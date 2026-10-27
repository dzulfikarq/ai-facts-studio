# Motion Director V1 limitations

- Planning is deterministic and composition-bound; no AI request occurs during planning batch, preview, or render.
- Scene timing is approximate from narration structure and scene duration. No word-level audio alignment is available.
- UV artwork does not identify each ray by wavelength; the partial-transmission path avoids claiming every UV ray is stopped, but does not model UV-B/UV-C proportions.
- Magnetosphere motion follows available charged-particle paths; it does not move UV rays.
- Raster images remain one layer and receive only whole-image transforms; internal depicted objects cannot move independently.
- Path extraction samples existing SVG vector geometry; complex masks, physical simulation, and cross-scene object tracking remain out of scope.