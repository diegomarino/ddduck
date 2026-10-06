import { URL } from "node:url";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  archifyPin,
  inspectRuntime,
  installRuntime,
  acquireArchifyLock,
  captureArchifyDestination,
  assertArchifyDestinationUnchanged,
} from "./archify-install.mjs";
import { findRepositoryRoot } from "./ddduck-config.mjs";
import { resolveProductRoot } from "./product-root-resolver.mjs";
import { resolveContainedOutput } from "./product-paths.mjs";
import { CliUsageError, parseCommandArgs } from "./cli-contract.mjs";
import { assertProductNotBusy, findLeftoverOperationState, validationFailureError } from "./product-operation.mjs";
import { validateProduct } from "../check-model.mjs";
import { buildModelGraphOutputs } from "../generate-graph.mjs";

export async function runArchifyCommand(command, args) {
  const { positionals, options } = parseCommandArgs(args, {
    positionals: { min: 1, max: 1 },
    options:
      command === "install"
        ? { repo: { value: true }, yes: { value: false }, version: { value: true } }
        : command === "doctor"
          ? { repo: { value: true }, json: { value: false } }
          : { root: { value: true }, out: { value: true }, open: { value: false }, json: { value: false } },
  });
  if (positionals[0] !== "archify") throw new CliUsageError(`${command} requires the subject archify`);
  const repository = options.repo ? path.resolve(options.repo) : findRepositoryRoot();
  if (!existsSync(repository) || !statSync(repository).isDirectory())
    throw new CliUsageError(`Not an existing repository directory: ${repository}`);
  const nextAction = `Run ddduck install archify --repo ${JSON.stringify(repository)} --yes.`;
  if (command === "install") {
    if (options.version && options.version !== archifyPin.integrationVersion) {
      throw new CliUsageError(
        `Unsupported integration version ${options.version}; this ddduck qualifies ${archifyPin.integrationVersion}`,
      );
    }
    const current = inspectRuntime(repository);
    if (current.status !== "ready" && !options.yes) {
      process.stdout.write(
        `Install Archify ${archifyPin.integrationVersion} (${archifyPin.commit}) in ${repository}? [y/n] `,
      );
      const byte = Buffer.alloc(1);
      let answer = "";
      while (readSync(0, byte, 0, 1, null)) {
        const char = byte.toString();
        if (char === "\n" || char === "\r") break;
        answer += char;
      }
      if (answer.trim().toLowerCase() !== "y")
        throw new CliUsageError("Archify installation declined; nothing installed", { nextAction });
    }
    const installed = await installRuntime(repository);
    if (installed.status !== "ready") throw new Error(`Archify installation verification failed: ${installed.status}`);
    process.stdout.write(
      `Archify ${installed.integrationVersion} ready (${installed.commit}).\nRun from ${repository}:\nNext: ddduck export archify --open\n`,
    );
    return;
  }
  const status = inspectRuntime(repository);
  if (command === "doctor") {
    process.stdout.write(
      options.json
        ? `${JSON.stringify({ ...status, repository, ...(status.status === "ready" ? {} : { nextAction }) })}\n`
        : `Archify: ${status.status}; integration ${status.integrationVersion}; upstream ${status.upstreamVersion} (${status.commit}).${status.reason ? ` ${status.reason}` : ""}\n${status.status === "ready" ? "" : `Next: ${nextAction}\n`}`,
    );
    if (status.status !== "ready") process.exitCode = 1;
    return;
  }
  if (status.status !== "ready")
    throw new CliUsageError(`Archify runtime is ${status.status}${status.reason ? `: ${status.reason}` : ""}`, {
      nextAction,
    });
  const root = resolveProductRoot({ explicitRoot: options.root });
  const result = exportAtlas(root, repository, status.runtime, options.out);
  process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `Archify atlas: ${result.index}\n`);
  if (options.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
    const openArgs =
      process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", pathToFileURL(result.index).href]
        : [pathToFileURL(result.index).href];
    const opened = spawnSync(opener, openArgs, { encoding: "utf8" });
    if (opened.error || opened.status !== 0)
      throw new Error(
        `Atlas generated at ${result.index}, but browser opening failed: ${opened.error?.message ?? opened.stderr}`,
      );
  }
}

function exportAtlas(root, repository, runtime, requestedOutput) {
  assertProductNotBusy(root);
  if (findLeftoverOperationState(root))
    throw new Error("Product has interrupted operation state; run ddduck check before exporting");
  const check = validateProduct(root, { sourceOnly: true });
  if (check.errors.length) throw validationFailureError(root, check.errors);
  const output = resolveContainedOutput(
    repository,
    path.relative(
      repository,
      requestedOutput ? path.resolve(requestedOutput) : path.join(root, ".ddduck/exports/archify"),
    ),
  );
  if (existsSync(output)) {
    const manifest = resolveContainedOutput(repository, path.relative(repository, path.join(output, "manifest.json")));
    if (
      !existsSync(manifest) ||
      JSON.parse(readFileSync(manifest, "utf8")).integration?.integrationVersion !== archifyPin.integrationVersion
    ) {
      throw new Error(`Refusing to replace unmanaged atlas directory: ${output}`);
    }
  }
  const captured = captureArchifyDestination(output, "manifest.json");
  mkdirSync(path.dirname(output), { recursive: true });
  const lock = resolveContainedOutput(repository, path.relative(repository, `${output}.lock`));
  acquireArchifyLock(lock);
  let stage;
  let committed = false;
  try {
    stage = mkdtempSync(path.join(path.dirname(output), ".archify-export-"));
    const candidate = path.join(stage, "atlas");
    mkdirSync(candidate);
    const source = path.join(candidate, "model-graph.json");
    writeFileSync(source, buildModelGraphOutputs(root).json);
    const renderer = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./archify-export.mjs", import.meta.url)), source, candidate, runtime],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (renderer.error || renderer.status !== 0)
      throw new Error(`Archify rendering failed: ${renderer.error?.message ?? renderer.stderr}`);
    const manifestPath = path.join(candidate, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.source = path.join(output, "model-graph.json");
    manifest.integration = {
      integrationVersion: archifyPin.integrationVersion,
      upstreamVersion: archifyPin.upstreamVersion,
      commit: archifyPin.commit,
    };
    manifest.ddduckVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    resolveContainedOutput(repository, path.relative(repository, output));
    assertArchifyDestinationUnchanged(output, "manifest.json", captured);
    const backup = path.join(stage, "previous");
    const previous = existsSync(output);
    if (previous) renameSync(output, backup);
    try {
      renameSync(candidate, output);
    } catch (error) {
      if (previous) renameSync(backup, output);
      throw error;
    }
    committed = true;
    return { root, output, index: path.join(output, "index.html"), integration: manifest.integration };
  } finally {
    // Preserve recovery bytes if a failed rollback leaves the backup in staging.
    if (stage && (committed || !existsSync(path.join(stage, "previous"))))
      rmSync(stage, { recursive: true, force: true });
    rmSync(lock);
  }
}
