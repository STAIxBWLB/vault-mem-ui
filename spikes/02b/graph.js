import Graph from 'graphology';

// Index offsets used to build edges: each node links to (i + offset) % order.
export const EDGE_SETS = {
  sparse: [1, 17, 101], // 10,000 nodes -> 30,000 edges
  dense: [1, 7, 17, 29, 41, 53, 67, 79, 91, 101] // 10,000 nodes -> 100,000 edges
};

export function makeGraph(order, edgeSet = 'sparse', seed = 123456) {
  const graph = new Graph({ type: 'undirected', multi: true });
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < order; i++) {
    graph.addNode(String(i), { x: random() * 1000, y: random() * 1000, size: 1 });
  }
  const offsets = EDGE_SETS[edgeSet];
  for (let i = 0; i < order; i++) {
    for (const d of offsets) graph.addUndirectedEdge(String(i), String((i + d) % order));
  }
  return graph;
}

// Node order, positions and edge endpoints as arrays the worker can take over.
export function toTransferArrays(graph) {
  const nodes = graph.nodes();
  const index = new Map(nodes.map((node, i) => [node, i]));
  const x = new Float32Array(nodes.length);
  const y = new Float32Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    x[i] = graph.getNodeAttribute(nodes[i], 'x');
    y[i] = graph.getNodeAttribute(nodes[i], 'y');
  }
  const edgePairs = new Uint32Array(graph.size * 2);
  let e = 0;
  graph.forEachEdge((_edge, _attr, source, target) => {
    edgePairs[e++] = index.get(source);
    edgePairs[e++] = index.get(target);
  });
  return { order: nodes.length, nodes, x, y, edgePairs };
}

export function writePositions(graph, matrix, stride) {
  let n = 0;
  graph.forEachNode((_node, attr) => {
    attr.x = matrix[n];
    attr.y = matrix[n + 1];
    n += stride;
  });
}
