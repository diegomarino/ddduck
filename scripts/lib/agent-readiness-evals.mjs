import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { runQuery } from "../query-model.mjs";
import { loadQueryProduct } from "./product-query.mjs";

const supportedOperations = new Set(["node", "neighbors", "impact", "anchors", "spec", "context"]);
const shellText = /[\n\r;&|`$()<>\\]/;
const recordKeys = new Set(["schemaVersion", "id", "root", "query", "candidateEvidence"]);
const queryKeys = new Set(["operation", "args"]);
const candidateEvidenceKeys = new Set(["origin", "citations", "facts"]);
const citationKeys = new Set(["id", "sourcePath"]);
const factKeys = new Set(["pointer", "equals"]);

export function runAgentReadinessEvals({ inputPath, repoRoot }) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const records = readRecords(inputPath);
  const duplicateIds = duplicateRecordIds(records);
  const cases = records
    .map((record) => evaluateRecord(record, { repoRoot: resolvedRepoRoot, duplicateIds }))
    .sort(compareCases)
    .map(stripLine);

  return {
    schemaVersion: "1",
    passed: cases.every((entry) => entry.passed),
    cases,
  };
}

export function validateCandidateEvidence(document, candidateEvidence, { productRoot } = {}) {
  const diagnostics = [];
  if (!isObject(candidateEvidence)) {
    return ["candidateEvidence must be an object"];
  }
  diagnostics.push(...unknownKeyDiagnostics(candidateEvidence, "candidateEvidence", candidateEvidenceKeys));
  if (candidateEvidence.origin !== "query") {
    diagnostics.push('candidate evidence origin must be "query"');
  }

  const availableCitations = collectCitations(document);
  if (!Array.isArray(candidateEvidence.citations)) {
    diagnostics.push("candidate evidence citations must be an array");
  } else {
    for (const citation of [...candidateEvidence.citations].sort(compareCitations)) {
      if (isObject(citation)) {
        diagnostics.push(...unknownKeyDiagnostics(citation, "citation", citationKeys));
      }
      if (!isCitation(citation)) {
        diagnostics.push("candidate evidence citation must contain string id and sourcePath");
        continue;
      }
      if (!availableCitations.some((available) => sameCitation(available, citation))) {
        diagnostics.push(`citation does not occur in query document: ${citation.id} at ${citation.sourcePath}`);
      }
    }
  }

  if (!Array.isArray(candidateEvidence.facts)) {
    diagnostics.push("candidate evidence facts must be an array");
  } else {
    for (const fact of [...candidateEvidence.facts].sort(compareFacts)) {
      if (isObject(fact)) {
        diagnostics.push(...unknownKeyDiagnostics(fact, "fact", factKeys));
      }
      if (!isObject(fact) || typeof fact.pointer !== "string" || !Object.hasOwn(fact, "equals")) {
        diagnostics.push("candidate evidence fact must contain pointer and equals");
        continue;
      }
      const resolved = resolveJsonPointer(document, fact.pointer);
      if (!resolved.ok) {
        diagnostics.push(`fact JSON Pointer is invalid: ${fact.pointer} (${resolved.error})`);
        continue;
      }
      if (!deepJsonEqual(resolved.value, resolveFactExpectation(fact.equals, productRoot))) {
        diagnostics.push(`fact does not strictly equal query value at ${fact.pointer}`);
      }
    }
  }

  return diagnostics.sort(compareStrings);
}

function readRecords(inputPath) {
  let input;
  try {
    input = readFileSync(inputPath, "utf8");
  } catch (error) {
    return [invalidRecord(1, `cannot read eval input: ${error.message}`)];
  }

  const records = input
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, lineNumber }) => {
      try {
        return { lineNumber, value: JSON.parse(line) };
      } catch (error) {
        return invalidRecord(lineNumber, `invalid JSONL record: ${error.message}`);
      }
    });
  return records.length > 0
    ? records
    : [invalidRecord(1, "eval input must contain at least one non-empty JSONL record")];
}

function invalidRecord(lineNumber, diagnostic) {
  return { lineNumber, diagnostic };
}

function duplicateRecordIds(records) {
  const counts = new Map();
  for (const record of records) {
    if (typeof record.value?.id === "string") {
      counts.set(record.value.id, (counts.get(record.value.id) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

function evaluateRecord(record, { repoRoot, duplicateIds }) {
  const id = typeof record.value?.id === "string" ? record.value.id : `line:${record.lineNumber}`;
  const recordDiagnostics = record.diagnostic
    ? [record.diagnostic]
    : validateRecord(record.value, { repoRoot, duplicateIds });
  const evidenceDiagnostics = record.diagnostic ? [] : validateCandidateEvidenceShape(record.value?.candidateEvidence);
  const entry = {
    id,
    root: typeof record.value?.root === "string" ? normalizePath(record.value.root) : null,
    query: null,
    sourceDigest: null,
    evidence: normalizeEvidence(record.value?.candidateEvidence),
    passed: false,
    diagnostics: [...recordDiagnostics, ...evidenceDiagnostics],
    line: record.lineNumber,
  };
  if (recordDiagnostics.length > 0) return finalizeCase(entry);

  const root = resolveProductRoot(repoRoot, record.value.root);
  const query = normalizeQuery(record.value.query);
  entry.query = query;
  try {
    const document = runCapturedQuery(query, record.value.root, repoRoot);
    entry.sourceDigest = loadQueryProduct(root).sourceDigest;
    if (evidenceDiagnostics.length === 0) {
      entry.diagnostics.push(
        ...validateCandidateEvidence(document, record.value.candidateEvidence, {
          productRoot: realpathSync(root),
        }),
      );
    }
  } catch (error) {
    entry.diagnostics.push(`query failed: ${error.message}`);
  }
  return finalizeCase(entry);
}

function validateRecord(record, { repoRoot, duplicateIds }) {
  const diagnostics = [];
  if (!isObject(record)) return ["eval record must be an object"];
  diagnostics.push(...unknownKeyDiagnostics(record, "record", recordKeys));
  if (record.schemaVersion !== "1") diagnostics.push('schemaVersion must be "1"');
  if (typeof record.id !== "string" || record.id === "") {
    diagnostics.push("id must be a non-empty string");
  } else if (duplicateIds.has(record.id)) {
    diagnostics.push(`duplicate eval id: ${record.id}`);
  }
  if (typeof record.root !== "string" || !isPathBelow(repoRoot, record.root)) {
    diagnostics.push("root must be a repository-relative path below repoRoot");
  }
  diagnostics.push(...validateQuery(record.query));
  return diagnostics.sort(compareStrings);
}

function validateCandidateEvidenceShape(candidateEvidence) {
  const diagnostics = [];
  if (!isObject(candidateEvidence)) return ["candidateEvidence must be an object"];
  diagnostics.push(...unknownKeyDiagnostics(candidateEvidence, "candidateEvidence", candidateEvidenceKeys));
  if (candidateEvidence.origin !== "query") {
    diagnostics.push('candidate evidence origin must be "query"');
  }
  if (!Array.isArray(candidateEvidence.citations)) {
    diagnostics.push("candidate evidence citations must be an array");
  } else {
    for (const citation of candidateEvidence.citations) {
      if (isObject(citation)) diagnostics.push(...unknownKeyDiagnostics(citation, "citation", citationKeys));
      if (!isCitation(citation)) diagnostics.push("candidate evidence citation must contain string id and sourcePath");
    }
  }
  if (!Array.isArray(candidateEvidence.facts)) {
    diagnostics.push("candidate evidence facts must be an array");
  } else {
    for (const fact of candidateEvidence.facts) {
      if (isObject(fact)) diagnostics.push(...unknownKeyDiagnostics(fact, "fact", factKeys));
      if (!isObject(fact) || typeof fact.pointer !== "string" || !Object.hasOwn(fact, "equals")) {
        diagnostics.push("candidate evidence fact must contain pointer and equals");
      }
    }
  }
  return diagnostics.sort(compareStrings);
}

function validateQuery(query) {
  const diagnostics = [];
  if (!isObject(query)) return ["query must be an object"];
  diagnostics.push(...unknownKeyDiagnostics(query, "query", queryKeys));
  if (!supportedOperations.has(query.operation)) {
    diagnostics.push("query operation must be node, neighbors, impact, anchors, spec, or context");
  }
  if (!Array.isArray(query.args)) {
    diagnostics.push("query args must be an array");
    return diagnostics;
  }

  for (let index = 0; index < query.args.length; index += 1) {
    const argument = query.args[index];
    if (typeof argument !== "string") {
      diagnostics.push("query args must contain only strings");
      continue;
    }
    if (shellText.test(argument)) diagnostics.push(`query args must not contain shell text: ${argument}`);
    if (argument === "--root" || argument === "--json" || argument === "--history") {
      diagnostics.push(`query args must not include ${argument}`);
    }
    if (argument === "--id") {
      const id = query.args[index + 1];
      if (typeof id !== "string" || id === "" || id.startsWith("--") || shellText.test(id)) {
        diagnostics.push("query --id requires one plain ID value");
      } else {
        index += 1;
      }
      continue;
    }
    if (argument.startsWith("--")) diagnostics.push(`unsupported query argument: ${argument}`);
    else if (index === 0 || query.args[index - 1] !== "--id") diagnostics.push(`unsupported query value: ${argument}`);
  }
  return diagnostics.sort(compareStrings);
}

function normalizeQuery(query) {
  const ids = [];
  for (let index = 0; index < query.args.length; index += 2) ids.push(query.args[index + 1]);
  return {
    operation: query.operation,
    args: ids.sort(compareStrings).flatMap((id) => ["--id", id]),
  };
}

function runCapturedQuery(query, root, repoRoot) {
  let output = "";
  runQuery([query.operation, ...query.args, "--root", root, "--json"], {
    cwd: repoRoot,
    stdout: { write: (chunk) => (output += chunk) },
  });
  return JSON.parse(output);
}

function resolveProductRoot(repoRoot, root) {
  return path.resolve(repoRoot, root);
}

// Fact expectations may reference the machine-specific resolved root through the
// portable <product-root> placeholder, matching the CLI's substituted output.
function resolveFactExpectation(equals, productRoot) {
  if (typeof productRoot !== "string" || productRoot === "") return equals;
  if (typeof equals === "string") return equals.replaceAll("<product-root>", productRoot);
  if (Array.isArray(equals)) return equals.map((entry) => resolveFactExpectation(entry, productRoot));
  if (isObject(equals)) {
    return Object.fromEntries(
      Object.entries(equals).map(([key, value]) => [key, resolveFactExpectation(value, productRoot)]),
    );
  }
  return equals;
}

function isPathBelow(repoRoot, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.trim() === "") return false;
  const resolved = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, resolved);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    return false;
  }
  try {
    const realRepoRoot = realpathSync(repoRoot);
    const realProductRoot = realpathSync(resolved);
    const realRelative = path.relative(realRepoRoot, realProductRoot);
    return (
      realRelative !== "" &&
      !realRelative.startsWith(`..${path.sep}`) &&
      realRelative !== ".." &&
      !path.isAbsolute(realRelative)
    );
  } catch (error) {
    if (error.code === "ENOENT") return true;
    return false;
  }
}

function collectCitations(value, citations = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectCitations(entry, citations);
  } else if (isObject(value)) {
    if (isCitation(value)) citations.push({ id: value.id, sourcePath: value.sourcePath });
    for (const entry of Object.values(value)) collectCitations(entry, citations);
  }
  return citations.sort(compareCitations);
}

function resolveJsonPointer(document, pointer) {
  if (pointer === "") return { ok: true, value: document };
  if (!pointer.startsWith("/")) return { ok: false, error: "must start with /" };
  const tokens = pointer.slice(1).split("/").map(decodePointerToken);
  if (tokens.some((token) => token === null)) return { ok: false, error: "contains an invalid escape" };

  let current = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token) || Number(token) >= current.length) {
        return { ok: false, error: "does not resolve" };
      }
      current = current[Number(token)];
    } else if (isObject(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      return { ok: false, error: "does not resolve" };
    }
  }
  return { ok: true, value: current };
}

function decodePointerToken(token) {
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== "~") continue;
    if (token[index + 1] !== "0" && token[index + 1] !== "1") return null;
    index += 1;
  }
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function normalizeEvidence(candidateEvidence) {
  if (!isObject(candidateEvidence)) return null;
  return {
    origin: candidateEvidence.origin ?? null,
    citations: Array.isArray(candidateEvidence.citations)
      ? candidateEvidence.citations.filter(isObject).map(normalizeCitation).sort(compareCitations)
      : [],
    facts: Array.isArray(candidateEvidence.facts)
      ? candidateEvidence.facts.filter(isObject).map(normalizeFact).sort(compareFacts)
      : [],
  };
}

function normalizeCitation(citation) {
  return { id: citation.id ?? null, sourcePath: citation.sourcePath ?? null };
}

function normalizeFact(fact) {
  const normalized = { pointer: fact.pointer ?? null };
  if (Object.hasOwn(fact, "equals")) normalized.equals = fact.equals;
  return normalized;
}

function finalizeCase(entry) {
  return {
    ...entry,
    passed: entry.diagnostics.length === 0,
    diagnostics: [...entry.diagnostics].sort(compareStrings),
  };
}

function stripLine({ line: _line, ...caseResult }) {
  return caseResult;
}

function compareCases(left, right) {
  return compareStrings(left.id, right.id) || left.line - right.line;
}

function compareCitations(left, right) {
  return (
    compareStrings(left?.id ?? "", right?.id ?? "") || compareStrings(left?.sourcePath ?? "", right?.sourcePath ?? "")
  );
}

function compareFacts(left, right) {
  return compareStrings(left?.pointer ?? "", right?.pointer ?? "");
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unknownKeyDiagnostics(value, level, allowedKeys) {
  return Object.keys(value)
    .filter((key) => !allowedKeys.has(key))
    .sort(compareStrings)
    .map((key) => `unknown key: ${key} (${level})`);
}

function sameCitation(left, right) {
  return left.id === right.id && left.sourcePath === right.sourcePath;
}

function deepJsonEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepJsonEqual(value, right[index]))
    );
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort(compareStrings);
  const rightKeys = Object.keys(right).sort(compareStrings);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deepJsonEqual(left[key], right[key]))
  );
}

function isCitation(value) {
  return isObject(value) && typeof value.id === "string" && typeof value.sourcePath === "string";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}
