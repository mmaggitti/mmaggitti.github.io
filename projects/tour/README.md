# Tour

A to-scale 3D model of a cryogenic air separation unit, with a 12-stage guided tour of how it makes
oxygen, nitrogen and argon from air. Served at https://mmaggitti.github.io/tour/.

- `index.html`, `tour.js`: the page. Three.js draws the plant. The tour steps the camera through it.
- `model.json`: the plant in meters (equipment, pipes, tour stages, captions). It is generated, so
  do not edit it by hand.
- `tools/asu_scene.py`: the source model. The 2D SVG versions of this drawing come from it too.
- `tools/export_model.py`: writes `model.json`. Run it from this folder:
  `python3 -B tools/export_model.py`. The `-B` keeps `__pycache__` out of the served folder.
- `vendor/`: Three.js 0.170.0 (`three.module.min.js`, `OrbitControls.js`) under the MIT license
  in `LICENSE-three.txt`. It is vendored because the site serves no CDN scripts.
- `test/e2e.mjs`: steps through the tour at phone size. It checks that each stage's subject draws
  between the header and the controls.
