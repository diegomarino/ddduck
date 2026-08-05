import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { checkGeneratedDocs } from "../check-generated-docs.mjs";
import { checkGeneratedGraph } from "../check-generated-graph.mjs";
import { validateProduct } from "../check-model.mjs";
import { writeModelOverview } from "../generate-docs.mjs";
import { writeModelGraph } from "../generate-graph.mjs";
import { detectProductLayout, loadProductSnapshot } from "./product-layout.mjs";
import { resolveContainedOutput } from "./product-paths.mjs";
import { nonProductSourceEntries } from "./product-root-resolver.mjs";

const lockRelativePath = ".ddduck-operation.lock";
const reclaimRelativePath = ".ddduck-operation.reclaim";
const stagingPrefix = ".ddduck-operation-stage-";
const generatedPaths = Object.freeze([
  "generated/docs/model-overview.md",
  "generated/graph/model-graph.json",
  "generated/graph/model-graph.ndjson",
]);
// The canonical SVG is published atomically alongside the reported outputs, but
// kept off `generatedPaths` so it stays out of the CLI/query freshness contract.
// It is rendered by the Graphviz WASM engine, which is async, so we produce it in
// a child process to keep this runner synchronous (mirrors the check subprocess).
const auxiliaryGeneratedPaths = Object.freeze(["generated/graph/model-graph.svg"]);
const svgGeneratorScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "generate-graph-svg.mjs");
const excludedSourceEntries = new Set([...nonProductSourceEntries, lockRelativePath, reclaimRelativePath]);

export class ProductBusyError extends Error {
  constructor(root, lockPath, ownerPid) {
    const holder = ownerPid ? ` (held by running process ${ownerPid})` : "";
    super(`Product root is busy: ${root}; ${lockPath} exists${holder}`);
    this.name = "ProductBusyError";
    this.nextAction = ownerPid
      ? `Wait for process ${ownerPid} to finish and retry, or delete ${lockPath} and retry if that process is not a ddduck operation.`
      : `If no other ddduck operation is running on this product, delete ${lockPath} and retry.`;
  }
}

export function runProductOperation({ root, transform }) {
  if (typeof transform !== "function") throw new TypeError("product operation requires a transform function");
  const normalizedRoot = realpathSync(path.resolve(root));
  const lockPath = resolveContainedOutput(normalizedRoot, lockRelativePath);
  const publishGeneratedTargets = generatedPaths.map((relativePath) =>
    resolveContainedOutput(normalizedRoot, relativePath),
  );
  const publishAuxiliaryTargets = auxiliaryGeneratedPaths.map((relativePath) =>
    resolveContainedOutput(normalizedRoot, relativePath),
  );
  let lockAcquired = false;
  let stagingRoot;

  try {
    acquireLock(lockPath, normalizedRoot);
    lockAcquired = true;
    sweepDeadReclaimClaim(normalizedRoot);
    sweepOrphanedStaging(normalizedRoot);
    stagingRoot = mkdtempSync(resolveContainedOutput(normalizedRoot, stagingPrefix));
    copyProductSource(normalizedRoot, stagingRoot);

    const snapshot = loadProductSnapshot(detectProductLayout(stagingRoot));
    const plan = validatePlan(transform(snapshot));
    const canonicalPaths = applyReplacements(stagingRoot, plan.replacements);
    validateStagedProduct(stagingRoot);
    writeModelOverview(stagingRoot);
    writeModelGraph(stagingRoot);
    renderModelGraphSvg(stagingRoot);
    checkGeneratedDocs(stagingRoot);
    checkGeneratedGraph(stagingRoot);

    const publishCanonicalTargets = canonicalPaths.map((relativePath) =>
      resolveContainedOutput(normalizedRoot, relativePath),
    );
    preflightPublicationTargets(normalizedRoot, [
      ...canonicalPaths.map((relativePath, index) => ({
        relativePath,
        targetPath: publishCanonicalTargets[index],
      })),
      ...generatedPaths.map((relativePath, index) => ({
        relativePath,
        targetPath: publishGeneratedTargets[index],
      })),
      ...auxiliaryGeneratedPaths.map((relativePath, index) => ({
        relativePath,
        targetPath: publishAuxiliaryTargets[index],
      })),
    ]);
    for (let index = 0; index < canonicalPaths.length; index += 1) {
      copyPublishedFile(stagingRoot, canonicalPaths[index], publishCanonicalTargets[index]);
    }
    for (let index = 0; index < generatedPaths.length; index += 1) {
      copyPublishedFile(stagingRoot, generatedPaths[index], publishGeneratedTargets[index]);
    }
    for (let index = 0; index < auxiliaryGeneratedPaths.length; index += 1) {
      copyPublishedFile(stagingRoot, auxiliaryGeneratedPaths[index], publishAuxiliaryTargets[index]);
    }

    return {
      operation: plan.operation,
      root: normalizedRoot,
      affectedIds: [...plan.affectedIds],
      canonicalPaths,
      generatedPaths: [...generatedPaths],
    };
  } finally {
    try {
      if (stagingRoot) rmSync(stagingRoot, { recursive: true, force: true });
    } finally {
      if (lockAcquired) unlinkSync(lockPath);
    }
  }
}

// Render the canonical SVG into staging via a child process (the Graphviz WASM
// engine is async; this keeps runProductOperation synchronous).
function renderModelGraphSvg(stagingRoot) {
  const result = spawnSync(process.execPath, [svgGeneratorScript, "--root", stagingRoot], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Failed to render the model graph SVG: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to render the model graph SVG: ${result.stderr.trim()}`);
  }
}

function preflightPublicationTargets(root, targets) {
  for (const { relativePath, targetPath } of targets) {
    const targetMetadata = lstatIfPresent(targetPath);
    if (targetMetadata?.isSymbolicLink()) {
      throw new Error(`Refusing to publish ${relativePath}: destination must not be a symbolic link`);
    }
    if (targetMetadata && !targetMetadata.isFile()) {
      throw new Error(`Refusing to publish ${relativePath}: destination must be a regular file`);
    }

    let parent = path.dirname(targetPath);
    while (parent !== root) {
      const parentMetadata = lstatIfPresent(parent);
      if (parentMetadata?.isSymbolicLink()) {
        throw new Error(`Refusing to publish ${relativePath}: destination parent must not be a symbolic link`);
      }
      if (parentMetadata && !parentMetadata.isDirectory()) {
        throw new Error(`Refusing to publish ${relativePath}: destination parent must be a directory`);
      }
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
}

function lstatIfPresent(targetPath) {
  try {
    return lstatSync(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function acquireLock(lockPath, root) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      createLockFile(lockPath);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = readLockOwner(lockPath);
      if (owner.state === "held" && isProcessAlive(owner.pid)) {
        throw new ProductBusyError(root, lockPath, owner.pid);
      }
      if (owner.state === "unknown" || attempt > 0) throw new ProductBusyError(root, lockPath, null);
      if (owner.state === "held") reclaimStaleLock(lockPath, root);
    }
  }
}

function reclaimStaleLock(lockPath, root) {
  const claimPath = path.join(path.dirname(lockPath), reclaimRelativePath);
  acquireReclaimClaim(claimPath, root);
  try {
    const owner = readLockOwner(lockPath);
    if (owner.state === "held" && isProcessAlive(owner.pid)) {
      throw new ProductBusyError(root, lockPath, owner.pid);
    }
    if (owner.state === "unknown") throw new ProductBusyError(root, lockPath, null);
    if (owner.state === "held") removeLockIfPresent(lockPath);
  } finally {
    removeLockIfPresent(claimPath);
  }
}

function acquireReclaimClaim(claimPath, root) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      createLockFile(claimPath);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = readLockOwner(claimPath);
      if (owner.state === "held" && isProcessAlive(owner.pid)) {
        throw new ProductBusyError(root, claimPath, owner.pid);
      }
      if (owner.state === "unknown" || attempt > 0) throw new ProductBusyError(root, claimPath, null);
      if (owner.state === "held") takeOverDeadClaim(claimPath, owner.pid, root);
    }
  }
}

function takeOverDeadClaim(claimPath, deadPid, root) {
  // Rename is the atomic step: only one taker can move the dead claim aside,
  // so concurrent takers cannot both treat it as removed.
  const takeoverPath = `${claimPath}.${process.pid}`;
  try {
    renameSync(claimPath, takeoverPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const captured = readLockOwner(takeoverPath);
  if (captured.state === "held" && captured.pid === deadPid && !isProcessAlive(deadPid)) {
    removeLockIfPresent(takeoverPath);
    return;
  }
  // The claim changed hands between read and rename: restore it and yield.
  try {
    renameSync(takeoverPath, claimPath);
  } catch {
    removeLockIfPresent(takeoverPath);
  }
  throw new ProductBusyError(root, claimPath, captured.state === "held" ? captured.pid : null);
}

function createLockFile(lockPath) {
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
    created = true;
    writeFileSync(descriptor, `${process.pid}\n`);
  } catch (error) {
    if (created) unlinkSync(lockPath);
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readLockOwner(lockPath) {
  let content;
  try {
    content = readFileSync(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { state: "released" };
    throw error;
  }
  const recordedPid = content.trim();
  const pid = Number.parseInt(recordedPid, 10);
  if (Number.isInteger(pid) && pid > 0 && String(pid) === recordedPid) return { state: "held", pid };
  return { state: "unknown" };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function removeLockIfPresent(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sweepDeadReclaimClaim(root) {
  for (const entry of readdirSync(root)) {
    if (entry !== reclaimRelativePath && !entry.startsWith(`${reclaimRelativePath}.`)) continue;
    const claimPath = path.join(root, entry);
    const owner = readLockOwner(claimPath);
    if (owner.state !== "held" || !isProcessAlive(owner.pid)) removeLockIfPresent(claimPath);
  }
}

function sweepOrphanedStaging(root) {
  for (const entry of readdirSync(root)) {
    if (entry.startsWith(stagingPrefix)) rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

export function assertProductNotBusy(root) {
  const normalizedRoot = realpathSync(path.resolve(root));
  const lockPath = path.join(normalizedRoot, lockRelativePath);
  const owner = readLockOwner(lockPath);
  if (owner.state === "held" && isProcessAlive(owner.pid)) {
    throw new ProductBusyError(normalizedRoot, lockPath, owner.pid);
  }
}

export function findLeftoverOperationState(root) {
  const normalizedRoot = realpathSync(path.resolve(root));
  const lockPath = path.join(normalizedRoot, lockRelativePath);
  const owner = readLockOwner(lockPath);
  if (owner.state === "held" && isProcessAlive(owner.pid)) return null;
  const entries = [];
  if (owner.state !== "released") entries.push(lockRelativePath);
  const claimEntries = readdirSync(normalizedRoot).filter(
    (entry) => entry === reclaimRelativePath || entry.startsWith(`${reclaimRelativePath}.`),
  );
  for (const entry of claimEntries.sort()) {
    const claimOwner = readLockOwner(path.join(normalizedRoot, entry));
    if (claimOwner.state !== "released" && !(claimOwner.state === "held" && isProcessAlive(claimOwner.pid))) {
      entries.push(entry);
    }
  }
  entries.push(
    ...readdirSync(normalizedRoot)
      .filter((entry) => entry.startsWith(stagingPrefix))
      .sort(),
  );
  return entries.length === 0 ? null : { root: normalizedRoot, entries };
}

function copyProductSource(root, stagingRoot) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      excludedSourceEntries.has(entry.name) ||
      entry.name.startsWith(stagingPrefix) ||
      entry.name.startsWith(`${reclaimRelativePath}.`) ||
      path.join(root, entry.name) === stagingRoot
    ) {
      continue;
    }
    copySourceEntry(path.join(root, entry.name), path.join(stagingRoot, entry.name), root);
  }
}

function copySourceEntry(sourcePath, destinationPath, root) {
  const metadata = lstatSync(sourcePath);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Refusing to stage symbolic link ${path.relative(root, sourcePath)}`);
  }
  if (metadata.isDirectory()) {
    mkdirSync(destinationPath);
    for (const entry of readdirSync(sourcePath).sort()) {
      copySourceEntry(path.join(sourcePath, entry), path.join(destinationPath, entry), root);
    }
    return;
  }
  if (!metadata.isFile()) throw new Error(`Refusing to stage non-file ${path.relative(root, sourcePath)}`);
  copyFileSync(sourcePath, destinationPath);
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("product transform must return an operation plan");
  }
  if (typeof plan.operation !== "string" || plan.operation.length === 0) {
    throw new TypeError("product operation plan requires operation");
  }
  if (!Array.isArray(plan.affectedIds) || !plan.affectedIds.every((id) => typeof id === "string")) {
    throw new TypeError("product operation plan requires affectedIds");
  }
  if (!Array.isArray(plan.replacements)) {
    throw new TypeError("product operation plan requires replacements");
  }
  return plan;
}

function applyReplacements(stagingRoot, replacements) {
  const canonicalPaths = [];
  const seenPaths = new Set();
  for (const replacement of replacements) {
    const relativePath = normalizeCanonicalPath(replacement?.path);
    if (seenPaths.has(relativePath)) throw new Error(`Duplicate canonical replacement ${relativePath}`);
    if (!replacement || typeof replacement.value !== "object" || replacement.value === null) {
      throw new TypeError(`Canonical replacement ${relativePath} requires a YAML mapping value`);
    }
    const target = resolveContainedOutput(stagingRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, stringify(replacement.value));
    seenPaths.add(relativePath);
    canonicalPaths.push(relativePath);
  }
  return canonicalPaths.sort();
}

function normalizeCanonicalPath(relativePath) {
  if (typeof relativePath !== "string") throw new TypeError("canonical replacement requires path");
  const normalized = relativePath.split(path.sep).join("/");
  if (
    normalized !== "product.yaml" &&
    !/^model\/(?:domains|concepts|relationships|use-cases|interfaces|guarantees)\/[^/]+\.yaml$/.test(normalized)
  ) {
    throw new Error(`Invalid canonical YAML replacement path ${JSON.stringify(relativePath)}`);
  }
  return normalized;
}

function validateStagedProduct(stagingRoot) {
  const check = validateProduct(stagingRoot);
  if (check.errors.length > 0) throw new Error(check.errors.join("\n"));
}

function copyPublishedFile(stagingRoot, relativePath, targetPath) {
  const sourcePath = resolveContainedOutput(stagingRoot, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}
