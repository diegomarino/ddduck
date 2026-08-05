import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("global PolicySpecs conform to their framework schema", () => {
  const schema = JSON.parse(readFileSync(path.join(root, "policies", "policy-spec.schema.json"), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  for (const file of [
    "concept-owner-domain.yaml",
    "documentation-model-reference-resolution.yaml",
    "no-dangling-model-reference.yaml",
  ]) {
    const policy = parseDocument(readFileSync(path.join(root, "policies", file), "utf8")).toJSON();
    assert.ok(validate(policy), `${file}: ${JSON.stringify(validate.errors)}`);
  }
});
