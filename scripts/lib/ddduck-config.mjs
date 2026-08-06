/**
 * Repository-level configuration for ddduck: locates the repository root (the
 * nearest .git ancestor, else the starting directory) and reads/validates
 * .ddduck/config.json, whose productRoot pins the repository's default product
 * root and whose optional ignore list extends the repo scanners' skipped
 * directory names. Consumed by the product root resolver, init, and the
 * documentation reference check.
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

const configRelativePath = path.join(".ddduck", "config.json");

export const defaultConfigIgnore = Object.freeze(["vendor", "target", "build", "dist", "__pycache__"]);

/**
 * Find the nearest ancestor directory containing .git; without one, fall back
 * to the starting directory itself (never a file path).
 * @param {string} [startPath] - Directory or file to start from (default cwd).
 * @returns {string} Absolute repository root, always a directory.
 */
export function findRepositoryRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  if (existsSync(current) && !lstatSync(current).isDirectory()) current = path.dirname(current);
  // The adjusted starting directory is the fallback when no .git ancestor exists,
  // so a file startPath never leaks back out as if it were a directory.
  const fallback = current;
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

/**
 * Load and validate .ddduck/config.json from a repository root; a malformed
 * config throws, an absent one returns null.
 * @param {string} repositoryRoot - Repository root to read the config from.
 * @returns {{schemaVersion: "1", productRoot: string, ignore?: string[]}|null} The validated config or null.
 */
export function loadDdduckConfig(repositoryRoot) {
  const configPath = path.join(repositoryRoot, configRelativePath);
  if (!existsSync(configPath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`${configRelativePath}: invalid JSON: ${error.message}`);
  }
  if (parsed?.schemaVersion !== "1") throw new Error(`${configRelativePath}: schemaVersion must be "1"`);
  if (typeof parsed.productRoot !== "string" || parsed.productRoot.length === 0) {
    throw new Error(`${configRelativePath}: productRoot must be a non-empty string`);
  }
  if (path.isAbsolute(parsed.productRoot) || parsed.productRoot.split(/[\\/]+/).includes("..")) {
    throw new Error(`${configRelativePath}: productRoot must stay inside the repository`);
  }
  const config = { schemaVersion: "1", productRoot: parsed.productRoot };
  if (parsed.ignore !== undefined) {
    if (!Array.isArray(parsed.ignore)) {
      throw new Error(`${configRelativePath}: ignore must be an array of directory names`);
    }
    for (const entry of parsed.ignore) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new Error(`${configRelativePath}: ignore entries must be non-empty strings`);
      }
      if (entry.includes("/") || entry.includes("\\") || entry === "." || entry === "..") {
        throw new Error(`${configRelativePath}: ignore entries must be plain directory names`);
      }
    }
    config.ignore = parsed.ignore;
  }
  return config;
}

/**
 * Resolve the ignored directory names for repo scans: the config's ignore list
 * when present, else the defaults (vendor, target, build, dist, __pycache__).
 * @param {string} repositoryRoot - Repository root whose config applies.
 * @returns {string[]} Directory names to skip.
 */
export function resolveConfiguredIgnores(repositoryRoot) {
  const config = loadDdduckConfig(repositoryRoot);
  if (!config || config.ignore === undefined) return [...defaultConfigIgnore];
  return config.ignore;
}
