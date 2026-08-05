import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  buildModelGraphSvg,
  engineSupportsClusters,
  graphToDot,
  LAYOUT_ENGINES,
  renderDotToSvg,
  svgOutputPath,
  svgOutputPathFor,
} from "../scripts/generate-graph-svg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const remindersGraph = JSON.parse(
  readFileSync(path.join(here, "..", "examples", "reminders", "ddd", "generated", "graph", "model-graph.json"), "utf8"),
);

test("graphToDot emits a directed graph", () => {
  const dot = graphToDot(remindersGraph);
  assert.match(dot, /^digraph /);
  assert.ok(dot.trimEnd().endsWith("}"));
});

test("graphToDot renders every node as a quoted, styled statement", () => {
  const dot = graphToDot(remindersGraph);
  for (const node of remindersGraph.nodes) {
    assert.ok(dot.includes(`"${node.id}" [`), `missing node statement for ${node.id}`);
  }
  // Kind-specific shape wiring is present.
  assert.match(dot, /shape="doublecircle"/); // Model
  assert.match(dot, /shape="hexagon"/); // Guarantee
});

test("graphToDot renders every edge with its label", () => {
  const dot = graphToDot(remindersGraph);
  const establishes = remindersGraph.edges.find((edge) => edge.kind === "establishes");
  assert.ok(establishes, "fixture should contain an establishes edge");
  assert.ok(dot.includes(`"${establishes.from}" -> "${establishes.to}"`), "missing establishes edge");
  assert.match(dot, /label="establishes"/);
});

test("graphToDot wraps each domain and its owned nodes in a cluster", () => {
  const graph = {
    nodes: [
      { id: "model:m", kind: "Model", name: "M" },
      { id: "domain:members", kind: "Domain", name: "Members" },
      { id: "concept:member", kind: "Concept", name: "Member", ownerDomain: "domain:members" },
    ],
    edges: [],
  };
  const dot = graphToDot(graph);
  assert.match(dot, /subgraph cluster_domain_members \{/);
  assert.match(dot, /label="Members";/);
  // The owned concept lives inside the cluster; the Model stays top level.
  assert.ok(dot.includes('"concept:member" ['), "concept should still be rendered");
  const clusterStart = dot.indexOf("subgraph cluster_domain_members");
  assert.ok(dot.indexOf('"concept:member" [') > clusterStart, "concept should be emitted after the cluster opens");
  assert.ok(dot.indexOf('"model:m" [') < clusterStart, "model should be emitted before any cluster (top level)");
});

test("graphToDot omits clusters when clusters:false (flat graph)", () => {
  const graph = {
    nodes: [{ id: "domain:members", kind: "Domain", name: "Members" }],
    edges: [],
  };
  assert.match(graphToDot(graph, { clusters: true }), /subgraph cluster_/);
  const flat = graphToDot(graph, { clusters: false });
  assert.doesNotMatch(flat, /subgraph cluster_/);
  assert.ok(flat.includes('"domain:members" ['), "the domain node is still rendered flat");
});

test("graphToDot includes a legend by default when clustered, omits it when legend:false", () => {
  const graph = { nodes: [{ id: "domain:m", kind: "Domain", name: "M" }], edges: [] };
  const dot = graphToDot(graph);
  assert.match(dot, /subgraph cluster_legend \{/);
  assert.ok(dot.includes('"legend:Guarantee" ['), "legend should carry a swatch per node kind");
  assert.doesNotMatch(graphToDot(graph, { legend: false }), /cluster_legend/);
});

test("the canonical SVG path is model-graph.svg and it renders with a legend", async () => {
  assert.equal(svgOutputPath, path.join("generated", "graph", "model-graph.svg"));
  const svg = await buildModelGraphSvg(remindersGraph);
  assert.match(svg, /<svg/);
  assert.ok(svg.includes("Legend"), "canonical diagram should embed the legend");
});

test("only dot and fdp are cluster-aware engines", () => {
  assert.equal(engineSupportsClusters("dot"), true);
  assert.equal(engineSupportsClusters("fdp"), true);
  for (const engine of ["neato", "sfdp", "twopi", "circo"]) {
    assert.equal(engineSupportsClusters(engine), false, `${engine} must not emit clusters`);
  }
});

test("graphToDot routes relationship edges through their Relationship node", () => {
  const graph = {
    nodes: [
      { id: "concept:a", kind: "Concept", name: "A" },
      { id: "concept:b", kind: "Concept", name: "B" },
      { id: "rel:a-b", kind: "Relationship", name: "A relates to B" },
    ],
    edges: [
      {
        id: "rel:a-b",
        from: "concept:a",
        to: "concept:b",
        kind: "relationship",
        label: "relates-to",
        source: "rel:a-b",
      },
    ],
  };
  const dot = graphToDot(graph);
  // Routed as from -> rel and rel -> to, not a direct concept -> concept line.
  assert.ok(dot.includes('"concept:a" -> "rel:a-b"'), "missing from->rel segment");
  assert.ok(dot.includes('"rel:a-b" -> "concept:b"'), "missing rel->to segment");
  assert.ok(!dot.includes('"concept:a" -> "concept:b"'), "should not draw a direct edge");
});

test("graphToDot escapes quotes in labels", () => {
  const graph = {
    nodes: [{ id: "concept:x", kind: "Concept", name: 'A "quoted" name', purpose: "p" }],
    edges: [],
  };
  const dot = graphToDot(graph);
  assert.ok(dot.includes('\\"quoted\\"'), "quotes in labels must be escaped");
});

test("renderDotToSvg produces an SVG document", async () => {
  const svg = await renderDotToSvg(graphToDot(remindersGraph));
  assert.match(svg, /<svg/);
  assert.ok(svg.includes("Member"), "node names should appear in the SVG");
});

test("svgOutputPathFor names the file after the layout engine", () => {
  assert.equal(svgOutputPathFor("twopi"), path.join("generated", "graph", "model-graph.twopi.svg"));
});

test("renderDotToSvg rejects an unknown layout engine", async () => {
  await assert.rejects(() => renderDotToSvg("digraph {}", "nope"), /unknown layout engine/);
});

test("every declared layout engine renders an SVG", async () => {
  const dot = graphToDot(remindersGraph);
  for (const engine of LAYOUT_ENGINES) {
    const svg = await renderDotToSvg(dot, engine);
    assert.match(svg, /<svg/, `${engine} should produce an SVG`);
  }
});
