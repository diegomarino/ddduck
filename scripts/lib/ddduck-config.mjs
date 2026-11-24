/**
 * Repository-level configuration for ddduck: locates the repository root (the
 * nearest .git ancestor, else the starting directory), discovers the single
 * repository config file among the supported locations, and reads/validates it.
 * The config's productRoot pins the repository's default product root and its
 * optional ignore list extends the repo scanners' skipped directory names.
 * Consumed by the product root resolver, init, and the documentation reference
 * check. Location order and formats are decided by ADR-009.
 */

import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { parseDocument } from "yaml";

const configExtensions = ["json", "jsonc", "yaml", "yml"];

/**
 * Supported repository config locations, relative to the repository root, in
 * documented order. At most one may exist; the order names candidates in
 * diagnostics and documentation, it never silently picks a winner.
 */
export const configCandidates = Object.freeze([
  ...configExtensions.map((extension) => `.config/ddduck.${extension}`),
  ...configExtensions.map((extension) => `ddduck.config.${extension}`),
  ...configExtensions.map((extension) => `.ddduck/config.${extension}`),
]);

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
 * Find the repository config file. Several existing candidates are a conflict
 * and throw with every candidate listed in documented order.
 * @param {string} repositoryRoot - Repository root to search.
 * @returns {string|null} Repository-relative path (forward slashes) of the config, or null.
 */
export function findDdduckConfigFile(repositoryRoot) {
  const present = configCandidates.filter((candidate) => existsSync(path.join(repositoryRoot, candidate)));
  if (present.length > 1) {
    const error = new Error(
      `Multiple ddduck configuration files found in ${repositoryRoot}: ${present.join(", ")}; keep exactly one`,
    );
    error.nextAction = `Merge the settings into one of ${present.join(", ")}, delete the others, and retry.`;
    throw error;
  }
  return present[0] ?? null;
}

/**
 * Load and validate the repository config; a malformed or conflicting config
 * throws, an absent one returns null.
 * @param {string} repositoryRoot - Repository root to read the config from.
 * @returns {{schemaVersion: "1", productRoot: string, ignore?: string[]}|null} The validated config or null.
 */
export function loadDdduckConfig(repositoryRoot) {
  const relativePath = findDdduckConfigFile(repositoryRoot);
  if (!relativePath) return null;
  const configPath = path.join(repositoryRoot, relativePath);
  if (!statSync(configPath).isFile()) throw new Error(`${relativePath}: must be a regular file`);
  return validateConfig(parseConfigSource(readFileSync(configPath, "utf8"), relativePath), relativePath);
}

function parseConfigSource(source, relativePath) {
  const extension = path.extname(relativePath).slice(1);
  if (extension === "json") {
    try {
      return JSON.parse(source);
    } catch (error) {
      throw new Error(`${relativePath}: invalid JSON: ${error.message}`);
    }
  }
  if (extension === "jsonc") {
    const errors = [];
    // Trailing commas are accepted because Prettier writes them in .jsonc files;
    // any other parse error fails rather than yielding a partial config.
    const value = parseJsonc(source, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      const details = errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`);
      throw new Error(`${relativePath}: invalid JSONC: ${details.join("; ")}`);
    }
    return value;
  }
  const document = parseDocument(source, { strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${relativePath}: invalid YAML: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  return document.toJSON();
}

function validateConfig(parsed, relativePath) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${relativePath}: configuration must be an object`);
  }
  if (parsed.schemaVersion !== "1") throw new Error(`${relativePath}: schemaVersion must be "1"`);
  if (typeof parsed.productRoot !== "string" || parsed.productRoot.length === 0) {
    throw new Error(`${relativePath}: productRoot must be a non-empty string`);
  }
  if (path.isAbsolute(parsed.productRoot) || parsed.productRoot.split(/[\\/]+/).includes("..")) {
    throw new Error(`${relativePath}: productRoot must stay inside the repository`);
  }
  const config = { schemaVersion: "1", productRoot: parsed.productRoot };
  if (parsed.ignore !== undefined) {
    if (!Array.isArray(parsed.ignore)) {
      throw new Error(`${relativePath}: ignore must be an array of directory names`);
    }
    for (const entry of parsed.ignore) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new Error(`${relativePath}: ignore entries must be non-empty strings`);
      }
      if (entry.includes("/") || entry.includes("\\") || entry === "." || entry === "..") {
        throw new Error(`${relativePath}: ignore entries must be plain directory names`);
      }
    }
    config.ignore = parsed.ignore;
  }
  return config;
}

/**
 * Choose where `init` writes a new config: `.config/ddduck.jsonc` when the
 * repository already has a `.config/` directory, otherwise `ddduck.config.jsonc`.
 * It never creates `.ddduck/` just for configuration.
 * @param {string} repositoryRoot - Repository root that will hold the config.
 * @returns {string} Repository-relative path (forward slashes) for the new config.
 */
export function initConfigRelativePath(repositoryRoot) {
  const configDirectory = path.join(repositoryRoot, ".config");
  return existsSync(configDirectory) && statSync(configDirectory).isDirectory()
    ? ".config/ddduck.jsonc"
    : "ddduck.config.jsonc";
}

/**
 * Render the commented JSONC template `init` writes, documenting every option.
 * @param {{productRoot: string, ignore?: string[]}} values - Values to pre-fill.
 * @returns {string} JSONC source, newline-terminated.
 */
export function renderInitConfig({ productRoot, ignore = defaultConfigIgnore }) {
  return [
    "// ddduck repository configuration. Keep exactly one ddduck config file per repository.",
    "// Reference: https://github.com/diegomarino/ddduck/blob/main/docs/cli.md#product-root-resolution",
    "{",
    '  // Configuration format version. Must be "1".',
    '  "schemaVersion": "1",',
    "",
    "  // Default product root, relative to the repository root. Used when --root is omitted",
    "  // and the current directory is not inside a product root. --root always overrides it.",
    `  "productRoot": ${JSON.stringify(productRoot)},`,
    "",
    "  // Extra directory names (basenames only, no globs) that every ddduck scanner skips,",
    "  // in addition to dot-directories and node_modules. Use [] to skip nothing extra;",
    "  // remove the key to use the defaults shown here.",
    // The trailing comma matches Prettier's default output for .jsonc files.
    `  "ignore": [${ignore.map((entry) => JSON.stringify(entry)).join(", ")}],`,
    "}",
    "",
  ].join("\n");
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
