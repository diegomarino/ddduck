#!/usr/bin/env node

/**
 * The model checker behind `ddduck check`: validates a product root's canonical
 * YAML against the framework schemas, referential integrity (single Model,
 * ownership, decisions), evidence anchors, guarantee lifecycle rules, and the
 * executable policy checks (ownership, documentation model-reference
 * resolution). With --base it also enforces guarantee history retention against
 * a previous product root. Exports validateProduct for the operation runner,
 * query loader, and root resolver; runs standalone as a CLI (exit 1 on errors).
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { parseDocument } from "yaml";
import { detectProductLayout, loadProductNodes, nodeDirectoryKinds } from "./lib/product-layout.mjs";
import { shouldIgnoreScanEntry } from "./lib/scan-ignore.mjs";
import { findRepositoryRoot, resolveConfiguredIgnores } from "./lib/ddduck-config.mjs";

const executableRuleChecks = new Set([
  "concept-owner-domain",
  "documentation-model-reference-resolution",
  "no-dangling-model-reference",
]);

const markdownReferencePattern =
  /\b(?:(?:model|domain|concept|rel|use-case|interface):[a-z0-9][a-z0-9-]*|[A-Z][A-Z0-9-]+-(?:INV|AC)-[0-9]+|ADR-[0-9]{3})\b/g;

const defaultFrameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      parsed.root = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--base") {
      parsed.base = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--docs-root") {
      if (!parsed.docsRoots) parsed.docsRoots = [];
      parsed.docsRoots.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--source-only") {
      parsed.sourceOnly = true;
      continue;
    }
    if (arg === "--verbose") {
      parsed.verbose = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

/**
 * One validation run over a product root: loads nodes and decisions, then
 * accumulates every diagnostic in `errors` (file-relative, one per line) while
 * counting nodes, references, and executed policies for the verbose summary.
 */
class ProductCheck {
  constructor(rootPath, frameworkPath, basePath, documentationRoots, { sourceOnly = false } = {}) {
    this.root = rootPath;
    this.frameworkRoot = frameworkPath;
    this.baseRoot = basePath;
    this.documentationRoots = documentationRoots;
    this.sourceOnly = sourceOnly;
    this.layout = detectProductLayout(rootPath);
    this.nodes = new Map();
    this.nodeFiles = new Map();
    this.decisions = new Set();
    this.errors = [];
    this.referenceCount = 0;
    this.policyCount = 0;
  }

  run({ includeDocumentation = true } = {}) {
    this.loadDecisions();
    this.loadNodes();
    this.validateSchemas();
    this.validateNodeDirectories();
    this.validateEvidenceAnchors();
    this.validateReferences();
    this.validateGuaranteeLifecycle();
    this.validateGuaranteeHistory();
    this.loadPolicies();
    executePolicyChecks(this, this.policyChecks, { includeDocumentation });
    return this;
  }

  get nodeCount() {
    return this.nodes.size;
  }
  get decisionCount() {
    return this.decisions.size;
  }

  loadDecisions() {
    for (const file of listFiles(this.layout.decisionsDirectory, /^ADR-[0-9]{3}-.*\.md$/)) {
      this.decisions.add(file.match(/^ADR-[0-9]{3}/)[0]);
    }
  }

  loadNodes() {
    try {
      const loaded = loadProductNodes(this.layout);
      this.nodes = loaded.nodes;
      this.nodeFiles = loaded.nodeFiles;
    } catch (error) {
      this.errors.push(error.message);
    }
  }

  validateSchemas() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schemas = new Map();
    const schemaNames = new Map([
      ["Model", "model.schema.json"],
      ["Domain", "domain.schema.json"],
      ["Concept", "concept.schema.json"],
      ["Relationship", "relationship.schema.json"],
      ["UseCase", "use-case.schema.json"],
      ["DomainInterface", "domain-interface.schema.json"],
      ["Guarantee", "guarantee.schema.json"],
    ]);
    try {
      for (const file of listFiles(path.join(this.frameworkRoot, "schemas", "product"), /\.schema\.json$/)) {
        const schema = JSON.parse(readFileSync(path.join(this.frameworkRoot, "schemas", "product", file), "utf8"));
        ajv.addSchema(schema);
      }
      for (const [kind, file] of schemaNames) {
        schemas.set(kind, ajv.getSchema(`https://ddduck.local/schemas/product/${file}`));
      }
    } catch (error) {
      this.errors.push(`schemas/product: invalid schema: ${error.message}`);
      return;
    }
    for (const node of this.nodes.values()) {
      const validator = schemas.get(node.kind);
      if (!validator) {
        this.addError(node.id, `unknown product kind ${JSON.stringify(node.kind)}`);
        continue;
      }
      if (!validator(node)) {
        for (const error of validator.errors ?? [])
          this.addError(node.id, `schema validation failed at ${error.instancePath || "/"}: ${error.message}`);
      }
    }
  }

  validateNodeDirectories() {
    for (const [id, filePath] of this.nodeFiles) {
      const segments = path.relative(this.root, filePath).split(path.sep);
      if (segments[0] !== "model") continue;
      const expectedKind = nodeDirectoryKinds.get(segments[1]);
      if (!expectedKind) continue;
      const node = this.nodes.get(id);
      if (node.kind !== expectedKind) {
        this.addError(
          id,
          `node kind ${node.kind} does not match directory model/${segments[1]} (expected ${expectedKind})`,
        );
      }
    }
  }

  validateReferences() {
    const models = [...this.nodes.values()].filter((node) => node.kind === "Model");
    if (models.length !== 1) {
      this.errors.push(`product.yaml: expected exactly one Model node, found ${models.length}`);
      return;
    }
    const [model] = models;
    for (const domainId of asArray(model.domains)) this.requireNode(model, domainId, "domains");
    for (const useCaseId of asArray(model.useCases)) this.requireNode(model, useCaseId, "useCases");
    for (const relationshipId of asArray(model.relationships)) this.requireNode(model, relationshipId, "relationships");
    for (const decision of asArray(model.decisions)) this.requireDecision(model, decision, "decisions");
    const listedRelationships = new Set(asArray(model.relationships));
    const listedUseCases = new Set(asArray(model.useCases));
    for (const node of this.nodes.values()) {
      if (node.kind !== "Model" && node.model !== model.id) this.addError(node.id, `model must be ${model.id}`);
      if (node.kind === "Relationship" && !listedRelationships.has(node.id))
        this.addError(node.id, `model does not list node: ${node.id} in relationships`);
      if (node.kind === "UseCase" && !listedUseCases.has(node.id))
        this.addError(node.id, `model does not list node: ${node.id} in useCases`);
      if (["Concept", "DomainInterface", "Guarantee"].includes(node.kind))
        this.requireNode(node, node.ownerDomain, "ownerDomain");
      if (node.kind === "Domain") {
        for (const id of [...asArray(node.concepts), ...asArray(node.interfaces), ...asArray(node.guarantees)])
          this.requireNode(node, id, "owned nodes");
      }
      if (node.kind === "UseCase") {
        for (const id of asArray(node.interfaces)) this.requireNode(node, id, "interfaces");
      }
      for (const decision of asArray(node.decisions)) this.requireDecision(node, decision, "decisions");
      if (node.kind === "Guarantee" && node.lifecycleDecision !== undefined)
        this.requireDecision(node, node.lifecycleDecision, "lifecycleDecision");
      if (node.kind === "Relationship") {
        this.requireNode(node, node.from, "from");
        this.requireNode(node, node.to, "to");
        this.requireNode(node, node.ownedBy, "ownedBy");
      }
    }
  }

  validateEvidenceAnchors() {
    for (const node of this.nodes.values()) {
      for (const evidence of asArray(node.evidence)) {
        if (!isPlainObject(evidence) || typeof evidence.path !== "string") continue;
        if (!isExistingRegularFileBelowRoot(this.root, evidence.path)) {
          this.addError(
            node.id,
            `evidence anchor path must resolve to an existing regular file below product root: ${evidence.path}`,
          );
          continue;
        }
        // Markdown targets must contain the anchor text; non-Markdown anchors
        // stay free-form labels.
        if (evidence.path.endsWith(".md") && typeof evidence.anchor === "string") {
          const content = readFileSync(path.resolve(this.root, evidence.path), "utf8");
          if (!content.includes(evidence.anchor)) {
            this.addError(node.id, `evidence anchor not found in ${evidence.path}: ${evidence.anchor}`);
          }
        }
      }
    }
  }

  validateGuaranteeLifecycle() {
    for (const node of this.nodes.values()) {
      if (node.kind === "Guarantee" && node.status === "split") {
        const successors = asArray(node.successors);
        if (successors.length === 0) this.addError(node.id, "split guarantee requires active successors");
        for (const id of successors) {
          const successor = this.nodes.get(id);
          if (!successor || successor.kind !== "Guarantee") {
            this.addError(node.id, `split successor must be a guarantee ${id}`);
            continue;
          }
          // A successor may leave `active` through its own authorized lifecycle
          // transition; its record must then carry a registered lifecycleDecision.
          if (successor.status !== "active" && !this.decisions.has(successor.lifecycleDecision))
            this.addError(
              node.id,
              `split successor must be an active guarantee or carry a registered lifecycleDecision ${id}`,
            );
        }
      }
      if (node.kind === "DomainInterface" || node.kind === "UseCase") {
        const refs = [
          ...(node.kind === "DomainInterface" ? asArray(node.guarantees) : []),
          ...(node.kind === "UseCase" ? asArray(node.preconditions?.requires) : []),
          ...(node.kind === "UseCase" ? asArray(node.success?.preserves) : []),
          ...(node.kind === "UseCase" ? asArray(node.success?.establishes) : []),
        ];
        for (const id of refs) {
          const guarantee = this.nodes.get(id);
          if (!guarantee) this.addError(node.id, `missing guarantee ${id}`);
          else if (guarantee.kind !== "Guarantee" || guarantee.status !== "active")
            this.addError(node.id, `non-effective guarantee ${id}`);
        }
      }
    }
  }

  validateNoDanglingModelReferences() {
    // Reference resolution runs while each node is validated; this check is the policy hook for that behavior.
  }

  validateDocumentationReferences() {
    const generatedPrefix = path.join(this.root, "generated") + path.sep;
    const ignoredEntryNames = resolveConfiguredIgnores(findRepositoryRoot(this.root));
    const filePaths = new Set(
      this.documentationRoots
        .flatMap((root) => listMarkdownFiles(root, ignoredEntryNames))
        .filter((filePath) => !this.sourceOnly || !filePath.startsWith(generatedPrefix)),
    );
    for (const filePath of [...filePaths].sort()) {
      const source = readFileSync(filePath, "utf8");
      const tree = unified().use(remarkParse).parse(source);

      visitMarkdownValues(tree, (value, line) => {
        for (const match of value.matchAll(markdownReferencePattern)) {
          const ref = match[0];
          this.referenceCount += 1;
          if (this.nodes.has(ref) || this.decisions.has(ref)) continue;
          this.addError(filePath, `missing documentation reference ${ref} on line ${line}`);
        }
      });
    }
  }

  validateGuaranteeHistory() {
    if (!this.baseRoot) return;
    const baseLayout = detectProductLayout(this.baseRoot);
    if (!existsSync(baseLayout.productPath)) {
      this.errors.push(`base: expected a product root at ${baseLayout.root}`);
      return;
    }
    let baseNodes;
    try {
      baseNodes = loadProductNodes(baseLayout).nodes;
    } catch (error) {
      this.errors.push(`base: ${error.message}`);
      return;
    }
    const legalStatusTransitions = new Map([
      ["active", ["active", "split", "retired"]],
      ["split", ["split"]],
      ["retired", ["retired"]],
    ]);
    for (const baseNode of baseNodes.values()) {
      if (baseNode.kind !== "Guarantee") continue;
      const current = this.nodes.get(baseNode.id);
      if (!current) {
        this.errors.push(`guarantee disappeared from the product: ${baseNode.id}`);
        continue;
      }
      if (!(legalStatusTransitions.get(baseNode.status) ?? []).includes(current.status)) {
        this.addError(baseNode.id, `illegal guarantee status transition ${baseNode.status} -> ${current.status}`);
        continue;
      }
      if (baseNode.status === "split" || baseNode.status === "retired") {
        if (current.lifecycleDecision !== baseNode.lifecycleDecision)
          this.addError(
            baseNode.id,
            `closed guarantee must keep lifecycleDecision ${baseNode.lifecycleDecision} from base`,
          );
        const baseSuccessors = asArray(baseNode.successors);
        const currentSuccessors = asArray(current.successors);
        if (
          baseSuccessors.length !== currentSuccessors.length ||
          baseSuccessors.some((id, index) => currentSuccessors[index] !== id)
        )
          this.addError(baseNode.id, `closed guarantee must keep successors ${baseSuccessors.join(", ")} from base`);
      }
    }
  }

  loadPolicies() {
    this.policyChecks = new Set();
    let validate;
    try {
      const schemaPath = path.join(this.frameworkRoot, "policies", "policy-spec.schema.json");
      validate = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(schemaPath, "utf8")));
    } catch (error) {
      this.errors.push(`policies: invalid PolicySpec schema: ${error.message}`);
      return;
    }
    for (const file of listFiles(path.join(this.frameworkRoot, "policies"), /\.yaml$/)) {
      const document = parseDocument(readFileSync(path.join(this.frameworkRoot, "policies", file), "utf8"), {
        strict: true,
        uniqueKeys: true,
      });
      const policy = document.toJSON();
      if (document.errors.length || !validate(policy)) {
        this.errors.push(`policies/${file}: invalid PolicySpec`);
        continue;
      }
      this.policyCount += 1;
      const check = policy.implementation.check;
      if (!executableRuleChecks.has(check)) {
        this.errors.push(`policies/${file}: unknown executable rule check ${check}`);
        continue;
      }
      this.policyChecks.add(check);
    }
  }

  validateOwnership() {
    const ownedNodeKinds = new Map([
      ["Concept", "concepts"],
      ["DomainInterface", "interfaces"],
      ["Guarantee", "guarantees"],
    ]);
    const owningDomainsByNode = new Map();
    const domains = [...this.nodes.values()].filter((node) => node.kind === "Domain");
    const ownedNodes = [...this.nodes.values()].filter((node) => ownedNodeKinds.has(node.kind));

    for (const domain of domains) {
      for (const [kind, field] of ownedNodeKinds) {
        for (const nodeId of asArray(domain[field])) {
          const node = this.nodes.get(nodeId);
          if (node?.kind !== kind) continue;
          if (!owningDomainsByNode.has(nodeId)) owningDomainsByNode.set(nodeId, []);
          owningDomainsByNode.get(nodeId).push(domain.id);
        }
      }
    }

    for (const [nodeId, domainIds] of owningDomainsByNode) {
      if (domainIds.length > 1) {
        this.addError(nodeId, `node owned by multiple domains: ${nodeId} listed by ${domainIds.join(", ")}`);
      }
    }

    for (const node of ownedNodes) {
      const domainIds = owningDomainsByNode.get(node.id) ?? [];
      if (!domainIds.includes(node.ownerDomain)) {
        this.addError(node.id, `owner domain does not list node: ${node.id} ownerDomain ${node.ownerDomain}`);
      }
      for (const domainId of domainIds) {
        if (domainId !== node.ownerDomain) {
          this.addError(
            node.id,
            `node ownership mismatch: ${node.id} listed by ${domainId} but ownerDomain is ${node.ownerDomain}`,
          );
        }
      }
    }
  }

  requireNode(node, id, field) {
    this.referenceCount += 1;
    if (!this.nodes.has(id)) this.addError(node.id, `missing reference ${id} in ${field}`);
  }
  requireDecision(node, id, field) {
    this.referenceCount += 1;
    if (!this.decisions.has(id)) this.addError(node.id, `missing decision ${id} in ${field}`);
  }
  addError(id, message) {
    this.errors.push(`${this.nodeFiles.get(id) ? path.relative(this.root, this.nodeFiles.get(id)) : id}: ${message}`);
  }
}

function listFiles(directory, pattern) {
  try {
    return readdirSync(directory)
      .filter((file) => pattern.test(file))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Recursively list Markdown files under a documentation root, skipping ignored
 * scan entries, nested git checkouts, nested product roots, and the audit and
 * superpowers doc areas.
 * @param {string} rootPath - Documentation root to walk.
 * @param {string[]} [ignoredEntryNames] - Extra directory names to skip (from .ddduck config).
 * @returns {string[]} Sorted absolute Markdown file paths.
 */
function listMarkdownFiles(rootPath, ignoredEntryNames = []) {
  const files = [];

  function walk(directory) {
    if (directory !== rootPath && existsSync(path.join(directory, "product.yaml"))) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");
        if (
          !shouldIgnoreScanEntry(entry.name, ignoredEntryNames) &&
          !["docs/audits", "docs/superpowers"].includes(relativePath) &&
          !existsSync(path.join(entryPath, ".git"))
        ) {
          walk(entryPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath);
      }
    }
  }

  walk(rootPath);
  return files.sort();
}

function visitMarkdownValues(node, visitor) {
  if (node.type === "code") return;
  if (typeof node.value === "string") visitor(node.value, node.position?.start?.line ?? 1);
  for (const child of node.children ?? []) visitMarkdownValues(child, visitor);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExistingRegularFileBelowRoot(rootPath, relativePath) {
  if (path.isAbsolute(relativePath)) return false;
  const candidatePath = path.resolve(rootPath, relativePath);
  if (!isPathBelow(rootPath, candidatePath)) return false;
  try {
    const realRoot = realpathSync(rootPath);
    const realCandidate = realpathSync(candidatePath);
    return isPathBelow(realRoot, realCandidate) && statSync(realCandidate).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isPathBelow(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

const policyExecutors = new Map([
  ["concept-owner-domain", (check) => check.validateOwnership()],
  ["documentation-model-reference-resolution", (check) => check.validateDocumentationReferences()],
  ["no-dangling-model-reference", (check) => check.validateNoDanglingModelReferences()],
]);

function executePolicyChecks(check, checksToRun, { includeDocumentation = true } = {}) {
  for (const policyCheck of checksToRun) {
    if (!includeDocumentation && policyCheck === "documentation-model-reference-resolution") continue;
    policyExecutors.get(policyCheck)(check);
  }
}

/**
 * Validate a product root and return the completed check (inspect `.errors`).
 * @param {string} rootPath - Product root to validate.
 * @param {{baseRoot?: string, includeDocumentation?: boolean, documentationRoots?: string[], sourceOnly?: boolean}} [options] - Base product for history retention, documentation scope, and whether generated docs are scanned.
 * @returns {ProductCheck} The finished check with errors and counters.
 */
export function validateProduct(
  rootPath,
  { baseRoot, includeDocumentation = true, documentationRoots, sourceOnly = false } = {},
) {
  const root = path.resolve(rootPath);
  const basePath = baseRoot ? path.resolve(baseRoot) : undefined;
  const docsRoots = documentationRoots?.map((docsRoot) => path.resolve(docsRoot)) ?? [root];
  return new ProductCheck(root, defaultFrameworkRoot, basePath, docsRoots, { sourceOnly }).run({
    includeDocumentation,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const check = validateProduct(options.root ?? process.cwd(), {
    baseRoot: options.base,
    documentationRoots: options.docsRoots,
    sourceOnly: options.sourceOnly ?? false,
  });
  if (check.errors.length === 0) {
    if (options.verbose) {
      const policies = check.policyCount === undefined ? "" : ` policies=${check.policyCount}`;
      console.log(
        `nodes=${check.nodeCount} decisions=${check.decisionCount} refs=${check.referenceCount}${policies} ok`,
      );
    }
    process.exit(0);
  }

  console.error(check.errors.join("\n"));
  process.exit(1);
}
