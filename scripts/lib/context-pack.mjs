/**
 * Implements `ddduck query context`: the context pack that returns the
 * selected active nodes in full, every edge touching them, and summaries of
 * the unselected endpoints, all under a sha256 source digest of the canonical
 * YAML so consumers can detect drift. Also home to the shared sourceDigest
 * helpers, shellQuote for copy-pasteable emitted commands, and the
 * unknown-model-node error used across the query surface.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Quote a value for safe copy-paste into a shell. Emitted commands are copied
 * into shells by humans and agents; roots with spaces or metacharacters must
 * survive that round trip.
 * @param {string} value - The path or argument to quote.
 * @returns {string} The value, single-quoted unless already shell-safe.
 */
export function shellQuote(value) {
  if (/^[A-Za-z0-9_\-./]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Build the error for an ID that names no model node. An unknown ID is a model
 * failure, not a CLI-input failure: point the caller at the generated graph
 * view, the surface that enumerates every node ID, instead of the usage hint.
 * @param {{root: string}} product - The loaded query product.
 * @param {string} id - The unresolved model node ID.
 * @returns {Error} Error with a node-listing nextAction.
 */
export function unknownModelNodeError(product, id) {
  const error = new Error(`Unknown model node ${id}`);
  error.nextAction = `List the model's node IDs in ${path.join(product.root, "generated", "graph", "model-graph.ndjson")} (one node per line), then retry.`;
  return error;
}

/**
 * Resolve a context pack for a set of selected node IDs: full selected nodes,
 * direct edges, and neighbor summaries. Inactive guarantees cannot be selected.
 * @param {{rootModelId: string, nodes: Map<string, object>, edges: object[], sourcePaths: Map<string, string>, sourceDigest: string, lifecycleRedirects: Map<string, object>}} product - The loaded query product.
 * @param {string[]} selectedIds - Distinct model node IDs to select.
 * @returns {object} The context pack document (schemaVersion, query, snapshot, result).
 */
export function resolveContextPack(product, selectedIds) {
  const ids = validateSelectedIds(product, selectedIds);
  const selectedSet = new Set(ids);
  const selected = ids.map((id) => renderNode(product.nodes.get(id), product.sourcePaths));
  const edges = directEdges(product.edges, selectedSet);
  const neighbors = summarizeUnselectedEndpoints(product, selectedSet, edges);

  return {
    schemaVersion: "1",
    query: { operation: "context", ids, history: false },
    rootModelId: product.rootModelId,
    snapshot: { algorithm: "sha256", sourceDigest: product.sourceDigest },
    result: { selected, edges, neighbors },
    diagnostics: [],
  };
}

export function sourceDigest(root, sourcePaths) {
  const sources = new Map(
    [...new Set(sourcePaths.values())].map((relativePath) => [
      relativePath,
      readFileSync(path.resolve(root, relativePath)),
    ]),
  );
  return sourceDigestFromSources(sources);
}

/**
 * Compute the canonical sha256 digest over already-read source files: paths
 * sorted, each path and content NUL-separated.
 * @param {Map<string, Buffer|string>} sources - Root-relative path to file bytes.
 * @returns {string} Hex digest identifying this exact canonical snapshot.
 */
export function sourceDigestFromSources(sources) {
  const hash = createHash("sha256");
  for (const relativePath of [...sources.keys()].sort(byString)) {
    hash.update(relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(sources.get(relativePath));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function validateSelectedIds(product, selectedIds) {
  if (!Array.isArray(selectedIds)) throw new Error("Context pack selection must be an array of IDs");
  if (selectedIds.length === 0) throw new Error("Context pack requires at least one selected ID");
  if (selectedIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("Context pack selection must contain non-empty string IDs");
  }

  const ids = [...selectedIds].sort(byString);
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index] === ids[index - 1]) throw new Error(`Context pack selection contains duplicate ID ${ids[index]}`);
  }

  for (const id of ids) {
    const node = product.nodes.get(id);
    if (node) {
      if (node.kind === "Guarantee" && node.status !== "active") {
        throw new Error(`Cannot select inactive model node ${id} (${node.status})`);
      }
      continue;
    }
    const lifecycleRedirect = product.lifecycleRedirects.get(id);
    if (lifecycleRedirect) {
      throw new Error(`Cannot select inactive model node ${id} (${lifecycleRedirect.status})`);
    }
    throw unknownModelNodeError(product, id);
  }
  return ids;
}

function directEdges(edges, selectedIds) {
  const edgeById = new Map();
  for (const edge of edges) {
    if ((selectedIds.has(edge.from) || selectedIds.has(edge.to)) && !edgeById.has(edge.id)) {
      edgeById.set(edge.id, edge);
    }
  }
  return [...edgeById.values()].sort((left, right) => byString(left.id, right.id));
}

function summarizeUnselectedEndpoints(product, selectedIds, edges) {
  const neighborIds = new Set();
  for (const edge of edges) {
    if (!selectedIds.has(edge.from)) neighborIds.add(edge.from);
    if (!selectedIds.has(edge.to)) neighborIds.add(edge.to);
  }
  return [...neighborIds].sort(byString).map((id) => summarizeNode(product.nodes.get(id), product.sourcePaths));
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

function byString(left, right) {
  return left.localeCompare(right);
}
