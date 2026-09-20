#!/usr/bin/env node

/**
 * Renders the generated Markdown view generated/docs/model-overview.md from a
 * product root's canonical YAML: domains with their concepts, interfaces, and
 * active guarantees, then use cases, interfaces, relationships, and decisions.
 * Inactive (split/retired) guarantees are excluded. buildModelOverview feeds
 * the freshness gate (check-generated-docs.mjs); writeModelOverview is called
 * by init and the staged operation runner. Also runnable standalone via --root.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectProductLayout, loadProductNodes } from "./lib/product-layout.mjs";
import { resolveContainedOutput } from "./lib/product-paths.mjs";
import { resolveProductRoot } from "./lib/product-root-resolver.mjs";

const outputPath = path.join("generated", "docs", "model-overview.md");

/**
 * Build the model overview Markdown for a product root without writing it.
 * @param {string} rootPath - Product root path.
 * @returns {string} The full generated Markdown document.
 */
export function buildModelOverview(rootPath) {
  const layout = detectProductLayout(rootPath);
  const graph = loadGraph(layout);
  return renderModelOverview(assembleModelView(graph, findModelId(graph)));
}

/**
 * Write generated/docs/model-overview.md below the product root.
 * @param {string} rootPath - Product root path.
 * @returns {string} The root-relative path that was written.
 */
export function writeModelOverview(rootPath) {
  const output = buildModelOverview(rootPath);
  const absoluteOutputPath = resolveContainedOutput(rootPath, outputPath);
  mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, output);
  return outputPath;
}

function loadGraph(layout) {
  const loaded = loadProductNodes(layout);
  return {
    nodes: new Map([...loaded.nodes].filter(([, node]) => node.kind !== "Guarantee" || node.status === "active")),
  };
}

/**
 * Assemble the sorted, resolved view of the model that the renderer consumes:
 * domains with their owned nodes resolved, relationships, decisions, use
 * cases, and every DomainInterface in the product.
 * @param {{nodes: Map<string, object>}} graph - Loaded product nodes (active guarantees only).
 * @param {string} modelId - ID of the single Model node.
 * @returns {{model: object, domains: object[], relationships: object[], decisions: string[], useCases: object[], interfaces: object[]}} The renderable view.
 */
function assembleModelView(graph, modelId) {
  const model = resolveNode(graph, modelId);
  const domains = asArray(model.domains)
    .map((domainId) => {
      const domain = resolveNode(graph, domainId);
      return {
        ...domain,
        concepts: resolveExistingNodes(graph, domain.concepts),
        interfaces: resolveExistingNodes(graph, domain.interfaces),
        guarantees: resolveExistingNodes(graph, domain.guarantees),
      };
    })
    .sort(byId);

  const relationships = asArray(model.relationships)
    .filter((nodeId) => graph.nodes.has(nodeId))
    .map((relationshipId) => resolveNode(graph, relationshipId))
    .sort(byId);

  const decisions = asArray(model.decisions).toSorted();
  const useCases = resolveExistingNodes(graph, model.useCases);
  const interfaces = [...graph.nodes.values()].filter((node) => node.kind === "DomainInterface").sort(byId);

  return { model, domains, relationships, decisions, useCases, interfaces };
}

function renderModelOverview(view) {
  const lines = [
    "<!-- GENERATED FILE: do not edit by hand. Regenerate by running ddduck generate --root ../.. from this file's directory. -->",
    "",
    `# ${view.model.name} (\`${view.model.id}\`)`,
    "",
    ...(view.model.nameStatus === undefined ? [] : [`Name status: \`${view.model.nameStatus}\``, ""]),
    view.model.purpose,
    "",
    "## Domains",
    "",
  ];

  for (const domain of view.domains) {
    lines.push(`### ${domain.name} (\`${domain.id}\`)`, "", domain.purpose, "");
    renderNodeList(lines, "Concepts", domain.concepts);
    renderNodeList(lines, "Interfaces", domain.interfaces);
    renderNodeList(lines, "Active guarantees", domain.guarantees);
  }

  lines.push("## Use Cases", "");
  for (const useCase of view.useCases) {
    lines.push(`### ${useCase.name} (\`${useCase.id}\`)`, "", useCase.goal, "");
    renderGuaranteeReferences(lines, "Requires", useCase.preconditions?.requires);
    renderGuaranteeReferences(lines, "Preserves", useCase.success?.preserves);
    renderGuaranteeReferences(lines, "Establishes", useCase.success?.establishes);
    renderNodeReferences(lines, "Interfaces", useCase.interfaces);
    lines.push("");
  }

  lines.push("## Interfaces", "");
  for (const domainInterface of view.interfaces) {
    lines.push(
      `### ${domainInterface.name} (\`${domainInterface.id}\`)`,
      "",
      `Operation kind: \`${domainInterface.operationKind}\``,
      "",
    );
    renderGuaranteeReferences(lines, "Guarantees", domainInterface.guarantees);
    lines.push("");
  }

  lines.push("## Relationships", "");
  for (const relationship of view.relationships) {
    lines.push(
      `- \`${relationship.id}\`: \`${relationship.from}\` -> \`${relationship.to}\` (` +
        `\`${relationship.relationshipType}\`) - ${relationship.description ?? "Unspecified"}`,
    );
  }

  if (view.relationships.length > 0) lines.push("");
  lines.push("## Decisions", "");
  for (const decision of view.decisions) lines.push(`- \`${decision}\``);
  lines.push("");
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderNodeList(lines, title, nodes) {
  lines.push(`#### ${title}`, "");
  if (nodes.length === 0) lines.push("- None.");
  for (const node of nodes) lines.push(`- \`${node.id}\` - ${nodeLabel(node)}`);
  lines.push("");
}

function renderGuaranteeReferences(lines, title, ids) {
  const references = asArray(ids);
  lines.push(`- ${title}: ${references.length ? references.map((id) => `\`${id}\``).join(", ") : "none"}`);
}

function renderNodeReferences(lines, title, ids) {
  const references = asArray(ids);
  lines.push(`- ${title}: ${references.length ? references.map((id) => `\`${id}\``).join(", ") : "none"}`);
}

function resolveNode(graph, id) {
  const node = graph.nodes.get(id);
  if (!node) {
    throw new Error(`missing model node ${id}`);
  }
  return node;
}

function nodeLabel(node) {
  return node.name ?? node.statement ?? node.goal ?? node.description ?? "Unspecified";
}

function resolveExistingNodes(graph, ids) {
  return asArray(ids)
    .filter((id) => graph.nodes.has(id))
    .map((id) => resolveNode(graph, id))
    .sort(byId);
}

function findModelId(graph) {
  const models = [...graph.nodes.values()].filter((node) => node.kind === "Model");
  if (models.length !== 1) throw new Error(`expected one Model node, found ${models.length}`);
  return models[0].id;
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
  const writtenPath = writeModelOverview(root);
  if (options.verbose) {
    console.log(`wrote ${writtenPath}`);
  }
}
