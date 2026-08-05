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
  throw new Error("No ddduck product root found; pass --root <product-root>");
}

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
