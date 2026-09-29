# Car engine (cad-kernel)

The four-cylinder engine that cad-kernel builds: a CAD kernel written from scratch in Rust, whose
source is private. This folder publishes built output only.

- `public/pkg/`: the kernel's WebAssembly build and its wasm-bindgen glue (`cadk-wasm`, profile
  `wasm`, source paths remapped out with `--remap-path-prefix`).
- `public/model/`: the engine's package (the recipe: `manifest.json` and the files it lists), the
  display cache the native kernel wrote for it (`display.glb`, with each face's persistent name),
  the native build's SHA-256 of every result file (`digests.json`), and its joints solved every
  degree through two crank revolutions (`motion.json`).
- `src/`: the viewer (Three.js) and the worker that runs the kernel.

The page shows the native build and turns the crank with the native solutions, so it is instant.
"Rebuild here" runs the kernel in a worker: it rebuilds the engine from the recipe (about 25 s
in desktop Chromium), compares each result file with `digests.json`, and from then on the slider
solves the joints in the browser's kernel.

To update: rebuild the kernel's wasm and the engine's package, results and motion (`engine-package`,
`cadk-rebuild`, `cadk-cycle --step 1`) in the kernel's repo, and copy them into `public/` as above.
