import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const nodeDirectories = ["domains", "concepts", "relationships", "use-cases", "interfaces", "guarantees"];

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
