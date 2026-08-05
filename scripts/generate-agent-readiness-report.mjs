#!/usr/bin/env node

import path from "node:path";
import { generateAgentReadinessReport } from "./lib/agent-readiness-report.mjs";

try {
  const rootPath = parseArgs(process.argv.slice(2));
  const report = generateAgentReadinessReport(rootPath);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (Object.keys(report).length === 1 && Object.hasOwn(report, "unresolvedReferences")) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== "--root" || !args[1] || args[1].startsWith("--")) {
    throw new Error("usage: node scripts/generate-agent-readiness-report.mjs --root <product-root>");
  }
  return path.resolve(args[1]);
}
