#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format } from "prettier";
import { runAgentReadinessEvals } from "./lib/agent-readiness-evals.mjs";
import { resolveContainedOutput } from "./lib/product-paths.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const outputTarget = options.output ? resolveOutputPath(options.repoRoot, options.output) : null;
  const result = runAgentReadinessEvals(options);
  const output = await format(JSON.stringify(result), { parser: "json", printWidth: 120 });
  process.stdout.write(output);
  if (outputTarget) writeOutput(outputTarget, output);
  process.exitCode = result.passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!["--input", "--repo-root", "--output"].includes(argument)) {
      throw new Error(
        "usage: node scripts/run-agent-readiness-evals.mjs --input <jsonl> --repo-root <path> [--output <json>]",
      );
    }
    if (Object.hasOwn(options, argument)) throw new Error(`duplicate CLI argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    options[argument] = value;
    index += 1;
  }
  if (!options["--input"] || !options["--repo-root"]) {
    throw new Error(
      "usage: node scripts/run-agent-readiness-evals.mjs --input <jsonl> --repo-root <path> [--output <json>]",
    );
  }
  return {
    inputPath: path.resolve(options["--input"]),
    repoRoot: path.resolve(options["--repo-root"]),
    output: options["--output"],
  };
}

function resolveOutputPath(repoRoot, outputPath) {
  if (outputPath.split(/[\\/]/)[0] === ".git") throw new Error("output path must not target .git");
  return resolveContainedOutput(repoRoot, outputPath);
}

function writeOutput(target, output) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, output);
}
