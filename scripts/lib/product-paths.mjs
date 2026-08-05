import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

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
