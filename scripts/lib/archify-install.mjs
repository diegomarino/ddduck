import { URL } from "node:url";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveContainedOutput } from "./product-paths.mjs";

export const archifyPin = JSON.parse(readFileSync(new URL("./archify-pin.json", import.meta.url), "utf8"));
const installationPath = ".ddduck/tools/archify";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function captureArchifyDestination(directory, marker) {
  let metadata;
  try {
    metadata = lstatSync(directory, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  const receipt = path.join(directory, marker);
  return (
    [metadata.dev, metadata.ino, metadata.mtimeNs, metadata.ctimeNs].map(String).join(":") +
    ":" +
    (existsSync(receipt) ? digest(readFileSync(receipt)) : "unmanaged")
  );
}

export function assertArchifyDestinationUnchanged(directory, marker, captured) {
  if (captureArchifyDestination(directory, marker) !== captured)
    throw new Error(`Archify destination changed during operation; preserving it: ${directory}`);
}

export function acquireArchifyLock(lock) {
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const text = readFileSync(lock, "utf8").trim();
    const owner = /^\d+$/.test(text) ? text : "unknown";
    // ponytail: manual recovery for interrupted trials; reclaim dead-owner locks for a stable release.
    const blocked = new Error(`Archify operation lock exists (PID ${owner}): ${lock}`);
    blocked.nextAction = `Confirm its owner has exited, preserve staging/recovery directories, then remove only ${JSON.stringify(lock)} and retry.`;
    throw blocked;
  }
}

export function inspectRuntime(repository, pin = archifyPin) {
  const result = {
    status: "missing",
    integrationVersion: pin.integrationVersion,
    upstreamVersion: pin.upstreamVersion,
    commit: pin.commit,
  };
  try {
    const installation = resolveContainedOutput(repository, installationPath);
    result.runtime = path.join(installation, "runtime");
    if (!existsSync(installation)) return result;
    const receipt = resolveContainedOutput(repository, `${installationPath}/lock.json`);
    if (!existsSync(receipt)) return { ...result, status: "unmanaged" };
    const installed = JSON.parse(readFileSync(receipt, "utf8"));
    if (JSON.stringify(installed) !== JSON.stringify(pin)) return { ...result, status: "incompatible" };
    for (const [file, hash] of Object.entries(pin.files)) {
      const candidate = resolveContainedOutput(repository, `${installationPath}/runtime/${file}`);
      if (digest(readFileSync(candidate)) !== hash) throw new Error(`Integrity mismatch: ${file}`);
    }
    return { ...result, status: "ready" };
  } catch (error) {
    return { ...result, status: "corrupt", reason: error.message };
  }
}

async function download(file, pin) {
  const response = await globalThis.fetch(
    `https://raw.githubusercontent.com/tt-a1i/archify/${pin.commit}/archify/${file}`,
    { signal: globalThis.AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`Archify download failed: ${file} (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function installRuntime(repository, pin = archifyPin, fetchFile = download) {
  const initial = inspectRuntime(repository, pin);
  if (initial.status === "ready") return initial;
  const installation = resolveContainedOutput(repository, installationPath);
  if (existsSync(installation)) {
    const receipt = resolveContainedOutput(repository, `${installationPath}/lock.json`);
    if (!existsSync(receipt) || JSON.stringify(JSON.parse(readFileSync(receipt, "utf8"))) !== JSON.stringify(pin)) {
      throw new Error("Refusing to replace an unmanaged or incompatible Archify installation");
    }
  }
  const captured = captureArchifyDestination(installation, "lock.json");
  const parent = path.dirname(installation);
  mkdirSync(parent, { recursive: true });
  const lock = resolveContainedOutput(repository, ".ddduck/tools/.archify-install.lock");
  acquireArchifyLock(lock);
  let stage;
  let committed = false;
  try {
    stage = mkdtempSync(path.join(parent, ".archify-stage-"));
    const candidate = path.join(stage, "candidate");
    mkdirSync(candidate);
    // Only pinned source is downloaded. No package installation hooks are run.
    for (const [file, hash] of Object.entries(pin.files)) {
      const bytes = await fetchFile(file, pin);
      if (digest(bytes) !== hash) throw new Error(`Archify integrity mismatch: ${file}`);
      const target = resolveContainedOutput(candidate, `runtime/${file}`);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    writeFileSync(path.join(candidate, "lock.json"), `${JSON.stringify(pin, null, 2)}\n`);
    resolveContainedOutput(repository, installationPath);
    assertArchifyDestinationUnchanged(installation, "lock.json", captured);
    const backup = path.join(stage, "previous");
    const previous = existsSync(installation);
    if (previous) renameSync(installation, backup);
    try {
      renameSync(candidate, installation);
    } catch (error) {
      if (previous) renameSync(backup, installation);
      throw error;
    }
    committed = true;
    return inspectRuntime(repository, pin);
  } finally {
    if (stage && (committed || !existsSync(path.join(stage, "previous"))))
      rmSync(stage, { recursive: true, force: true });
    rmSync(lock);
  }
}
