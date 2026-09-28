// The renderer seam (Core & Seams SEAMS.md): what an app's 2D/3D view needs from any renderer.
// The template ships the interface only; an app that draws adds an implementation (three.js is
// the default, e.g. renderer-three.ts) and names it in core-and-seams.json.
// Meshes arrive from the core as part-local f32 arrays with f64 transforms (DOCTRINE, CAD precision).

export interface Mesh {
  id: string;
  positions: Float32Array; // xyz per vertex, part-local
  indices: Uint32Array;
  edges?: Float32Array;    // line-segment pairs, part-local
  transform: Float64Array; // 4x4 column-major, world
}

export interface Pick {
  id: string;
  point: [number, number, number];
}

export interface Renderer {
  mount(canvas: HTMLCanvasElement): Promise<void>;
  setScene(meshes: Mesh[]): void;
  setVisible(id: string, visible: boolean): void;
  setSection(plane: [number, number, number, number] | null): void;
  /** Screen point (CSS px) → the nearest surface hit, or null. */
  pick(x: number, y: number): Pick | null;
  /** Draw once; renderers draw on demand, never in a free-running loop. */
  requestFrame(): void;
  dispose(): void;
}
