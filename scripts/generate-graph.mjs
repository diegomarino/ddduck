#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectProductLayout, loadProductNodes } from "./lib/product-layout.mjs";
import { resolveContainedOutput } from "./lib/product-paths.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

export const jsonOutputPath = path.join("generated", "graph", "model-graph.json");
export const ndjsonOutputPath = path.join("generated", "graph", "model-graph.ndjson");

export function buildModelGraphOutputs(rootPath) {
  const modelGraph = buildModelGraph(rootPath);
  return {
    json: `${JSON.stringify(modelGraph, null, 2)}\n`,
    ndjson: renderNdjson(modelGraph),
  };
}

export function buildModelGraph(rootPath, { history = false } = {}) {
  const layout = detectProductLayout(rootPath);
  const graph = loadGraph(layout, { history });
  return assembleModelGraph(graph, findModelId(graph));
}

export function writeModelGraph(rootPath) {
  const outputs = buildModelGraphOutputs(rootPath);
  const writtenPaths = [];
  for (const [relativePath, output] of Object.entries({
    [jsonOutputPath]: outputs.json,
    [ndjsonOutputPath]: outputs.ndjson,
  })) {
    const absoluteOutputPath = resolveContainedOutput(rootPath, relativePath);
    mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    writeFileSync(absoluteOutputPath, output);
    writtenPaths.push(relativePath);
  }
  return writtenPaths;
}

function loadGraph(layout, { history }) {
  const loaded = loadProductNodes(layout);
  return {
    nodes: new Map(
      [...loaded.nodes].filter(([, node]) => history || node.kind !== "Guarantee" || node.status === "active"),
    ),
  };
}

function assembleModelGraph(graph, modelId) {
  const model = resolveNode(graph, modelId);
  const nodes = [...graph.nodes.values()].map(renderNode).sort(byId);
  const edges = [
    ...buildModelOwnershipEdges(graph, model),
    ...buildDomainOwnershipEdges(graph, model),
    ...buildRelationshipEdges(graph, model),
    ...buildReferenceEdges(graph, model),
  ].sort(byId);

  return {
    schemaVersion: "1",
    formatVersion: "final",
    modelId: model.id,
    modelName: requireField(model, "name"),
    nameStatus: model.nameStatus ?? "stable",
    generatedBy: "scripts/generate-graph.mjs",
    nodes,
    edges,
  };
}

function renderNode(node) {
  return {
    id: requireField(node, "id"),
    kind: requireField(node, "kind"),
    name: node.name ?? null,
    ownershipKind: node.ownershipKind ?? null,
    purpose: nodePurpose(node),
    model: node.model ?? null,
    ownerDomain: node.ownerDomain ?? node.ownedBy ?? null,
  };
}

function nodePurpose(node) {
  if (node.kind === "DomainInterface") {
    return `${requireField(node, "name")} (${requireField(node, "operationKind")})`;
  }
  return node.purpose ?? node.statement ?? node.goal ?? node.description ?? "Unspecified";
}

function buildModelOwnershipEdges(graph, model) {
  return asArray(model.domains).map((domainId) => {
    resolveNode(graph, domainId);
    return {
      id: `edge:owns|${model.id}|${domainId}`,
      from: model.id,
      to: domainId,
      kind: "owns",
      label: "owns",
      source: model.id,
      relationshipType: null,
      mode: null,
    };
  });
}

function buildDomainOwnershipEdges(graph, model) {
  return asArray(model.domains).flatMap((domainId) => {
    const domain = resolveNode(graph, domainId);
    return [...asArray(domain.concepts), ...asArray(domain.interfaces), ...asArray(domain.guarantees)]
      .filter((conceptId) => graph.nodes.has(conceptId))
      .map((conceptId) => {
        resolveNode(graph, conceptId);
        return {
          id: `edge:owns|${domain.id}|${conceptId}`,
          from: domain.id,
          to: conceptId,
          kind: "owns",
          label: "owns",
          source: domain.id,
          relationshipType: null,
          mode: null,
        };
      });
  });
}

function buildRelationshipEdges(graph, model) {
  return asArray(model.relationships).map((relationshipId) => {
    const relationship = resolveNode(graph, relationshipId);
    resolveNode(graph, relationship.from);
    resolveNode(graph, relationship.to);
    return {
      id: relationship.id,
      from: requireField(relationship, "from"),
      to: requireField(relationship, "to"),
      kind: "relationship",
      label: requireField(relationship, "relationshipType"),
      source: relationship.id,
      relationshipType: relationship.relationshipType,
      mode: requireField(relationship, "mode"),
    };
  });
}

function buildReferenceEdges(graph, model) {
  const useCases = asArray(model.useCases).map((useCaseId) => resolveNode(graph, useCaseId));
  const interfaces = [...graph.nodes.values()].filter((node) => node.kind === "DomainInterface");

  return [
    ...useCases.flatMap((useCase) => [
      ...buildReferenceEdgesFor(graph, useCase, useCase.preconditions?.requires, "requires"),
      ...buildReferenceEdgesFor(graph, useCase, useCase.success?.preserves, "preserves"),
      ...buildReferenceEdgesFor(graph, useCase, useCase.success?.establishes, "establishes"),
      ...buildReferenceEdgesFor(graph, useCase, useCase.interfaces, "uses"),
    ]),
    ...interfaces.flatMap((domainInterface) =>
      buildReferenceEdgesFor(graph, domainInterface, domainInterface.guarantees, "guarantees"),
    ),
  ];
}

function buildReferenceEdgesFor(graph, fromNode, referenceIds, kind) {
  return asArray(referenceIds).map((toId) => {
    resolveNode(graph, toId);
    return {
      id: `edge:${kind}|${fromNode.id}|${toId}`,
      from: fromNode.id,
      to: toId,
      kind,
      label: kind,
      source: fromNode.id,
      relationshipType: null,
      mode: null,
    };
  });
}

function renderNdjson(modelGraph) {
  const metadata = {
    type: "metadata",
    schemaVersion: modelGraph.schemaVersion,
    modelId: modelGraph.modelId,
    modelName: modelGraph.modelName,
    nameStatus: modelGraph.nameStatus,
    generatedBy: modelGraph.generatedBy,
    ...(modelGraph.formatVersion ? { formatVersion: modelGraph.formatVersion } : {}),
  };
  const records = [
    metadata,
    ...modelGraph.nodes.map((node) => ({ type: "node", ...node })),
    ...modelGraph.edges.map((edge) => ({ type: "edge", ...edge })),
  ];
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function findModelId(graph) {
  const models = [...graph.nodes.values()].filter((node) => node.kind === "Model");
  if (models.length !== 1) throw new Error(`expected one Model node, found ${models.length}`);
  return models[0].id;
}

function resolveNode(graph, id) {
  const node = graph.nodes.get(id);
  if (!node) {
    throw new Error(`missing model node ${id}`);
  }
  return node;
}

function requireField(node, field) {
  const value = node[field];
  if (value === undefined || value === null || value === "") {
    throw new Error(`missing required field ${field} on ${node.id ?? "model node"}`);
  }
  return value;
}

function byId(left, right) {
  return left.id.localeCompare(right.id);
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
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
  const writtenPaths = writeModelGraph(root);
  if (options.verbose) {
    for (const writtenPath of writtenPaths) {
      console.log(`wrote ${writtenPath}`);
    }
  }
}
