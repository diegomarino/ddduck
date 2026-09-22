import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateProduct } from "../check-model.mjs";
import { shellQuote, sourceDigestFromSources } from "./context-pack.mjs";
import { detectProductLayout, loadProductNodes } from "./product-layout.mjs";
import { assertProductNotBusy, findLeftoverOperationState } from "./product-operation.mjs";

export function compareProductSnapshots(before, after) {
  const beforeModel = modelId(before);
  const afterModel = modelId(after);
  if (beforeModel !== afterModel) {
    const error = new Error(`Cannot compare different Model IDs: ${beforeModel} and ${afterModel}`);
    error.nextAction = "Choose two product roots representing the same Model ID, then retry the diff.";
    throw error;
  }
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const result = { added: [], removed: [], changed: [], relocated: [] };
  for (const id of [...new Set([...beforeNodes.keys(), ...afterNodes.keys()])].sort()) {
    const previous = beforeNodes.get(id);
    const current = afterNodes.get(id);
    if (!previous) {
      result.added.push(record(current, after.canonicalPaths[id]));
    } else if (!current) {
      result.removed.push(record(previous, before.canonicalPaths[id]));
    } else {
      const changes = fieldChanges(previous, current);
      if (changes.length > 0) result.changed.push({ id, kind: current.kind, changes });
      if (before.canonicalPaths[id] !== after.canonicalPaths[id]) {
        result.relocated.push({
          id,
          kind: current.kind,
          beforePath: before.canonicalPaths[id],
          afterPath: after.canonicalPaths[id],
        });
      }
    }
  }
  return result;
}

export function compareProductRoots(beforeRoot, afterRoot) {
  const before = loadDiffRoot(beforeRoot);
  const after = loadDiffRoot(afterRoot);
  return {
    schemaVersion: "1",
    kind: "ModelDiff",
    before: { modelId: modelId(before.snapshot), sourceDigest: before.sourceDigest },
    after: { modelId: modelId(after.snapshot), sourceDigest: after.sourceDigest },
    scope: "canonical-yaml-only",
    excludedScopes: ["decision-content", "evidence-content", "delivery-artifacts", "runtime"],
    ...compareProductSnapshots(before.snapshot, after.snapshot),
  };
}

export function renderProductDiff(report) {
  const lines = [
    `Model diff: ${report.before.modelId}`,
    `Before: ${report.before.sourceDigest}`,
    `After: ${report.after.sourceDigest}`,
    `Scope: ${report.scope}`,
    `Excluded: ${report.excludedScopes.join(", ")}`,
  ];
  for (const entry of report.added) lines.push(`Added ${entry.id} (${entry.kind}) at ${entry.sourcePath}`);
  for (const entry of report.removed) lines.push(`Removed ${entry.id} (${entry.kind}) from ${entry.sourcePath}`);
  for (const entry of report.changed) {
    lines.push(`Changed ${entry.id} (${entry.kind})`);
    for (const change of entry.changes) {
      const before = change.beforePresent ? JSON.stringify(change.before) : "<absent>";
      const after = change.afterPresent ? JSON.stringify(change.after) : "<absent>";
      lines.push(`  ${change.path}: ${before} -> ${after}`);
    }
  }
  for (const entry of report.relocated) {
    lines.push(`Relocated ${entry.id} (${entry.kind}): ${entry.beforePath} -> ${entry.afterPath}`);
  }
  if ([report.added, report.removed, report.changed, report.relocated].every((entries) => entries.length === 0)) {
    lines.push("No canonical record changes.");
  }
  lines.push("Structural comparison requires human interpretation; source reads are not atomic snapshots.");
  return lines.join("\n");
}

function loadDiffRoot(rootPath) {
  const layout = detectProductLayout(rootPath);
  try {
    assertReadable(layout.root);
    const check = validateProduct(layout.root, { includeDocumentation: false, sourceOnly: true });
    if (check.errors.length > 0) throw new Error(`Validation failed for ${layout.root}:\n${check.errors.join("\n")}`);
    const loaded = loadProductNodes(layout);
    const canonicalPaths = Object.fromEntries(
      [...loaded.nodeFiles].map(([id, filePath]) => [
        id,
        path.relative(layout.root, filePath).split(path.sep).join("/"),
      ]),
    );
    const sources = new Map([...loaded.nodeSources].map(([id, bytes]) => [canonicalPaths[id], bytes]));
    assertReadable(layout.root);
    return {
      snapshot: { nodes: [...loaded.nodes.values()], canonicalPaths },
      sourceDigest: sourceDigestFromSources(sources),
    };
  } catch (error) {
    error.nextAction ??= `Fix the product root and its source files, run ddduck check --root ${shellQuote(layout.root)}, then retry the diff.`;
    throw error;
  }
}

function assertReadable(root) {
  assertProductNotBusy(root);
  const leftover = findLeftoverOperationState(root);
  if (leftover) {
    const error = new Error(`An interrupted ddduck operation left ${leftover.entries.join(", ")} in ${root}`);
    error.nextAction = `Run ddduck generate --root ${shellQuote(root)} to reclaim the interrupted operation state, then retry the diff.`;
    throw error;
  }
}

function modelId(snapshot) {
  const models = snapshot.nodes.filter((node) => node.kind === "Model");
  if (models.length !== 1) throw new Error("A product snapshot must contain exactly one Model record");
  return models[0].id;
}

function record(node, sourcePath) {
  return { id: node.id, kind: node.kind, sourcePath, node: globalThis.structuredClone(node) };
}

function fieldChanges(before, after, pointer = "") {
  const changes = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const fieldPath = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const beforePresent = Object.hasOwn(before, key);
    const afterPresent = Object.hasOwn(after, key);
    const previous = before[key];
    const current = after[key];
    if (beforePresent && afterPresent && isDeepStrictEqual(previous, current)) continue;
    if (beforePresent && afterPresent && isMapping(previous) && isMapping(current)) {
      changes.push(...fieldChanges(previous, current, fieldPath));
    } else {
      changes.push({
        path: fieldPath,
        beforePresent,
        afterPresent,
        ...(beforePresent ? { before: globalThis.structuredClone(previous) } : {}),
        ...(afterPresent ? { after: globalThis.structuredClone(current) } : {}),
      });
    }
  }
  return changes.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
