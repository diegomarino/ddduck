/**
 * Resolves which product root a rootless command addresses, in priority
 * order: explicit --root, the enclosing product root of the cwd, the
 * productRoot pinned in .ddduck/config.json, then repository-wide discovery
 * (a unique primary candidate, or a unique example candidate when run inside
 * it; test/ and fixtures/ candidates are ignored, ambiguity is an error).
 * Also owns resolveInitDestination, the init staging-name prefix, and the
 * nonProductSourceEntries list that mutation staging excludes.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { validateProduct } from "../check-model.mjs";
import { findRepositoryRoot, loadDdduckConfig } from "./ddduck-config.mjs";
import { shouldIgnoreScanEntry } from "./scan-ignore.mjs";

export { findRepositoryRoot, loadDdduckConfig } from "./ddduck-config.mjs";

export const initStagingPrefix = ".ddduck-init-stage-";
export const nonProductSourceEntries = Object.freeze([
  ".git",
  ".ddduck",
  "node_modules",
  "generated",
  ".superpowers",
  ".worktrees",
]);

/**
 * Resolve the product root for a command: explicit root, enclosing root,
 * configured root, or unique discovery — otherwise throw with candidates.
 * @param {{cwd?: string, explicitRoot?: string}} [options] - Working directory and the --root override.
 * @returns {string} The real (symlink-resolved) product root path.
 */
export function resolveProductRoot({ cwd = process.cwd(), explicitRoot } = {}) {
  if (explicitRoot) return validateSelectedRoot(path.resolve(cwd, explicitRoot), "Explicit product root");

  const repositoryRoot = findRepositoryRoot(cwd);
  const enclosingRoot = findEnclosingProductRoot(cwd, repositoryRoot);
  if (enclosingRoot) return enclosingRoot;

  const config = loadDdduckConfig(repositoryRoot);
  if (config) {
    const configuredRoot = path.resolve(repositoryRoot, config.productRoot);
    return validateSelectedRoot(configuredRoot, "Configured product root", config.productRoot, repositoryRoot);
  }

  const candidates = discoverProductRoots(repositoryRoot);
  const primary = candidates.filter((candidate) => candidate.classification === "primary");
  if (primary.length === 1) return primary[0].root;
  if (primary.length > 1) throw ambiguousRoots(primary);

  const relevantExamples = candidates.filter(
    (candidate) => candidate.classification === "example" && isSameOrDescendant(cwd, candidate.root),
  );
  if (relevantExamples.length === 1) return relevantExamples[0].root;

  if (candidates.length > 1) throw ambiguousRoots(candidates);
  if (candidates.length === 1) throw irrelevantCandidate(candidates[0]);
  throw new Error("No ddduck product root found; pass --root <product-root>");
}

/**
 * Resolve where `ddduck init` publishes: the explicit destination, the
 * configured productRoot, or `ddd` under the current directory.
 * @param {{cwd?: string, explicitDestination?: string}} [options] - Working directory and the optional positional destination.
 * @returns {string} Absolute destination path.
 */
export function resolveInitDestination({ cwd = process.cwd(), explicitDestination } = {}) {
  if (explicitDestination) return path.resolve(cwd, explicitDestination);
  const repositoryRoot = findRepositoryRoot(cwd);
  const config = loadDdduckConfig(repositoryRoot);
  if (config) return path.resolve(repositoryRoot, config.productRoot);
  return path.resolve(cwd, "ddd");
}

function findEnclosingProductRoot(cwd, repositoryRoot) {
  let current = path.resolve(cwd);
  while (isSameOrDescendant(current, repositoryRoot)) {
    if (!path.basename(current).startsWith(initStagingPrefix) && hasProductRootShape(current)) {
      return realpathSync(current);
    }
    if (current === repositoryRoot) break;
    current = path.dirname(current);
  }
  return null;
}

function discoverProductRoots(repositoryRoot) {
  const roots = [];
  visitDirectory(
    repositoryRoot,
    (directory) => {
      if (hasProductRootShape(directory)) {
        const classification = classifyCandidate(repositoryRoot, directory);
        if (classification !== "ignored") {
          roots.push({ root: realpathSync(directory), classification, valid: passesProductValidation(directory) });
        }
        return false;
      }
      return true;
    },
    true,
  );
  return roots.sort((left, right) => left.root.localeCompare(right.root));
}

// The scan-ignore predicate skips dot-entries, node_modules, generated output,
// and staging debris. It applies only to child entries as the scan descends, not
// to the explicitly chosen traversal root: a repository checked out under a
// dot-prefixed directory (for example `/tmp/.scratch`) must still be scanned.
function visitDirectory(directory, visitor, isRoot = false) {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
  const baseName = path.basename(directory);
  if (
    !isRoot &&
    (shouldIgnoreScanEntry(baseName) || baseName === "generated" || baseName.startsWith(initStagingPrefix))
  )
    return;
  if (visitor(directory) === false) return;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) visitDirectory(path.join(directory, entry.name), visitor);
  }
}

function classifyCandidate(repositoryRoot, root) {
  const relativePath = path.relative(repositoryRoot, root).split(path.sep).join("/");
  if (relativePath === "") return "primary";
  if (relativePath.startsWith("test/") || relativePath.includes("/fixtures/")) return "ignored";
  if (relativePath.startsWith("examples/")) return "example";
  return "primary";
}

function validateSelectedRoot(root, label, displayPath = root, containingRoot) {
  if (hasProductRootShape(root)) {
    const realRoot = realpathSync(root);
    if (containingRoot) {
      const realContainingRoot = realpathSync(containingRoot);
      if (!isSameOrDescendant(realRoot, realContainingRoot)) {
        throw new Error(`${label} is invalid: ${displayPath}; productRoot must stay inside the repository`);
      }
    }
    return realRoot;
  }
  throw new Error(`${label} is invalid: ${displayPath}; pass --root <product-root>`);
}

function passesProductValidation(root) {
  try {
    return validateProduct(root, { includeDocumentation: false }).errors.length === 0;
  } catch {
    return false;
  }
}

/**
 * Test whether a directory has the shape of a product root: a product.yaml
 * that is a valid schemaVersion-1 Model with a model:<slug> ID, plus a model/
 * directory. Shape only; full validation happens elsewhere.
 * @param {string} root - Candidate directory.
 * @returns {boolean} True when the directory looks like a product root.
 */
function hasProductRootShape(root) {
  try {
    const productPath = path.join(root, "product.yaml");
    if (!existsSync(productPath) || !lstatSync(productPath).isFile()) return false;
    if (!existsSync(path.join(root, "model")) || !lstatSync(path.join(root, "model")).isDirectory()) return false;
    const document = parseDocument(readFileSync(productPath, "utf8"), {
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) return false;
    const product = document.toJSON();
    if (!product || typeof product !== "object" || Array.isArray(product)) return false;
    return product.schemaVersion === "1" && product.kind === "Model" && /^model:[a-z0-9][a-z0-9-]*$/.test(product.id);
  } catch {
    return false;
  }
}

// A repository whose only candidate is an example resolves implicitly only
// from inside it. From anywhere else, name the candidate that was found and
// rejected as irrelevant (mirroring the ambiguity message) instead of claiming
// no product exists.
function irrelevantCandidate(candidate) {
  return new Error(
    `No ddduck product root selected; found ${candidate.classification} candidate: ${candidate.root}${candidate.valid ? "" : " (fails validation)"}. Pass --root ${candidate.root} or run inside it.`,
  );
}

function ambiguousRoots(candidates) {
  const roots = candidates
    .map((candidate) => `${candidate.classification}: ${candidate.root}${candidate.valid ? "" : " (fails validation)"}`)
    .join("; ");
  return new Error(`Multiple ddduck product roots found; pass --root <product-root>. Candidates: ${roots}`);
}

function isSameOrDescendant(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
