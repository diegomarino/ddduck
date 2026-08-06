/**
 * Path-containment guard for every write below a product root. Any file
 * ddduck creates or publishes (generated views, staged canonical files, lock
 * and staging paths, eval outputs) resolves its destination through
 * resolveContainedOutput, which rejects absolute paths, `..` traversal,
 * escapes above the root, and symbolic links anywhere on the target path — so
 * no operation can be steered into writing outside the root.
 */

import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Resolve a root-relative output path to an absolute one, proving it stays
 * below the real root and traverses or targets no symbolic link.
 * @param {string} rootPath - The containing root (product root or repo root).
 * @param {string} relativePath - Root-relative destination path.
 * @returns {string} The absolute, contained target path.
 */
export function resolveContainedOutput(rootPath, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error("output path must be relative to root");
  }

  const segments = relativePath.split(/[\\/]/);
  if (segments.includes("..")) {
    throw new Error("output path must not contain .. traversal");
  }

  const realRoot = realpathSync(rootPath);
  const target = path.resolve(realRoot, relativePath);
  const relative = path.relative(realRoot, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("output path must stay below root");
  }

  let current = realRoot;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    if (lstatOrMissing(current)?.isSymbolicLink()) {
      throw new Error("output path must not traverse a symbolic link");
    }
  }

  if (lstatOrMissing(target)?.isSymbolicLink()) {
    throw new Error("output path must not target a symbolic link");
  }

  return target;
}

function lstatOrMissing(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
