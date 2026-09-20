#!/usr/bin/env node

/**
 * Entry point for the `ddduck` CLI (the package bin). Dispatches the commands
 * init, check, generate, query, install, and the guarantee lifecycle commands
 * create/move/split/retire. Mutations run through the locked, staged operation
 * runner in lib/product-operation.mjs; init publishes a fresh product root via
 * PID-stamped staging; check delegates to check-model.mjs plus the generated
 * freshness gates. Errors leave through writeCliError with a Next: action line.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { writeModelOverview } from "./generate-docs.mjs";
import { writeModelGraph } from "./generate-graph.mjs";
import { checkGeneratedDocs } from "./check-generated-docs.mjs";
import { checkGeneratedGraph } from "./check-generated-graph.mjs";
import {
  assertProductNotBusy,
  findLeftoverOperationState,
  generatedPaths,
  isProcessAlive,
  runProductOperation,
  validationFailureError,
} from "./lib/product-operation.mjs";
import { resolveContainedOutput } from "./lib/product-paths.mjs";
import { initStagingPrefix, resolveInitDestination, resolveProductRoot } from "./lib/product-root-resolver.mjs";
import { defaultConfigIgnore, findRepositoryRoot, loadDdduckConfig } from "./lib/ddduck-config.mjs";
import { installSkill } from "./lib/skill-installer.mjs";
import { runQuery } from "./query-model.mjs";
import { CliUsageError, parseCommandArgs, renderHelp, writeCliError } from "./lib/cli-contract.mjs";
import { buildAuthoringPlan } from "./lib/product-authoring.mjs";
import { parseYamlMapping } from "./lib/product-layout.mjs";
import { compareProductRoots, renderProductDiff } from "./lib/product-diff.mjs";

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const cliArgs = process.argv.slice(2);

try {
  run(cliArgs);
} catch (error) {
  writeCliError(error, { nextAction: nextActionFor(cliArgs) });
}

/**
 * Dispatch one parsed CLI invocation to its command handler.
 * @param {string[]} args - Raw CLI arguments (process.argv minus node and script).
 * @returns {void}
 */
function run(args) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(renderHelp());
    return;
  }
  const [command, ...commandArgs] = args;
  if (
    !command ||
    !["init", "check", "generate", "query", "diff", "install", "create", "move", "split", "retire"].includes(command)
  ) {
    throw new CliUsageError(`Unknown command ${command ?? "(missing)"}`);
  }
  if (commandArgs.includes("--help")) {
    process.stdout.write(renderHelp(command));
    return;
  }
  if (command === "init") {
    const { result, json } = initialize(commandArgs);
    writeProductOperationResult(result, json);
    return;
  }
  if (command === "check") {
    executeChecker(commandArgs);
    return;
  }
  if (command === "generate") {
    generate(commandArgs);
    return;
  }
  if (command === "query") {
    runQuery(commandArgs);
    return;
  }
  if (command === "diff") {
    const { options } = parseCommandArgs(commandArgs, {
      options: { base: { value: true }, root: { value: true }, json: { value: false } },
    });
    const base = requiredOption(options, "base", "diff requires --base <previous-product-root>");
    const root = resolveProductRoot({ explicitRoot: options.root });
    const report = compareProductRoots(path.resolve(base), root);
    process.stdout.write(`${options.json ? JSON.stringify(report) : renderProductDiff(report)}\n`);
    return;
  }
  if (command === "install") {
    install(commandArgs);
    return;
  }
  if (command === "create" && ["domain", "concept", "use-case"].includes(commandArgs[0])) {
    createNode(commandArgs);
    return;
  }
  if (["create", "move", "split", "retire"].includes(command)) {
    transitionGuarantee(command, commandArgs);
    return;
  }
}

/**
 * Implement `ddduck install skill update-ddduck-specs`: install the bundled
 * host skill adapter and .ddduck/agent-skills.lock.json into --repo.
 * @param {string[]} args - Arguments after the `install` command word.
 * @returns {void}
 */
function install(args) {
  const { positionals, options } = parseCommandArgs(args, {
    positionals: { min: 2, max: 2 },
    options: { repo: { value: true } },
  });
  const [kind, skillName] = positionals;
  if (kind !== "skill" || skillName !== "update-ddduck-specs") {
    throw new CliUsageError("install requires skill update-ddduck-specs");
  }
  const packageVersion = JSON.parse(readFileSync(path.join(frameworkRoot, "package.json"), "utf8")).version;
  const repository = path.resolve(options.repo ?? process.cwd());
  // A typo'd --repo must fail instead of silently manufacturing a directory
  // tree (and a lock) at the wrong path while the real repository gets nothing.
  if (!existsSync(repository) || !statSync(repository).isDirectory()) {
    throw new CliUsageError(`install requires an existing repository directory: ${repository}`, {
      nextAction: "Pass --repo <existing-repository-root> and retry.",
    });
  }
  const result = installSkill({
    repository,
    skillName,
    skillPath: path.join(frameworkRoot, "skills", skillName, "SKILL.md"),
    packageVersion,
  });
  const actionLabels = { create: "created", upgrade: "upgraded", "no-op": "no-op" };
  process.stdout.write(
    `install skill ${skillName} (${actionLabels[result.action]}) in ${repository}; canonical: ${result.canonicalPath}; lock: ${result.lockPath}\n`,
  );
}

/**
 * Implement `ddduck init`: build a new product root (canonical directories,
 * product.yaml, all generated views) in a PID-stamped staging directory beside
 * the destination, then publish it atomically via rename and write
 * .ddduck/config.json if absent.
 * @param {string[]} args - Arguments after the `init` command word.
 * @returns {{result: object, json: boolean}} The operation result and whether --json was requested.
 */
function initialize(args) {
  const { positionals, options } = parseCommandArgs(args, {
    positionals: { min: 0, max: 1 },
    options: { id: { value: true }, json: { value: false } },
  });
  const destination = resolveInitDestination({ explicitDestination: positionals[0] });
  const productId = requiredOption(options, "id", "init requires --id model:<product-id>");
  if (!/^model:[a-z0-9][a-z0-9-]*$/.test(productId)) {
    throw new Error(
      `Invalid product ID ${JSON.stringify(productId)}; expected model:<lowercase-slug> (for example model:library)`,
    );
  }

  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination) && readdirSync(destination).length > 0) {
    throw new Error(`Refusing to initialize non-empty directory ${destination}`);
  }

  // Stage names embed the destination so concurrent inits to sibling
  // destinations never sweep each other's live staging directories, and the
  // creating PID so concurrent inits to the SAME destination only sweep stages
  // whose creator is dead (mirroring the mutation lock's reclaim rule). Stages
  // without a parseable live PID are interrupted-init debris and get swept.
  const destinationStagePrefix = `${initStagingPrefix}${path.basename(destination)}-`;
  for (const entry of readdirSync(path.dirname(destination))) {
    if (!entry.startsWith(destinationStagePrefix)) continue;
    const stagePid = Number.parseInt(entry.slice(destinationStagePrefix.length).match(/^(\d+)-/)?.[1] ?? "", 10);
    if (Number.isInteger(stagePid) && stagePid > 0 && isProcessAlive(stagePid)) continue;
    rmSync(path.join(path.dirname(destination), entry), { recursive: true, force: true });
  }
  const stagingRoot = mkdtempSync(path.join(path.dirname(destination), `${destinationStagePrefix}${process.pid}-`));
  let config;
  try {
    for (const directory of ["domains", "concepts", "relationships", "use-cases", "interfaces", "guarantees"]) {
      mkdirSync(resolveContainedOutput(stagingRoot, path.join("model", directory)), { recursive: true });
    }
    mkdirSync(resolveContainedOutput(stagingRoot, "decisions"), { recursive: true });
    writeYaml(resolveContainedOutput(stagingRoot, "product.yaml"), {
      schemaVersion: "1",
      kind: "Model",
      id: productId,
      name: productId.slice("model:".length),
      purpose: "Define this product.",
      domains: [],
      useCases: [],
      decisions: [],
    });
    refreshDerivedOutput(stagingRoot);
    try {
      if (existsSync(destination)) rmdirSync(destination);
      renameSync(stagingRoot, destination);
    } catch (error) {
      // A concurrent init to the same destination can publish between the
      // emptiness check above and this rename; name the collision instead of
      // surfacing the raw filesystem error.
      if (error.code === "ENOTEMPTY" || error.code === "EEXIST") {
        throw new Error(
          `Refusing to initialize non-empty directory ${destination}; another init published it concurrently`,
        );
      }
      throw error;
    }
    try {
      config = writeConfigIfAbsent(destination);
    } catch (error) {
      // Writing the config is the final publish step. If it fails (for example a
      // regular file already occupies the .ddduck config path), roll back the
      // freshly published product directory so a corrected retry is not refused
      // by the non-empty-directory guard above.
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  if (!config.created) warnPinnedRepositoryDefault(config, destination);
  return {
    json: options.json,
    result: {
      operation: "init",
      root: realpathSync(destination),
      affectedIds: [productId],
      canonicalPaths: ["product.yaml"],
      generatedPaths: [...generatedPaths],
      ...(config.created ? { configPath: config.configPath } : {}),
    },
  };
}

// A pre-existing repository config keeps selecting its own product root; a
// second init must say so or every rootless command silently addresses the
// other product.
function warnPinnedRepositoryDefault(config, destination) {
  let configuredRoot;
  try {
    const loaded = loadDdduckConfig(config.repositoryRoot);
    if (!loaded) return;
    configuredRoot = path.resolve(config.repositoryRoot, loaded.productRoot);
  } catch {
    return; // An unreadable config surfaces on the next root resolution.
  }
  if (canonicalPath(configuredRoot) === canonicalPath(destination)) return;
  process.stderr.write(
    `init: ${config.configPath} still selects ${configuredRoot} as the repository default root; pass --root or update the config to select ${path.resolve(destination)}.\n`,
  );
}

function canonicalPath(candidate) {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

/**
 * Implement `ddduck check`: run check-model.mjs in a child process against the
 * resolved root, then gate generated-view freshness (docs, graph JSON/NDJSON,
 * and the SVG via a subprocess because rendering is async WASM) and refuse
 * leftover interrupted-operation state. Busy roots exit 2 via ProductBusyError.
 * @param {string[]} args - Arguments after the `check` command word.
 * @returns {void}
 */
function executeChecker(args) {
  const { options } = parseCommandArgs(args, {
    options: {
      root: { value: true },
      base: { value: true },
      "docs-root": { value: true, repeatable: true },
      "source-only": { value: false },
    },
  });
  const root = resolveProductRoot({ explicitRoot: options.root });
  // Name the validated root when it was resolved implicitly, so a config-pinned
  // root can never be validated invisibly. stderr keeps stdout script-safe.
  if (!options.root) {
    process.stderr.write(`check: validating ${root} (root resolved automatically; pass --root to override)\n`);
  }
  assertProductNotBusy(root);
  const checkerArgs = [path.join(frameworkRoot, "scripts", "check-model.mjs"), "--root", root];
  if (options.base) checkerArgs.push("--base", path.resolve(options.base));
  for (const docsRoot of options["docs-root"]) checkerArgs.push("--docs-root", path.resolve(docsRoot));
  if (options["source-only"]) checkerArgs.push("--source-only");
  const result = spawnSync(process.execPath, checkerArgs, {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Failed to run the model checker for ${root}: ${result.error.message}`);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim();
    if (!diagnostic) throw new CliUsageError(`Validation failed for ${root}`);
    throw validationFailureError(root, diagnostic.split("\n"));
  }
  if (options["source-only"]) return;
  try {
    checkGeneratedDocs(root);
    checkGeneratedGraph(root);
  } catch (error) {
    throw new CliUsageError(`Validation failed for ${root}: ${error.message}`, {
      nextAction: `Run ddduck generate --root ${root}, then re-run ddduck check.`,
    });
  }
  // The SVG check runs in a child process because rendering is async (WASM).
  const svgCheck = spawnSync(
    process.execPath,
    [path.join(frameworkRoot, "scripts", "check-generated-graph-svg.mjs"), "--root", root],
    { encoding: "utf8" },
  );
  if (svgCheck.error) {
    // The child never started (e.g. EMFILE/ENOMEM); this is not a stale artifact.
    throw new Error(`Failed to run the model graph SVG check for ${root}: ${svgCheck.error.message}`);
  }
  if (svgCheck.status !== 0) {
    // The standalone gate prints its own regenerate remedy; strip it here so
    // the remedy appears exactly once, in the Next: line below.
    const diagnostic =
      (svgCheck.stderr || "").trim().replace(/; run ddduck generate --root [^\n]*/g, "") ||
      "generated/graph/model-graph.svg is missing or stale";
    throw new CliUsageError(`Validation failed for ${root}: ${diagnostic}`, {
      nextAction: `Run ddduck generate --root ${root}, then re-run ddduck check.`,
    });
  }
  const leftover = findLeftoverOperationState(root);
  if (leftover) {
    throw new CliUsageError(
      `Validation failed for ${root}: an interrupted ddduck operation left ${leftover.entries.join(", ")}`,
      {
        nextAction: `Run ddduck generate --root ${root} to reclaim the interrupted operation state, then re-run ddduck check.`,
      },
    );
  }
}

/**
 * Implement `ddduck generate`: refresh every generated view through the locked
 * staged operation runner with an empty (no canonical replacement) plan.
 * @param {string[]} args - Arguments after the `generate` command word.
 * @returns {void}
 */
function generate(args) {
  const { options } = parseCommandArgs(args, { options: { root: { value: true }, json: { value: false } } });
  const root = resolveProductRoot({ explicitRoot: options.root });
  const result = runProductOperation({
    root,
    transform: () => ({ operation: "generate", affectedIds: [], replacements: [] }),
  });
  writeProductOperationResult(result, options.json);
}

function createNode(args) {
  const kind = args[0];
  const shared = { root: { value: true }, json: { value: false } };
  const fields =
    kind === "use-case"
      ? { file: { value: true } }
      : {
          id: { value: true },
          name: { value: true },
          purpose: { value: true },
          ...(kind === "concept" ? { owner: { value: true } } : {}),
        };
  const { options } = parseCommandArgs(args, {
    positionals: { min: 1, max: 1 },
    options: { ...shared, ...fields },
  });
  const required = (field) => requiredOption(options, field, `create ${kind} requires --${field} <value>`);
  const request =
    kind === "use-case"
      ? { kind: "UseCase", node: parseYamlMapping(path.resolve(required("file"))) }
      : {
          kind: kind === "domain" ? "Domain" : "Concept",
          id: required("id"),
          name: required("name"),
          purpose: required("purpose"),
          ...(kind === "concept" ? { ownerDomain: required("owner") } : {}),
        };
  const root = resolveProductRoot({ explicitRoot: options.root });
  const result = runProductOperation({ root, transform: (snapshot) => buildAuthoringPlan(snapshot, request) });
  writeProductOperationResult(result, options.json);
}

/**
 * Implement the guarantee lifecycle commands create, move, split, and retire:
 * parse per-command options, require a registered decision for split/retire,
 * and run the resulting plan through the staged operation runner.
 * @param {"create"|"move"|"split"|"retire"} command - Lifecycle command name.
 * @param {string[]} args - Arguments after the command word.
 * @returns {void}
 */
function transitionGuarantee(command, args) {
  const optionDefinitions = {
    create: {
      origin: { value: true },
      classification: { value: true },
      owner: { value: true },
      statement: { value: true },
      root: { value: true },
      json: { value: false },
    },
    move: { to: { value: true }, root: { value: true }, json: { value: false } },
    split: { into: { value: true }, decision: { value: true }, root: { value: true }, json: { value: false } },
    retire: { decision: { value: true }, root: { value: true }, json: { value: false } },
  };
  const positionalSyntax = {
    create:
      "ddduck create guarantee --origin <origin> --classification <invariant|acceptance-criterion> --owner <domain-id> --statement <text>",
    move: "ddduck move guarantee <guarantee-id> --to <domain-id>",
    split: "ddduck split guarantee <guarantee-id> --into <successor-id,successor-id> --decision ADR-NNN",
    retire: "ddduck retire guarantee <guarantee-id> --decision ADR-NNN",
  };
  const { positionals, options } = parseCommandArgs(args, {
    positionals: {
      min: command === "create" ? 1 : 2,
      max: command === "create" ? 1 : 2,
      syntax: positionalSyntax[command],
    },
    options: optionDefinitions[command],
  });
  const [kind, id] = positionals;
  if (kind !== "guarantee") throw new Error(`${command} requires the entity kind guarantee`);
  const root = resolveProductRoot({ explicitRoot: options.root });
  if (command === "split" || command === "retire") {
    requireRegisteredDecision(root, requiredDecision(options, command), command);
  }
  const result = runProductOperation({
    root,
    transform: (snapshot) => buildGuaranteePlan(command, snapshot, id, options),
  });
  writeProductOperationResult(result, options.json);
}

function requireRegisteredDecision(root, decision, command) {
  let files;
  try {
    files = readdirSync(path.join(root, "decisions"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    files = [];
  }
  if (files.some((file) => file.startsWith(`${decision}-`) && file.endsWith(".md"))) return;
  throw new CliUsageError(
    `${command} requires a registered decision ${decision}: no decisions/${decision}-*.md found in ${root}`,
    {
      nextAction: `Create ${path.join(root, "decisions", `${decision}-<slug>.md`)} recording the decision, then retry.`,
    },
  );
}

/**
 * Print an operation result as one text line or one JSON object (--json).
 * @param {{operation: string, root: string, affectedIds: string[], canonicalPaths: string[], generatedPaths: string[], configPath?: string}} result - Result from the operation runner or init.
 * @param {boolean} json - Emit JSON instead of the text form.
 * @returns {void}
 */
function writeProductOperationResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const affected = result.affectedIds.length > 0 ? ` ${result.affectedIds.join(", ")}` : "";
  const canonical = result.canonicalPaths.length > 0 ? result.canonicalPaths.join(", ") : "none";
  const config = result.configPath ? `; config: ${result.configPath} (created)` : "";
  process.stdout.write(
    `${result.operation}${affected} in ${result.root}; canonical: ${canonical}; generated: ${result.generatedPaths.join(", ")}${config}\n`,
  );
}

/**
 * Build the operation plan for one guarantee lifecycle command from a frozen
 * product snapshot; move/split/retire require the source guarantee to be active.
 * @param {"create"|"move"|"split"|"retire"} command - Lifecycle command name.
 * @param {{nodes: object[], canonicalPaths: Record<string, string>}} snapshot - Frozen staged product snapshot.
 * @param {string|undefined} id - Target guarantee ID (absent for create).
 * @param {Record<string, string|boolean>} options - Parsed command options.
 * @returns {{operation: string, affectedIds: string[], replacements: {path: string, value: object}[]}} Plan for the operation runner.
 */
function buildGuaranteePlan(command, snapshot, id, options) {
  if (command === "create") return createGuarantee(snapshot, options);
  const guarantee = requireGuarantee(snapshot, id);
  if (guarantee.status !== "active") {
    throw new Error(`${command} requires an active guarantee; ${id} is ${guarantee.status}`);
  }
  if (command === "move") {
    return moveGuarantee(snapshot, guarantee, requiredOption(options, "to", "move requires --to domain:<id>"));
  }
  if (command === "split") {
    return splitGuarantee(
      snapshot,
      guarantee,
      requiredOption(options, "into", "split requires --into <id,id>"),
      requiredDecision(options, "split"),
    );
  }
  return retireGuarantee(snapshot, guarantee, requiredDecision(options, "retire"));
}

function createGuarantee(snapshot, options) {
  const origin = requiredOption(options, "origin", "create guarantee requires --origin <origin>").toUpperCase();
  const classification = requiredOption(
    options,
    "classification",
    "create guarantee requires --classification invariant|acceptance-criterion",
  );
  const ownerDomain = requiredOption(options, "owner", "create guarantee requires --owner domain:<id>");
  const statement = requiredOption(options, "statement", "create guarantee requires --statement <text>");
  if (!/^[A-Z][A-Z0-9-]+$/.test(origin)) {
    throw new Error(
      `Invalid guarantee origin ${JSON.stringify(origin)}; --origin requires two or more characters matching [A-Z][A-Z0-9-]+`,
    );
  }
  const classificationPrefix =
    classification === "invariant" ? "INV" : classification === "acceptance-criterion" ? "AC" : null;
  if (!classificationPrefix) throw new Error(`Invalid guarantee classification ${JSON.stringify(classification)}`);
  requireDomain(snapshot, ownerDomain);

  const prefix = `${origin}-${classificationPrefix}-`;
  const serial =
    Math.max(
      0,
      ...snapshot.nodes.flatMap(({ id }) => {
        const match = id.match(new RegExp(`^${prefix}(\\d+)$`));
        return match ? [Number(match[1])] : [];
      }),
    ) + 1;
  const id = `${prefix}${String(serial).padStart(2, "0")}`;
  const fileName = `${id.toLowerCase()}.yaml`;
  const model = requireModel(snapshot);
  const guarantee = {
    schemaVersion: "1",
    kind: "Guarantee",
    id,
    model: model.id,
    ownerDomain,
    classification,
    statement,
    status: "active",
  };
  return {
    operation: "create guarantee",
    affectedIds: [id],
    replacements: [
      { path: `model/guarantees/${fileName}`, value: guarantee },
      updateDomainGuarantees(snapshot, ownerDomain, (ids) => [...ids, id]),
    ],
  };
}

function moveGuarantee(snapshot, guarantee, destinationDomain) {
  requireDomain(snapshot, destinationDomain);
  if (guarantee.ownerDomain === destinationDomain)
    throw new Error(`${guarantee.id} is already owned by ${destinationDomain}`);
  const previousOwner = guarantee.ownerDomain;
  // ownershipHistory lists former owning Domains only (model-reference.md), so
  // an owner that regains the guarantee leaves the history again.
  const updated = {
    ...guarantee,
    ownerDomain: destinationDomain,
    ownershipHistory: [...new Set([...(guarantee.ownershipHistory ?? []), previousOwner])].filter(
      (domainId) => domainId !== destinationDomain,
    ),
  };
  return {
    operation: "move guarantee",
    affectedIds: [guarantee.id],
    replacements: [
      { path: snapshot.canonicalPaths[guarantee.id], value: updated },
      updateDomainGuarantees(snapshot, previousOwner, (ids) => ids.filter((id) => id !== guarantee.id)),
      updateDomainGuarantees(snapshot, destinationDomain, (ids) => [...ids, guarantee.id]),
    ],
  };
}

function splitGuarantee(snapshot, guarantee, into, lifecycleDecision) {
  const successors = into
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (successors.length === 0 || new Set(successors).size !== successors.length) {
    throw new Error("split requires one or more distinct successor guarantee IDs");
  }
  for (const successorId of successors) {
    if (successorId === guarantee.id) throw new Error("split successor cannot be the source guarantee");
    const successor = requireGuarantee(snapshot, successorId);
    if (successor.status !== "active") throw new Error(`split successor must be active: ${successorId}`);
  }
  return {
    operation: "split guarantee",
    affectedIds: [guarantee.id, ...successors],
    replacements: [
      {
        path: snapshot.canonicalPaths[guarantee.id],
        value: { ...guarantee, status: "split", successors, lifecycleDecision },
      },
    ],
  };
}

function retireGuarantee(snapshot, guarantee, lifecycleDecision) {
  return {
    operation: "retire guarantee",
    affectedIds: [guarantee.id],
    replacements: [
      {
        path: snapshot.canonicalPaths[guarantee.id],
        value: { ...guarantee, status: "retired", lifecycleDecision },
      },
    ],
  };
}

function updateDomainGuarantees(snapshot, domainId, update) {
  const domain = requireDomain(snapshot, domainId);
  return {
    path: snapshot.canonicalPaths[domainId],
    value: { ...domain, guarantees: update(domain.guarantees ?? []) },
  };
}

function requireModel(snapshot) {
  const models = snapshot.nodes.filter((node) => node.kind === "Model");
  if (models.length !== 1) throw new Error(`Expected one Model node, found ${models.length}`);
  return models[0];
}

function requireGuarantee(snapshot, id) {
  const node = snapshot.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== "Guarantee") throw new Error(`Unknown guarantee ${id}`);
  return node;
}

function requireDomain(snapshot, id) {
  const node = snapshot.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== "Domain") {
    const known = snapshot.nodes
      .filter((candidate) => candidate.kind === "Domain")
      .map((candidate) => candidate.id)
      .sort();
    throw new Error(
      `Unknown domain ${id}; domain IDs use the domain: prefix${known.length > 0 ? `; known domains: ${known.join(", ")}` : ""}`,
    );
  }
  return node;
}

function requiredOption(options, name, message) {
  if (!options[name]) throw new Error(message);
  return options[name];
}

function requiredDecision(options, command) {
  const decision = requiredOption(options, "decision", `${command} requires --decision ADR-NNN`);
  if (!/^ADR-[0-9]{3}$/.test(decision)) throw new Error(`${command} requires --decision ADR-NNN`);
  return decision;
}

function refreshDerivedOutput(root) {
  writeModelOverview(root);
  writeModelGraph(root);
  renderModelGraphSvg(root);
}

// Render the canonical SVG via a child process (the WASM renderer is async;
// this keeps the init path synchronous, mirroring the operation runner).
function renderModelGraphSvg(root) {
  const result = spawnSync(
    process.execPath,
    [path.join(frameworkRoot, "scripts", "generate-graph-svg.mjs"), "--root", root],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to render the model graph SVG: ${(result.stderr || result.error?.message || "").trim()}`);
  }
}

function writeYaml(filePath, value) {
  writeFileSync(filePath, stringify(value));
}

/**
 * Write .ddduck/config.json at the repository root selecting the new product
 * root, unless a config already exists (then it is left untouched).
 * @param {string} destination - Absolute path of the freshly published product root.
 * @returns {{configPath: string, repositoryRoot: string, created: boolean}} Where the config lives and whether it was created.
 */
function writeConfigIfAbsent(destination) {
  const repositoryRoot = findRepositoryRoot(destination);
  const configPath = path.join(repositoryRoot, ".ddduck", "config.json");
  if (existsSync(configPath)) return { configPath, repositoryRoot, created: false };
  const relativeProductRoot = path.relative(repositoryRoot, destination).split(path.sep).join("/");
  // findRepositoryRoot falls back to the destination itself when no enclosing
  // .git exists, which makes the relative path empty; "." keeps productRoot
  // a valid non-empty string that still resolves to the same directory.
  const productRoot = relativeProductRoot === "" ? "." : relativeProductRoot;
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({ schemaVersion: "1", productRoot, ignore: [...defaultConfigIgnore] }, null, 2)}\n`,
  );
  return { configPath, repositoryRoot, created: true };
}

function nextActionFor(args) {
  const command = args[0];
  if (["init", "check", "generate", "query", "install", "create", "move", "split", "retire"].includes(command)) {
    return `Run ddduck ${command} --help, correct the input, and retry.`;
  }
  return "Run ddduck --help, choose a command, and retry.";
}
