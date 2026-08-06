#!/usr/bin/env node

/**
 * CLI for verifying FR-to-code audit records (`audit-fr-to-code --input
 * <audit.yaml> --source-root <source-id>=<checkout> --json`). Reads the YAML
 * audit record, binds each declared source to a local git checkout whose
 * origin URL and pinned 40-hex revision must match, reads anchored files via
 * `git show` at that exact revision (regular-file tree entries only), and
 * delegates verdict verification to lib/fr-to-code-audit.mjs, emitting one
 * JSON report on stdout.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { verifyFrToCodeAudit } from "./lib/fr-to-code-audit.mjs";
import { CliUsageError, parseCommandArgs, renderHelp, writeCliError } from "./lib/cli-contract.mjs";

/**
 * Parse arguments, verify the audit record against its pinned sources, and
 * write the JSON report.
 * @param {string[]} args - CLI arguments (--input, repeatable --source-root, --json).
 * @param {{stdout?: {write: (chunk: string) => unknown}}} [io] - Output stream override for tests.
 * @returns {void}
 */
export function runFrToCodeAudit(args, { stdout = process.stdout } = {}) {
  if (args.length === 1 && args[0] === "--help") {
    stdout.write(renderHelp("audit-fr-to-code"));
    return;
  }
  const { options } = parseCommandArgs(args, {
    options: { input: { value: true }, "source-root": { value: true, repeatable: true }, json: {} },
  });
  options.sourceRoots = options["source-root"].map(parseSourceRoot);
  if (!options.json) throw new CliUsageError("audit-fr-to-code requires --json");
  if (!options.input) throw new CliUsageError("audit-fr-to-code requires --input <audit.yaml>");

  const record = readAuditRecord(options.input);
  const sourceReader = createGitSourceReader(record, options.sourceRoots);
  const report = verifyFrToCodeAudit(record, sourceReader);
  stdout.write(`${JSON.stringify(report)}\n`);
}

function parseSourceRoot(value) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("--source-root requires <source-id>=<checkout>");
  }
  return { id: value.slice(0, separator), root: value.slice(separator + 1) };
}

function readAuditRecord(filePath) {
  const document = parseDocument(readFileSync(filePath, "utf8"), { strict: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`invalid YAML in ${filePath}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const record = document.toJSON();
  if (!isPlainObject(record)) throw new Error(`audit input must contain a YAML mapping: ${filePath}`);
  validateDeclaredSources(record, filePath);
  return record;
}

function validateDeclaredSources(record, filePath) {
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    throw new Error(`audit input must declare sources: ${filePath}`);
  }
  for (const source of record.sources) {
    if (!isPlainObject(source) || typeof source.id !== "string" || source.id.length === 0) {
      throw new Error(`audit source id must be a non-empty string: ${filePath}`);
    }
    if (typeof source.repository !== "string" || source.repository.length === 0) {
      throw new Error(`audit source repository must be a non-empty string for ${source.id}`);
    }
    if (typeof source.revision !== "string" || !/^[0-9a-f]{40}$/.test(source.revision)) {
      throw new Error(`audit source revision must be a 40-character lowercase hex commit ID for ${source.id}`);
    }
  }
}

/**
 * Build the source reader that serves file contents from pinned git revisions.
 * Requires exactly one --source-root mapping per declared source and verifies
 * each checkout's origin URL and revision presence up front.
 * @param {{sources: {id: string, repository: string, revision: string}[]}} record - The validated audit record.
 * @param {{id: string, root: string}[]} sourceRoots - Parsed --source-root mappings.
 * @returns {{readFile: (source: object, relativePath: string) => string}} Reader handed to verifyFrToCodeAudit.
 */
function createGitSourceReader(record, sourceRoots) {
  if (!Array.isArray(record.sources)) throw new Error("audit input must declare sources");
  const declaredIds = new Set(record.sources.map((source) => source?.id));
  for (const { id } of sourceRoots) {
    if (!declaredIds.has(id)) throw new Error(`--source-root maps undeclared source ID ${id}`);
  }

  const rootsById = new Map();
  for (const source of record.sources) {
    const matches = sourceRoots.filter(({ id }) => id === source.id);
    if (matches.length !== 1) {
      throw new Error(`audit-fr-to-code requires exactly one --source-root mapping for ${source.id}`);
    }
    rootsById.set(source.id, matches[0].root);
  }

  for (const source of record.sources) {
    verifyGitSource(source, rootsById.get(source.id));
  }

  return {
    readFile(source, relativePath) {
      const root = rootsById.get(source.id);
      verifyRegularFileEntry(source, root, relativePath);
      return runGit(source, root, ["show", "--end-of-options", `${source.revision}:${relativePath}`]);
    },
  };
}

function verifyGitSource(source, root) {
  const origin = runGit(source, root, ["remote", "get-url", "origin"]);
  if (origin.trim() !== source.repository) {
    throw new Error(`origin URL does not match declared repository for ${source.id}`);
  }
  try {
    runGit(source, root, ["cat-file", "-e", "--end-of-options", `${source.revision}^{commit}`]);
  } catch {
    throw new Error(`declared revision is absent from checkout for ${source.id}`);
  }
}

function verifyRegularFileEntry(source, root, relativePath) {
  const entry = runGit(source, root, [
    "ls-tree",
    "-z",
    "--full-tree",
    "--end-of-options",
    source.revision,
    "--",
    relativePath,
  ]);
  const [mode, type, object, entryPath] = parseTreeEntry(entry, source, relativePath);
  if ((mode !== "100644" && mode !== "100755") || type !== "blob" || !object) {
    throw new Error(`pinned tree entry is not a regular file for ${source.id}:${relativePath}`);
  }
  if (entryPath !== relativePath) {
    throw new Error(`pinned tree entry is missing for ${source.id}:${relativePath}`);
  }
}

function parseTreeEntry(output, source, relativePath) {
  const entries = output.split("\0").filter(Boolean);
  if (entries.length !== 1) {
    throw new Error(`pinned tree entry is missing for ${source.id}:${relativePath}`);
  }
  const tab = entries[0].indexOf("\t");
  if (tab < 0) {
    throw new Error(`could not inspect pinned tree entry for ${source.id}:${relativePath}`);
  }
  const fields = entries[0].slice(0, tab).split(" ");
  const entryPath = entries[0].slice(tab + 1);
  if (fields.length !== 3 || !entryPath)
    throw new Error(`could not inspect pinned tree entry for ${source.id}:${relativePath}`);
  return [...fields, entryPath];
}

function runGit(source, root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const target = args[0] === "show" ? ` ${source.id}:${args.at(-1).slice(args.at(-1).indexOf(":") + 1)}` : "";
    throw new Error(`git ${args[0]} failed${target}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runFrToCodeAudit(process.argv.slice(2));
  } catch (error) {
    writeCliError(error, {
      nextAction: "Run audit-fr-to-code --help, correct the input, and retry.",
    });
  }
}
