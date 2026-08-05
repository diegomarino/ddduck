import { validateProduct } from "../check-model.mjs";
import { loadQueryProduct, queryAnchors, querySpec } from "./product-query.mjs";

const ownershipKinds = new Set(["Concept", "DomainInterface", "Guarantee"]);

export function generateAgentReadinessReport(rootPath) {
  const check = validateProduct(rootPath, { includeDocumentation: false });
  if (check.errors.length > 0) {
    return { unresolvedReferences: [...check.errors].sort(compareStrings) };
  }

  const product = loadQueryProduct(rootPath);
  const ownedNodes = [...product.nodes.values()].filter(({ kind }) => ownershipKinds.has(kind)).sort(byId);
  const ownersByNode = collectOwners(product);

  const missingEvidence = [...product.nodes.values()]
    .sort(byId)
    .map((node) => {
      const result = queryAnchors(product, node.id).result;
      return {
        id: result.node.id,
        kind: result.node.kind,
        sourcePath: result.node.sourcePath,
        missingRoles: result.missingEvidence,
      };
    })
    .filter(({ missingRoles }) => missingRoles.length > 0);
  const staleGeneratedViews = querySpec(product)
    .result.generatedViews.filter(({ freshness }) => freshness !== "fresh")
    .sort(byPath);
  const orphanedNodes = ownedNodes
    .filter(({ id }) => (ownersByNode.get(id)?.size ?? 0) === 0)
    .map((node) => summarizeNode(node, product));
  const ambiguousOwnership = ownedNodes
    .filter(({ id }) => (ownersByNode.get(id)?.size ?? 0) > 1)
    .map((node) => ({
      ...summarizeNode(node, product),
      ownerDomains: [...ownersByNode.get(node.id)].sort(compareStrings),
    }));

  return {
    missingEvidence,
    unresolvedReferences: [],
    staleGeneratedViews,
    orphanedNodes,
    ambiguousOwnership,
  };
}

function collectOwners(product) {
  const ownersByNode = new Map();
  for (const edge of product.edges.filter(({ kind }) => kind === "owns")) {
    if (product.nodes.get(edge.from)?.kind !== "Domain") continue;
    if (!product.nodes.has(edge.to)) continue;
    if (!ownersByNode.has(edge.to)) ownersByNode.set(edge.to, new Set());
    ownersByNode.get(edge.to).add(edge.from);
  }
  return ownersByNode;
}

function summarizeNode(node, product) {
  return {
    id: node.id,
    kind: node.kind,
    sourcePath: product.sourcePaths.get(node.id),
  };
}

function byId(left, right) {
  return compareStrings(left.id, right.id);
}

function byPath(left, right) {
  return compareStrings(left.path, right.path);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
