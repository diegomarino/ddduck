import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

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
    throw new Error(`Unknown model node ${id}`);
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
