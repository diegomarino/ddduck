#!/usr/bin/env node

/**
 * Renders generated/graph/model-graph.json to the canonical SVG view
 * generated/graph/model-graph.svg using the Graphviz WASM engine
 * (@hpcc-js/wasm): pure JS + WASM, no system binary, so it stays offline and
 * deterministic. Because rendering is async, init, the operation runner, check,
 * and query all invoke this script as a child process. Experimental layout
 * variants (--layout/--all-layouts) land under .ddduck/graph-layouts/, outside
 * the generated-view contract. A hosted render API (e.g. Kroki) is a possible
 * future fallback but is intentionally not the default.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContainedOutput } from "./lib/product-paths.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

export const jsonInputPath = path.join("generated", "graph", "model-graph.json");

// Graphviz layout engines worth comparing for a model graph. `dot` is the
// hierarchical default; the force-directed and radial engines often read better
// once the ownership tree gets wide. Variant output goes to
// `.ddduck/graph-layouts/model-graph.<engine>.svg`.
export const LAYOUT_ENGINES = ["dot", "twopi", "circo", "fdp", "sfdp", "neato"];

// Only `dot` and `fdp` do cluster-aware layout. The other engines still *draw*
// cluster boxes but place nodes without respecting the groups, so the boxes
// overlap — for those we emit a flat (unclustered) graph instead.
const CLUSTER_ENGINES = new Set(["dot", "fdp"]);

export function engineSupportsClusters(engine) {
  return CLUSTER_ENGINES.has(engine);
}

// The canonical diagram: dot layout, clustered, with a legend. This is what the
// pipeline generates by default and pins in the freshness check.
export const svgOutputPath = path.join("generated", "graph", "model-graph.svg");
export const canonicalEngine = "dot";

// Experimental layout variants (`--layout` / `--all-layouts`) are not part of
// the generated-view contract: `generated/` holds only the canonical views that
// `ddduck generate` refreshes and `ddduck check` gates. Variants land in the
// `.ddduck/` tool-metadata area instead, so they can never rot unswept inside
// `generated/`.
export function svgOutputPathFor(engine) {
  return path.join(".ddduck", "graph-layouts", `model-graph.${engine}.svg`);
}

// Visual vocabulary keyed by the graph's node/edge `kind`. Shapes and fills are
// chosen so the ownership spine (Model → Domain → members) reads at a glance and
// each node kind is distinguishable without a legend.
const NODE_STYLE = {
  Model: { shape: "doublecircle", fillcolor: "#1f2933", fontcolor: "white" },
  Domain: { shape: "box", style: "rounded,filled", fillcolor: "#b8c4d0" },
  Concept: { shape: "ellipse", fillcolor: "#e4ebf2" },
  DomainInterface: { shape: "component", fillcolor: "#d6e2c4" },
  UseCase: { shape: "note", fillcolor: "#f2e6c4" },
  Guarantee: { shape: "hexagon", fillcolor: "#f2cdc4" },
  Relationship: { shape: "diamond", fillcolor: "#e0d4ec" },
};
const DEFAULT_NODE_STYLE = { shape: "ellipse", fillcolor: "#eeeeee" };

// Structural ownership is the backbone (solid); every reference edge is dashed
// so the eye separates "what contains what" from "what points at what".
const EDGE_STYLE = {
  owns: { style: "solid", color: "#52606d" },
  relationship: { style: "solid", color: "#1f2933" },
  requires: { style: "dashed", color: "#7b8794" },
  preserves: { style: "dashed", color: "#7b8794" },
  establishes: { style: "dashed", color: "#7b8794" },
  uses: { style: "dashed", color: "#7b8794" },
  guarantees: { style: "dashed", color: "#7b8794" },
};
const DEFAULT_EDGE_STYLE = { style: "solid", color: "#7b8794" };

// Quote and escape a value for use as a DOT string literal.
function dotString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

// Render an attribute map as `key=value` pairs (values are DOT-escaped).
function dotAttrs(attrs) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${dotString(value)}`)
    .join(", ");
}

// The node kind is decoded by the legend (shape + fill per kind), so the label
// carries only the name — no per-node `(Kind)` sublabel to repeat what the
// legend already says.
function nodeLabel(node) {
  return node.name ?? node.id;
}

function nodeStatement(node) {
  const style = NODE_STYLE[node.kind] ?? DEFAULT_NODE_STYLE;
  const attrs = {
    label: nodeLabel(node),
    shape: style.shape,
    style: style.style ?? "filled",
    fillcolor: style.fillcolor,
    fontcolor: style.fontcolor,
    tooltip: node.purpose ?? undefined,
  };
  return `  ${dotString(node.id)} [${dotAttrs(attrs)}];`;
}

// A DOT subgraph is only drawn as a bounding box when its name starts with
// `cluster`. Sanitize the domain id into a valid, collision-free cluster name.
function clusterId(domainId) {
  return `cluster_${domainId.replace(/[^A-Za-z0-9]+/g, "_")}`;
}

// Group each Domain node and the nodes it owns (via `ownerDomain`) into its own
// cluster; everything else (Model, use cases, relationships) stays top level.
// Only `dot` (and partly `fdp`) draw the boxes — other engines ignore them
// harmlessly.
function partitionByDomain(nodes) {
  const domainIds = new Set(nodes.filter((node) => node.kind === "Domain").map((node) => node.id));
  const clusters = new Map();
  const ungrouped = [];

  const clusterFor = (domainId) => {
    if (!clusters.has(domainId)) clusters.set(domainId, { domain: null, members: [] });
    return clusters.get(domainId);
  };

  for (const node of nodes) {
    if (node.kind === "Domain") {
      clusterFor(node.id).domain = node;
    } else if (node.ownerDomain && domainIds.has(node.ownerDomain)) {
      clusterFor(node.ownerDomain).members.push(node);
    } else {
      ungrouped.push(node);
    }
  }
  return { clusters, ungrouped };
}

// A self-contained legend cluster: one swatch per node kind (drawn with its real
// shape and fill so the mapping is exact) plus a one-line note decoding the edge
// styles. Built from NODE_STYLE so it can never drift from the real vocabulary.
// Only meaningful under a ranked (dot/fdp) layout, so it rides with `clusters`.
function legendStatements() {
  const swatches = Object.keys(NODE_STYLE).map((kind) => {
    const style = NODE_STYLE[kind];
    const attrs = {
      label: kind,
      shape: style.shape,
      style: style.style ?? "filled",
      fillcolor: style.fillcolor,
      fontcolor: style.fontcolor,
    };
    return `    ${dotString(`legend:${kind}`)} [${dotAttrs(attrs)}];`;
  });
  const swatchIds = Object.keys(NODE_STYLE).map((kind) => dotString(`legend:${kind}`));
  const swatchChain = swatchIds.join(" -> ");

  return [
    "  subgraph cluster_legend {",
    '    label="Legend — solid: owns · dark: relationship · dashed: reference"; labeljust="l";',
    '    fontname="Helvetica"; fontsize=12; style="rounded,filled"; color="#cbd2d9"; fillcolor="#ffffff";',
    "    node [fontsize=10];",
    ...swatches,
    // Keep the swatches on a single rank (a horizontal strip): a portrait
    // `ratio` stretch inflates ranksep, which would otherwise fling a vertically
    // chained legend far down the canvas. The invisible, non-constraining chain
    // only fixes their left-to-right order.
    `    { rank=same; ${swatchIds.join("; ")}; }`,
    `    ${swatchChain} [style=invis, constraint=false];`,
    "  }",
  ];
}

function nodeSection(nodes) {
  const { clusters, ungrouped } = partitionByDomain(nodes);
  const lines = ungrouped.map(nodeStatement);

  for (const domainId of [...clusters.keys()].sort()) {
    const { domain, members } = clusters.get(domainId);
    lines.push(
      `  subgraph ${clusterId(domainId)} {`,
      `    label=${dotString(domain?.name ?? domainId)}; labeljust="l";`,
      `    style="rounded,filled"; color="#b8c4d0"; fillcolor="#f5f7fa"; fontname="Helvetica";`,
      ...(domain ? [`  ${nodeStatement(domain)}`] : []),
      ...members.map((member) => `  ${nodeStatement(member)}`),
      "  }",
    );
  }
  return lines;
}

function edge(from, to, attrs) {
  return `  ${dotString(from)} -> ${dotString(to)} [${dotAttrs(attrs)}];`;
}

// A `relationship` edge carries a standalone Relationship node in `edge.source`.
// If we drew it as a direct from->to line the node would have no edges of its
// own and force-directed layouts would fling it to the margins. Routing the edge
// *through* the node (from -> rel -> to) anchors it between its endpoints while
// keeping it visible and faithful to the model.
function routesThroughSourceNode(edge, nodeIds) {
  return (
    edge.kind === "relationship" && nodeIds.has(edge.source) && edge.source !== edge.from && edge.source !== edge.to
  );
}

function edgeStatements(graphEdge, nodeIds) {
  const style = EDGE_STYLE[graphEdge.kind] ?? DEFAULT_EDGE_STYLE;
  const base = { style: style.style, color: style.color, fontcolor: style.color };

  if (routesThroughSourceNode(graphEdge, nodeIds)) {
    return [
      edge(graphEdge.from, graphEdge.source, {
        ...base,
        label: graphEdge.label ?? graphEdge.kind,
        arrowhead: "none",
      }),
      edge(graphEdge.source, graphEdge.to, base),
    ];
  }

  return [edge(graphEdge.from, graphEdge.to, { ...base, label: graphEdge.label ?? graphEdge.kind })];
}

/**
 * Pure translation from the model graph JSON to a deterministic DOT string.
 * `clusters` groups each domain and its owned nodes into a titled box; disable
 * it for engines that draw but do not lay out clusters (they would overlap).
 * @param {{modelId?: string, modelName?: string, nodes?: object[], edges?: object[]}} modelGraph - Parsed model-graph.json.
 * @param {{clusters?: boolean, legend?: boolean}} [options] - Cluster domains into boxes; emit the legend cluster.
 * @returns {string} The DOT source.
 */
export function graphToDot(modelGraph, { clusters = true, legend = clusters } = {}) {
  const nodes = modelGraph.nodes ?? [];
  const edges = modelGraph.edges ?? [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const title = modelGraph.modelName ?? modelGraph.modelId ?? "model";

  return [
    `digraph ${dotString(title)} {`,
    "  rankdir=TB;",
    // overlap/sep are honored by the force-directed and radial engines (ignored
    // by dot) so those variants stop piling nodes on top of each other.
    // ratio="1.3" targets a portrait aspect (height ≈ 1.3× width) so the diagram
    // reads well embedded in a vertically-scrolled document; dot reaches it by
    // spacing ranks, honored here and ignored by the non-ranked engines.
    '  graph [fontname="Helvetica", labelloc="t", fontsize=18, ' +
      `label=${dotString(title)}, overlap="false", sep="+16", splines="true", ratio="1.3"];`,
    '  node [fontname="Helvetica", fontsize=11];',
    '  edge [fontname="Helvetica", fontsize=11];',
    ...(clusters ? nodeSection(nodes) : nodes.map(nodeStatement)),
    ...(legend ? legendStatements() : []),
    ...edges.flatMap((graphEdge) => edgeStatements(graphEdge, nodeIds)),
    "}",
    "",
  ].join("\n");
}

// Load the Graphviz WASM instance once and share it across renders. Loading is
// the only async step; `.dot()` is synchronous, so a single cached instance
// serves every call without re-initializing the WASM module.
let graphvizInstance;
function loadGraphviz() {
  if (!graphvizInstance) {
    graphvizInstance = import("@hpcc-js/wasm/graphviz").then(({ Graphviz }) => Graphviz.load());
  }
  return graphvizInstance;
}

/**
 * Render a DOT string to SVG via the Graphviz WASM engine. `engine` selects
 * the layout algorithm. Isolated so the backend can be swapped without
 * touching the translation above.
 * @param {string} dot - DOT source from graphToDot.
 * @param {string} [engine] - One of LAYOUT_ENGINES (default "dot").
 * @returns {Promise<string>} The rendered SVG.
 */
export async function renderDotToSvg(dot, engine = "dot") {
  if (!LAYOUT_ENGINES.includes(engine)) {
    throw new Error(`unknown layout engine ${engine}; expected one of ${LAYOUT_ENGINES.join(", ")}`);
  }
  const graphviz = await loadGraphviz();
  return graphviz[engine](dot);
}

function readModelGraph(rootPath) {
  const inputPath = resolveContainedOutput(rootPath, jsonInputPath);
  try {
    return JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read ${jsonInputPath}; run \`generate-graph\` first (${cause.message})`, { cause });
  }
}

function writeSvg(rootPath, relativePath, svg) {
  const absoluteOutputPath = resolveContainedOutput(rootPath, relativePath);
  mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, svg);
  return relativePath;
}

/**
 * Build the canonical diagram bytes (dot, clustered, legend). Shared by the
 * writer and the freshness check so both agree byte-for-byte.
 * @param {object} modelGraph - Parsed model-graph.json.
 * @returns {Promise<string>} The canonical SVG bytes.
 */
export async function buildModelGraphSvg(modelGraph) {
  const dot = graphToDot(modelGraph, { clusters: true, legend: true });
  return renderDotToSvg(dot, canonicalEngine);
}

/**
 * Write the canonical generated/graph/model-graph.svg below the product root.
 * @param {string} rootPath - Product root path.
 * @returns {Promise<string>} The root-relative path that was written.
 */
export async function writeModelGraphSvgCanonical(rootPath) {
  const svg = await buildModelGraphSvg(readModelGraph(rootPath));
  return writeSvg(rootPath, svgOutputPath, svg);
}

export async function writeModelGraphSvg(rootPath, engine = "dot") {
  const dot = graphToDot(readModelGraph(rootPath), { clusters: engineSupportsClusters(engine) });
  return writeSvg(rootPath, svgOutputPathFor(engine), await renderDotToSvg(dot, engine));
}

/**
 * Render one SVG per layout engine so the variants can be compared side by
 * side. Clusters are emitted only for the engines that lay them out (dot,
 * fdp). Variants go to .ddduck/graph-layouts/, not generated/.
 * @param {string} rootPath - Product root path.
 * @param {string[]} [engines] - Layout engines to render (default all LAYOUT_ENGINES).
 * @returns {Promise<string[]>} The root-relative variant paths written.
 */
export async function writeModelGraphSvgVariants(rootPath, engines = LAYOUT_ENGINES) {
  const modelGraph = readModelGraph(rootPath);
  const writtenPaths = [];
  for (const engine of engines) {
    const dot = graphToDot(modelGraph, { clusters: engineSupportsClusters(engine) });
    writtenPaths.push(writeSvg(rootPath, svgOutputPathFor(engine), await renderDotToSvg(dot, engine)));
  }
  return writtenPaths;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      parsed.root = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--layout") {
      parsed.layout = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--all-layouts") {
      parsed.allLayouts = true;
      continue;
    }
    if (arg === "--verbose") {
      parsed.verbose = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  const root = resolveProductRoot({ explicitRoot: options.root });
  // Default: just the canonical model-graph.svg. --layout <engine> writes one
  // per-engine variant; --all-layouts writes every variant for comparison.
  const writtenPaths = options.allLayouts
    ? await writeModelGraphSvgVariants(root)
    : options.layout
      ? [await writeModelGraphSvg(root, options.layout)]
      : [await writeModelGraphSvgCanonical(root)];
  if (options.verbose) {
    for (const writtenPath of writtenPaths) {
      console.log(`wrote ${writtenPath}`);
    }
  }
}
