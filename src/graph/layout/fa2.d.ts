// Typings for the two CommonJS subpaths of graphology-layout-forceatlas2 0.10.1 that ship without .d.ts files.
declare module "graphology-layout-forceatlas2/iterate" {
  export default function iterate(settings: Record<string, unknown>, nodeMatrix: Float32Array, edgeMatrix: Float32Array): void;
}
declare module "graphology-layout-forceatlas2/defaults" {
  const defaults: Record<string, unknown>;
  export default defaults;
}
