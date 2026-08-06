/**
 * Defines the on-disk layout of a product root and loads its canonical YAML:
 * product.yaml plus the model/{domains,concepts,relationships,use-cases,
 * interfaces,guarantees} directories (nodeDirectoryKinds maps directory to
 * node kind). loadProductNodes yields mutable nodes with file paths and raw
 * sources (for the query digest); loadProductSnapshot yields the deep-frozen
 * snapshot with root-relative canonical paths that mutation transforms plan
 * against. Strict YAML parsing: duplicate keys and non-mapping files fail.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

export const nodeDirectoryKinds = new Map([
  ["domains", "Domain"],
  ["concepts", "Concept"],
  ["relationships", "Relationship"],
  ["use-cases", "UseCase"],
  ["interfaces", "DomainInterface"],
  ["guarantees", "Guarantee"],
]);

const nodeDirectories = [...nodeDirectoryKinds.keys()];

/**
 * Describe the canonical layout below a product root.
 * @param {string} rootPath - Product root path.
 * @returns {{root: string, productPath: string, nodeDirectories: string[], decisionsDirectory: string, generatedDirectory: string}} Resolved layout paths.
 */
export function detectProductLayout(rootPath) {
  const root = path.resolve(rootPath);
  return {
    root,
    productPath: path.join(root, "product.yaml"),
    nodeDirectories,
    decisionsDirectory: path.join(root, "decisions"),
    generatedDirectory: path.join(root, "generated"),
  };
}

/**
 * Load every canonical YAML node under a layout, rejecting duplicate node IDs.
 * @param {{root: string, productPath: string, nodeDirectories: string[]}} layout - Layout from detectProductLayout.
 * @returns {{nodes: Map<string, object>, nodeFiles: Map<string, string>, nodeSources: Map<string, Buffer>}} Nodes, their file paths, and raw source bytes keyed by ID.
 */
export function loadProductNodes(layout) {
  const nodes = new Map();
  const nodeFiles = new Map();
  const nodeSources = new Map();
  const files = productFiles(layout);

  for (const filePath of files) {
    const source = readFileSync(filePath);
    const node = parseYamlMapping(filePath, source.toString("utf8"));
    if (nodes.has(node.id)) {
      throw new Error(`duplicate model node ${node.id}`);
    }
    nodes.set(node.id, node);
    nodeFiles.set(node.id, filePath);
    nodeSources.set(node.id, source);
  }

  return { nodes, nodeFiles, nodeSources };
}

/**
 * Load the deep-frozen snapshot that mutation transforms receive: immutable
 * nodes plus each node's root-relative canonical path.
 * @param {{root: string, productPath: string, nodeDirectories: string[]}} layout - Layout from detectProductLayout.
 * @returns {{nodes: readonly object[], canonicalPaths: Record<string, string>}} Frozen snapshot.
 */
export function loadProductSnapshot(layout) {
  const loaded = loadProductNodes(layout);
  const nodes = Object.freeze([...loaded.nodes.values()].map((node) => deepFreeze(node)));
  const canonicalPaths = Object.freeze(
    Object.fromEntries(
      [...loaded.nodeFiles].map(([id, filePath]) => [
        id,
        path.relative(layout.root, filePath).split(path.sep).join("/"),
      ]),
    ),
  );
  return Object.freeze({ nodes, canonicalPaths });
}

/**
 * Parse one canonical YAML file strictly (unique keys) into a plain mapping.
 * @param {string} filePath - File path, used in diagnostics.
 * @param {string} [source] - YAML source; read from filePath when omitted.
 * @returns {object} The parsed YAML mapping.
 */
export function parseYamlMapping(filePath, source = readFileSync(filePath, "utf8")) {
  const document = parseDocument(source, { keepSourceTokens: true, strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`invalid YAML in ${filePath}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const value = document.toJSON();
  if (!isPlainObject(value)) {
    throw new Error(`model node file must contain a YAML mapping: ${filePath}`);
  }
  return value;
}

function productFiles(layout) {
  return [
    layout.productPath,
    ...layout.nodeDirectories.flatMap((directory) => listYamlFiles(path.join(layout.root, "model", directory))),
  ];
}

function listYamlFiles(directory) {
  try {
    return readdirSync(directory)
      .filter((file) => file.endsWith(".yaml"))
      .sort()
      .map((file) => path.join(directory, file));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
