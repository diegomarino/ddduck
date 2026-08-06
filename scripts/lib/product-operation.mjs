/**
 * The locked, staged mutation runner behind every product-changing ddduck
 * command (generate, create/move/split/retire). Holds the invariants: one
 * operation at a time per product root (.ddduck-operation.lock, reclaimable
 * only when its owner PID is dead), all edits validated in a staging copy
 * before any canonical or generated file is published, and canonical YAML
 * rewritten comment-preservingly. Also exports the canonical generatedPaths
 * list and the busy/leftover-state probes used by check and query.
 */

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
import { isScalar, parseDocument, stringify } from "yaml";
import { checkGeneratedDocs } from "../check-generated-docs.mjs";
import { checkGeneratedGraph } from "../check-generated-graph.mjs";
import { validateProduct } from "../check-model.mjs";
import { shellQuote } from "./context-pack.mjs";
import { writeModelOverview } from "../generate-docs.mjs";
import { writeModelGraph } from "../generate-graph.mjs";
import { detectProductLayout, loadProductSnapshot } from "./product-layout.mjs";
import { resolveContainedOutput } from "./product-paths.mjs";
import { nonProductSourceEntries } from "./product-root-resolver.mjs";

const lockRelativePath = ".ddduck-operation.lock";
const reclaimRelativePath = ".ddduck-operation.reclaim";
const stagingPrefix = ".ddduck-operation-stage-";
// The canonical generated views: one list consumed by mutation results, query
// freshness, the check gate, and the docs. The SVG is rendered by the Graphviz
// WASM engine, which is async, so we produce it in a child process to keep this
// runner synchronous (mirrors the check subprocess).
export const generatedPaths = Object.freeze([
  "generated/docs/model-overview.md",
  "generated/graph/model-graph.json",
  "generated/graph/model-graph.ndjson",
  "generated/graph/model-graph.svg",
]);
const svgGeneratorScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "generate-graph-svg.mjs");
const excludedSourceEntries = new Set([...nonProductSourceEntries, lockRelativePath, reclaimRelativePath]);

/**
 * Raised when a product root's operation lock is held; carries exitCode 2 when
 * the holder is a live process (the one retryable failure).
 */
export class ProductBusyError extends Error {
  constructor(root, lockPath, ownerPid) {
    const holder = ownerPid ? ` (held by running process ${ownerPid})` : "";
    super(`Product root is busy: ${root}; ${lockPath} exists${holder}`);
    this.name = "ProductBusyError";
    this.nextAction = ownerPid
      ? `Wait for process ${ownerPid} to finish and retry, or delete ${lockPath} and retry if that process is not a ddduck operation.`
      : `If no other ddduck operation is running on this product, delete ${lockPath} and retry.`;
    // Contention with a running ddduck operation is the one retryable failure;
    // exit code 2 lets callers retry it without string-matching stderr. Every
    // other failure, including a lock without a live owner, stays exit 1.
    if (ownerPid) this.exitCode = 2;
  }
}

/**
 * Run one mutation against a product root: acquire the lock, sweep dead
 * reclaim claims and orphaned staging, copy the source into staging, apply the
 * transform's replacement plan, validate the staged product, regenerate every
 * generated view (SVG via subprocess), then publish canonical and generated
 * files back file-by-file. The lock and staging are always cleaned up.
 * @param {{root: string, transform: (snapshot: {nodes: object[], canonicalPaths: Record<string, string>}) => {operation: string, affectedIds: string[], replacements: {path: string, value: object}[]}}} params - Product root and plan-building transform.
 * @returns {{operation: string, root: string, affectedIds: string[], canonicalPaths: string[], generatedPaths: string[]}} The published operation result.
 */
export function runProductOperation({ root, transform }) {
  if (typeof transform !== "function") throw new TypeError("product operation requires a transform function");
  const normalizedRoot = realpathSync(path.resolve(root));
  const lockPath = resolveContainedOutput(normalizedRoot, lockRelativePath);
  const publishGeneratedTargets = generatedPaths.map((relativePath) =>
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
    validateStagedProduct(stagingRoot, normalizedRoot);
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
    ]);
    for (let index = 0; index < canonicalPaths.length; index += 1) {
      copyPublishedFile(stagingRoot, canonicalPaths[index], publishCanonicalTargets[index]);
    }
    for (let index = 0; index < generatedPaths.length; index += 1) {
      copyPublishedFile(stagingRoot, generatedPaths[index], publishGeneratedTargets[index]);
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

/**
 * Probe whether a PID belongs to a live process (signal 0; EPERM counts as alive).
 * @param {number} pid - Process ID recorded in a lock, claim, or init stage name.
 * @returns {boolean} True unless the process is definitely gone (ESRCH).
 */
export function isProcessAlive(pid) {
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

/**
 * Throw ProductBusyError if the product's operation lock is held by a live
 * process; used by read paths (check, query) that must not run mid-mutation.
 * @param {string} root - Product root path.
 * @returns {void}
 */
export function assertProductNotBusy(root) {
  const normalizedRoot = realpathSync(path.resolve(root));
  const lockPath = path.join(normalizedRoot, lockRelativePath);
  const owner = readLockOwner(lockPath);
  if (owner.state === "held" && isProcessAlive(owner.pid)) {
    throw new ProductBusyError(normalizedRoot, lockPath, owner.pid);
  }
}

/**
 * List interrupted-operation debris (ownerless lock, dead reclaim claims,
 * staging directories) that a future operation would reclaim; live locks are
 * not leftovers.
 * @param {string} root - Product root path.
 * @returns {{root: string, entries: string[]}|null} The leftover entries, or null when the root is clean.
 */
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
    writeFileSync(target, serializeReplacement(target, relativePath, replacement.value));
    seenPaths.add(relativePath);
    canonicalPaths.push(relativePath);
  }
  return canonicalPaths.sort();
}

/**
 * Rewrite an existing canonical file by editing its parsed YAML document key by
 * key instead of re-serializing the plan value wholesale, so authored comments
 * and formatting outside the keys a mutation actually changes survive. New
 * files have no authored content to preserve and take the plain serialization.
 * Staged validation still covers the exact published bytes: this runs before
 * validateStagedProduct, and publication copies these staged bytes verbatim.
 * @param {string} target - Absolute staged path of the canonical file.
 * @param {string} relativePath - Root-relative canonical path (for diagnostics).
 * @param {object} value - The replacement YAML mapping from the operation plan.
 * @returns {string} The staged file's new YAML source.
 */
function serializeReplacement(target, relativePath, value) {
  let source;
  try {
    source = readFileSync(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return stringify(value);
  }
  const document = parseDocument(source, { keepSourceTokens: true, strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `invalid YAML in canonical replacement ${relativePath}: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  const current = document.toJSON();
  if (current === null || typeof current !== "object" || Array.isArray(current)) return stringify(value);
  for (const [key, next] of Object.entries(value)) {
    if (key in current && JSON.stringify(current[key]) === JSON.stringify(next)) continue;
    const existing = document.get(key, true);
    if (isScalar(existing) && (next === null || typeof next !== "object")) {
      existing.value = next;
    } else {
      document.set(key, document.createNode(next));
    }
  }
  for (const key of Object.keys(current)) {
    if (!(key in value)) document.delete(key);
  }
  return document.toString();
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

function validateStagedProduct(stagingRoot, root) {
  const check = validateProduct(stagingRoot);
  if (check.errors.length > 0) throw validationFailureError(root, check.errors);
}

/**
 * Build the error for a failed product validation. Validation failures are
 * model failures, not CLI-input failures, so the Next: line must point at the
 * real unblock instead of the per-command usage hint: referential lifecycle
 * blockers name the referencing file and the edit-regenerate-retry path,
 * base-retention failures name the sanctioned remedies, and everything else is
 * a source-file fix.
 * @param {string} root - Product root the validation ran against.
 * @param {string[]} errors - Checker diagnostics, one per line.
 * @returns {Error} Error with a tailored nextAction property.
 */
export function validationFailureError(root, errors) {
  const error = new Error(`Validation failed for ${root}:\n${errors.join("\n")}`);
  const referencingFiles = [
    ...new Set(
      errors
        .filter((line) => /: (?:non-effective guarantee|split successor must be) /.test(line))
        .map((line) => line.slice(0, line.indexOf(":"))),
    ),
  ];
  if (referencingFiles.length > 0) {
    error.nextAction = `Edit ${referencingFiles.join(", ")} to remove or replace the blocking guarantee reference, run ddduck generate --root ${shellQuote(root)}, and retry.`;
  } else if (errors.some((line) => line.startsWith("guarantee disappeared from the product"))) {
    error.nextAction =
      "Restore the guarantee record from the base product, or record the transition with ddduck retire or ddduck split, then re-run ddduck check.";
  } else {
    error.nextAction = "Fix the listed source files, then re-run ddduck check.";
  }
  return error;
}

function copyPublishedFile(stagingRoot, relativePath, targetPath) {
  const sourcePath = resolveContainedOutput(stagingRoot, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}
