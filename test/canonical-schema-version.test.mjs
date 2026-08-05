import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productSchemaDirectory = path.join(root, "schemas", "product");
const canonicalProductRoots = [path.join(root, "docs", "ddd"), path.join(root, "examples", "reminders", "ddd")];

test('canonical product schemaVersion is exactly "1" in schemas and YAML', () => {
  for (const fileName of readdirSync(productSchemaDirectory).filter((fileName) => fileName.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(path.join(productSchemaDirectory, fileName), "utf8"));
    if (!schema.required?.includes("schemaVersion")) continue;
    assert.equal(schema.properties.schemaVersion.const, "1", fileName);
  }

  for (const productRoot of canonicalProductRoots) {
    for (const filePath of canonicalYamlFiles(productRoot)) {
      assert.match(readFileSync(filePath, "utf8"), /^schemaVersion: "1"$/m, path.relative(root, filePath));
    }
  }
});

function canonicalYamlFiles(productRoot) {
  const model = path.join(productRoot, "model");
  return [path.join(productRoot, "product.yaml"), ...walkYamlFiles(model)];
}

function walkYamlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkYamlFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".yaml") ? [entryPath] : [];
  });
}
