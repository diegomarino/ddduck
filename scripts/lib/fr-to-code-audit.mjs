/**
 * Verification core for FR-to-code audit records, shared by the
 * audit-fr-to-code CLI and its tests. Validates a record against
 * schemas/fr-to-code-audit.schema.json, checks the requirement ID (and traced
 * guarantee) appear in the pinned requirement source, confirms every
 * production/test anchor's line range exists and digests its excerpt
 * (sha256), and enforces verdict consistency (realized-and-tested,
 * realized-untested, unrealized) before rendering the deterministic report.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const auditSchema = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schemas/fr-to-code-audit.schema.json"),
    "utf8",
  ),
);
const validateAudit = new Ajv2020({ allErrors: true, strict: true }).compile(auditSchema);

/**
 * Verify one audit record against its sources and render the report.
 * @param {object} record - The parsed FrToCodeAudit YAML mapping.
 * @param {{readFile: (source: object, relativePath: string) => string}} sourceReader - Reader that serves file text at each source's pinned revision.
 * @returns {object} The FrToCodeAuditReport document with digested anchors.
 */
export function verifyFrToCodeAudit(record, sourceReader) {
  const normalized = validateRecord(record);
  requireReader(sourceReader);
  const sourcesById = new Map(normalized.sources.map((source) => [source.id, source]));
  const requirementSource = requireSource(sourcesById, normalized.requirement.sourceId);
  const requirementPath = requireRelativePath(normalized.requirement.sourcePath, "requirement source path");
  const requirementText = sourceReader.readFile(requirementSource, requirementPath);
  requireText(requirementText, normalized.requirement.id, "requirement ID");
  if (normalized.requirement.tracedGuarantee) {
    requireText(requirementText, normalized.requirement.tracedGuarantee, "traced guarantee");
  }

  const productionAnchors = renderAnchors(normalized.productionAnchors, sourcesById, sourceReader);
  const testAnchors = renderAnchors(normalized.testAnchors, sourcesById, sourceReader);
  validateVerdict(normalized.verdict, productionAnchors, testAnchors);
  return renderReport(normalized, productionAnchors, testAnchors);
}

function validateRecord(record) {
  if (!validateAudit(record)) {
    throw new Error(`FrToCodeAudit must match the audit schema: ${validateAudit.errors[0].message}`);
  }
  if (record.sources.some((source, index) => record.sources.findIndex(({ id }) => id === source.id) !== index)) {
    throw new Error("FrToCodeAudit sources must have unique IDs");
  }
  for (const anchor of [...record.productionAnchors, ...record.testAnchors]) {
    if (anchor.endLine < anchor.startLine) {
      throw new Error("FrToCodeAudit anchor endLine must be greater than or equal to startLine");
    }
  }
  return JSON.parse(JSON.stringify(record));
}

function requireReader(sourceReader) {
  if (!sourceReader || typeof sourceReader.readFile !== "function") {
    throw new Error("FrToCodeAudit sourceReader must provide readFile(source, relativePath)");
  }
}

function requireSource(sourcesById, sourceId) {
  const source = sourcesById.get(sourceId);
  if (!source) throw new Error(`FrToCodeAudit references undeclared source ID ${sourceId}`);
  return source;
}

function requireRelativePath(relativePath, label) {
  if (path.posix.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new Error(`FrToCodeAudit ${label} must be source-relative without lexical escapes`);
  }
  return relativePath;
}

function requireText(text, value, label) {
  if (typeof text !== "string") throw new Error(`FrToCodeAudit source reader must return text for ${label}`);
  if (!text.includes(value)) throw new Error(`FrToCodeAudit ${label} ${value} is missing from its source file`);
}

/**
 * Resolve each anchor's source file, verify its line range fits the file, and
 * replace the excerpt with a sha256 digest in the rendered report.
 * @param {{sourceId: string, path: string, startLine: number, endLine: number}[]} anchors - Production or test anchors.
 * @param {Map<string, object>} sourcesById - Declared sources keyed by ID.
 * @param {{readFile: (source: object, relativePath: string) => string}} sourceReader - Pinned-revision file reader.
 * @returns {object[]} Sorted anchors with excerptDigest entries.
 */
function renderAnchors(anchors, sourcesById, sourceReader) {
  return anchors
    .map((anchor) => {
      const source = requireSource(sourcesById, anchor.sourceId);
      const relativePath = requireRelativePath(anchor.path, "anchor path");
      const text = sourceReader.readFile(source, relativePath);
      if (typeof text !== "string")
        throw new Error(`FrToCodeAudit source reader must return text for ${anchor.sourceId}:${relativePath}`);
      const lines = text.split("\n");
      const lineCount = lines.at(-1) === "" ? lines.length - 1 : lines.length;
      if (anchor.endLine > lineCount) {
        throw new Error(
          `FrToCodeAudit anchor ${anchor.startLine}-${anchor.endLine} is outside ${anchor.sourceId}:${relativePath}`,
        );
      }
      const excerpt = lines.slice(anchor.startLine - 1, anchor.endLine).join("\n");
      return {
        sourceId: anchor.sourceId,
        path: relativePath,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        excerptDigest: { algorithm: "sha256", value: digest(excerpt) },
      };
    })
    .sort(byAnchor);
}

function validateVerdict(verdict, productionAnchors, testAnchors) {
  if (verdict === "realized-and-tested" && (productionAnchors.length === 0 || testAnchors.length === 0)) {
    throw new Error("FrToCodeAudit realized-and-tested requires production and test anchors");
  }
  if (verdict === "realized-untested" && (productionAnchors.length === 0 || testAnchors.length !== 0)) {
    throw new Error("FrToCodeAudit realized-untested requires production anchors and no test anchors");
  }
  if (verdict === "unrealized" && (productionAnchors.length !== 0 || testAnchors.length !== 0)) {
    throw new Error("FrToCodeAudit unrealized permits no production or test anchors");
  }
}

function renderReport(record, productionAnchors, testAnchors) {
  return {
    schemaVersion: "1",
    kind: "FrToCodeAuditReport",
    audit: { id: record.id },
    sources: [...record.sources].sort((left, right) => compareLexical(left.id, right.id)),
    requirement: record.requirement,
    coverage: record.coverage,
    verdict: record.verdict,
    productionAnchors,
    testAnchors,
    reviewerDisposition: record.reviewerDisposition,
    diagnostics: [],
  };
}

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function byAnchor(left, right) {
  return (
    compareLexical(left.sourceId, right.sourceId) ||
    compareLexical(left.path, right.path) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine
  );
}

function compareLexical(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
