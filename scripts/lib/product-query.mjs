/**
 * The read-only query engine behind `ddduck query`: loadQueryProduct builds a
 * validated in-memory product (nodes, derived graph edges, source digest,
 * lifecycle redirects for inactive guarantees) after refusing busy roots and
 * interrupted-operation leftovers, and the query* functions implement the
 * node, neighbors, impact, anchors, and spec operations. Anchors and spec
 * also report generated-view freshness (the SVG checked via subprocess) and
 * the check/generate verification commands agents should run.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProduct } from "../check-model.mjs";
import { buildModelOverview } from "../generate-docs.mjs";
import { buildModelGraph, buildModelGraphOutputs } from "../generate-graph.mjs";
import { shellQuote, sourceDigestFromSources, unknownModelNodeError } from "./context-pack.mjs";
import { detectProductLayout, loadProductNodes } from "./product-layout.mjs";
import { assertProductNotBusy, findLeftoverOperationState, generatedPaths } from "./product-operation.mjs";

const impactEdgeKinds = new Set(["owns", "requires", "preserves", "establishes", "uses", "guarantees"]);
// Only these kinds accept an `evidence` field in their schemas, so source and
// verification anchors may only be demanded of them.
const evidenceAnchorKinds = new Set(["DomainInterface", "UseCase", "Guarantee"]);
const svgViewPath = "generated/graph/model-graph.svg";
const svgCheckerScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-generated-graph-svg.mjs",
);
function verificationCommandsFor(product) {
  const root = shellQuote(product.root);
  return [`ddduck check --root ${root}`, `ddduck generate --root ${root}`];
}

/**
 * Load the queryable product for a root: refuse busy or interrupted state,
 * validate the source (documentation excluded), and assemble nodes, edges,
 * source paths, the sha256 source digest, decisions, and policies.
 * @param {string} rootPath - Product root path.
 * @param {{history?: boolean}} [options] - With history, inactive guarantees stay in `nodes`; otherwise they become lifecycleRedirects.
 * @returns {{root: string, rootModelId: string, nodes: Map<string, object>, sourcePaths: Map<string, string>, sourceDigest: string, edges: object[], lifecycleRedirects: Map<string, object>, decisions: Map<string, string>, policies: string[]}} The loaded query product.
 */
export function loadQueryProduct(rootPath, { history = false } = {}) {
  const layout = detectProductLayout(rootPath);
  assertProductNotBusy(layout.root);
  // Leftover state from an interrupted mutation means the snapshot may be
  // partially published; refuse to serve a digest over it, exactly like check.
  const leftover = findLeftoverOperationState(layout.root);
  if (leftover) {
    const error = new Error(`An interrupted ddduck operation left ${leftover.entries.join(", ")} in ${layout.root}`);
    error.nextAction = `Run ddduck generate --root ${shellQuote(layout.root)} to reclaim the interrupted operation state, then retry the query.`;
    throw error;
  }
  const check = validateProduct(layout.root, { includeDocumentation: false });
  if (check.errors.length > 0) throw new Error(check.errors.join("\n"));
  const loaded = loadProductNodes(layout);
  const graph = buildModelGraph(layout.root, { history });
  const sourcePaths = new Map(
    [...loaded.nodeFiles].map(([id, filePath]) => [id, productRelativePath(layout.root, filePath)]),
  );
  const sourceFiles = new Map([...loaded.nodeSources].map(([id, source]) => [sourcePaths.get(id), source]));
  const nodes = new Map(
    [...loaded.nodes].filter(([, node]) => history || node.kind !== "Guarantee" || node.status === "active"),
  );
  const lifecycleRedirects = new Map(
    [...loaded.nodes]
      .filter(([, node]) => node.kind === "Guarantee" && node.status !== "active")
      .map(([id, node]) => [
        id,
        {
          id,
          status: node.status,
          lifecycleDecision: node.lifecycleDecision,
          successors: [...(node.successors ?? [])].sort(),
        },
      ]),
  );

  return {
    root: layout.root,
    rootModelId: graph.modelId,
    nodes,
    sourcePaths,
    sourceDigest: sourceDigestFromSources(sourceFiles),
    edges: graph.edges,
    lifecycleRedirects,
    decisions: loadDecisionPaths(layout),
    policies: [...(check.policyChecks ?? [])].sort(),
  };
}

/**
 * Answer `query node`: the full node, or a lifecycleRedirect for an inactive
 * guarantee ID.
 * @param {object} product - Product from loadQueryProduct.
 * @param {string} id - Model node ID.
 * @param {{history?: boolean}} [options] - Echoed into the query envelope.
 * @returns {object} The query document.
 */
export function queryNode(product, id, { history = false } = {}) {
  const node = product.nodes.get(id);
  if (node) {
    return envelope(product, "node", id, history, { node: renderNode(node, product.sourcePaths) });
  }
  const lifecycleRedirect = product.lifecycleRedirects.get(id);
  if (lifecycleRedirect) {
    return envelope(product, "node", id, history, { lifecycleRedirect });
  }
  throw unknownModelNodeError(product, id);
}

/**
 * Answer `query neighbors`: every incoming and outgoing edge of a node with a
 * summary of the peer node on each edge.
 * @param {object} product - Product from loadQueryProduct.
 * @param {string} id - Model node ID.
 * @param {{history?: boolean}} [options] - Echoed into the query envelope.
 * @returns {object} The query document.
 */
export function queryNeighbors(product, id, { history = false } = {}) {
  const node = product.nodes.get(id);
  if (!node) {
    const lifecycleRedirect = product.lifecycleRedirects.get(id);
    if (lifecycleRedirect) return envelope(product, "neighbors", id, history, { lifecycleRedirect });
    throw unknownModelNodeError(product, id);
  }
  const incoming = product.edges
    .filter((edge) => edge.to === id)
    .sort(byId)
    .map((edge) => ({ edge, node: summarizeNode(product.nodes.get(edge.from), product.sourcePaths) }));
  const outgoing = product.edges
    .filter((edge) => edge.from === id)
    .sort(byId)
    .map((edge) => ({ edge, node: summarizeNode(product.nodes.get(edge.to), product.sourcePaths) }));
  return envelope(product, "neighbors", id, history, {
    node: summarizeNode(node, product.sourcePaths),
    incoming,
    outgoing,
  });
}

/**
 * Answer `query impact`: breadth-first walk of everything that depends on the
 * node, following owns/requires/preserves/establishes/uses/guarantees edges
 * backwards, with each hit tagged by depth.
 * @param {object} product - Product from loadQueryProduct.
 * @param {string} id - Model node ID.
 * @param {{history?: boolean}} [options] - Echoed into the query envelope.
 * @returns {object} The query document.
 */
export function queryImpact(product, id, { history = false } = {}) {
  const node = product.nodes.get(id);
  if (!node) {
    const lifecycleRedirect = product.lifecycleRedirects.get(id);
    if (lifecycleRedirect) return envelope(product, "impact", id, history, { lifecycleRedirect });
    throw unknownModelNodeError(product, id);
  }

  const visited = new Set([id]);
  const impacts = [];
  let frontier = [id];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const candidates = frontier
      .flatMap((targetId) => product.edges.filter((edge) => edge.to === targetId && impactEdgeKinds.has(edge.kind)))
      .sort(byId);
    const next = [];
    for (const edge of candidates) {
      if (visited.has(edge.from)) continue;
      visited.add(edge.from);
      impacts.push({ depth, edge, node: summarizeNode(product.nodes.get(edge.from), product.sourcePaths) });
      next.push(edge.from);
    }
    frontier = next.sort();
  }

  return envelope(product, "impact", id, history, {
    source: summarizeNode(node, product.sourcePaths),
    impacts,
  });
}

/**
 * Answer `query anchors`: the node's declared evidence anchors, reachable
 * decisions, executed policies, generated-view freshness, verification
 * commands, and which evidence roles (source/decision/verification) are still
 * missing for kinds that expect them.
 * @param {object} product - Product from loadQueryProduct.
 * @param {string} id - Model node ID.
 * @param {{history?: boolean}} [options] - Echoed into the query envelope.
 * @returns {object} The query document.
 */
export function queryAnchors(product, id, { history = false } = {}) {
  const node = product.nodes.get(id);
  if (!node) {
    const lifecycleRedirect = product.lifecycleRedirects.get(id);
    if (lifecycleRedirect) return envelope(product, "anchors", id, history, { lifecycleRedirect });
    throw unknownModelNodeError(product, id);
  }

  const declaredAnchors = [...(node.evidence ?? [])].sort(byAnchor);
  const decisions = reachableDecisionIds(product, id)
    .sort()
    .map((decisionId) => ({ id: decisionId, path: product.decisions.get(decisionId) }));
  const declaredRoles = new Set(declaredAnchors.map((anchor) => anchor.role));
  const expectsAnchors = evidenceAnchorKinds.has(node.kind);
  const missingEvidence = [
    ...(!expectsAnchors || declaredRoles.has("source") ? [] : ["source"]),
    ...(declaredRoles.has("decision") || decisions.length > 0 ? [] : ["decision"]),
    ...(!expectsAnchors || declaredRoles.has("verification") ? [] : ["verification"]),
  ];

  return envelope(product, "anchors", id, history, {
    node: summarizeNode(node, product.sourcePaths),
    declaredAnchors,
    decisions,
    policies: product.policies,
    generatedViews: generatedViews(product),
    verificationCommands: verificationCommandsFor(product),
    missingEvidence,
  });
}

/**
 * Answer `query spec`: the root Model node, its owned Domains, generated-view
 * freshness, and the verification commands.
 * @param {object} product - Product from loadQueryProduct.
 * @param {{history?: boolean}} [options] - Echoed into the query envelope.
 * @returns {object} The query document.
 */
export function querySpec(product, { history = false } = {}) {
  const root = product.nodes.get(product.rootModelId);
  if (!root) throw new Error(`Unknown model node ${product.rootModelId}`);
  const ownedDomains = product.edges
    .filter((edge) => edge.kind === "owns" && edge.from === root.id && product.nodes.get(edge.to)?.kind === "Domain")
    .sort(byId)
    .map((edge) => summarizeNode(product.nodes.get(edge.to), product.sourcePaths));

  return envelope(product, "spec", root.id, history, {
    root: renderNode(root, product.sourcePaths),
    ownedDomains,
    generatedViews: generatedViews(product),
    verificationCommands: verificationCommandsFor(product),
  });
}

function envelope(product, operation, id, history, result) {
  return {
    schemaVersion: "1",
    query: { operation, id, history },
    rootModelId: product.rootModelId,
    result,
    diagnostics: [],
  };
}

function renderNode(node, sourcePaths) {
  return { ...node, sourcePath: sourcePaths.get(node.id) };
}

function summarizeNode(node, sourcePaths) {
  if (!node) throw new Error("derived graph edge endpoint is missing from the query product");
  return {
    id: node.id,
    kind: node.kind,
    name: node.name ?? null,
    sourcePath: sourcePaths.get(node.id),
  };
}

function loadDecisionPaths(layout) {
  const decisions = new Map();
  try {
    for (const file of readdirSync(layout.decisionsDirectory).sort()) {
      const match = file.match(/^(ADR-[0-9]{3})-.*\.md$/);
      if (match) decisions.set(match[1], productRelativePath(layout.root, path.join(layout.decisionsDirectory, file)));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return decisions;
}

function reachableDecisionIds(product, id) {
  const decisions = new Set();
  const visited = new Set([id]);
  let frontier = [id];
  while (frontier.length > 0) {
    const next = [];
    for (const currentId of frontier) {
      const current = product.nodes.get(currentId);
      for (const decisionId of [
        ...(current.decisions ?? []),
        ...(current.lifecycleDecision ? [current.lifecycleDecision] : []),
      ]) {
        decisions.add(decisionId);
      }
      for (const edge of product.edges.filter((edge) => edge.kind === "owns" && edge.to === currentId).sort(byId)) {
        if (visited.has(edge.from)) continue;
        visited.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next.sort();
  }
  return [...decisions];
}

function generatedViews(product) {
  const outputs = buildModelGraphOutputs(product.root);
  const expectedByPath = new Map([
    ["generated/docs/model-overview.md", buildModelOverview(product.root)],
    ["generated/graph/model-graph.json", outputs.json],
    ["generated/graph/model-graph.ndjson", outputs.ndjson],
  ]);
  return generatedPaths.map((relativePath) => ({
    path: relativePath,
    freshness:
      relativePath === svgViewPath
        ? svgViewFreshness(product.root)
        : readGeneratedView(product.root, relativePath) === expectedByPath.get(relativePath)
          ? "fresh"
          : "stale",
  }));
}

// The canonical SVG is rendered by the async Graphviz WASM engine, so its
// freshness is checked in a child process to keep queries synchronous
// (mirrors the check and generate subprocesses).
function svgViewFreshness(root) {
  const result = spawnSync(process.execPath, [svgCheckerScript, "--root", root], { encoding: "utf8" });
  if (result.error) {
    throw new Error(`Failed to run the model graph SVG check for ${root}: ${result.error.message}`);
  }
  if (result.status === 0) return "fresh";
  if (/missing or stale/.test(result.stderr ?? "")) return "stale";
  throw new Error(`Failed to run the model graph SVG check for ${root}: ${(result.stderr ?? "").trim()}`);
}

function readGeneratedView(root, relativePath) {
  try {
    return readFileSync(path.join(root, relativePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function productRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function byId(left, right) {
  return left.id.localeCompare(right.id);
}

function byAnchor(left, right) {
  return (
    left.role.localeCompare(right.role) ||
    left.path.localeCompare(right.path) ||
    left.anchor.localeCompare(right.anchor)
  );
}
