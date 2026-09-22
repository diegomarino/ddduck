/**
 * Installer for the bundled update-ddduck-specs agent skill, behind `ddduck
 * install skill`. Selects a host topology from the repository state (codex
 * .agents/, claude-code .claude/, or shared via symlink), plans create,
 * upgrade, or no-op against the canonical skill bundle and the
 * .ddduck/agent-skills.lock.json lock, and applies the plan with atomic
 * writes plus rollback of everything touched on failure. Conflicting host
 * state or a locally modified managed bundle refuses with a nextAction
 * naming the exact path to resolve.
 */

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const lockSchemaVersion = 2;
const lockRelativePath = path.join(".ddduck", "agent-skills.lock.json");

const defaultOperations = {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
};

const codexSkillDirectory = path.join(".agents", "skills", "update-ddduck-specs");
const claudeSkillDirectory = path.join(".claude", "skills", "update-ddduck-specs");
const skillFileName = "SKILL.md";

const hostSkillAdapters = {
  codex: {
    host: "codex",
    relativePath: codexSkillDirectory,
    lockEntry() {
      return { host: this.host, path: ".agents/skills/update-ddduck-specs" };
    },
    parentPaths(adapterPath) {
      return [path.dirname(path.dirname(adapterPath)), path.dirname(adapterPath)];
    },
    inspect({ adapterPath, operations }) {
      const state = pathState(adapterPath, operations);
      if (state.type === "absent") return "absent";
      return state.type === "directory" ? "valid" : "conflict";
    },
    materialize({ adapterPath, operations, touched }) {
      touched.push(adapterPath);
      operations.mkdirSync(adapterPath, { recursive: true });
    },
  },
  claudeDirectory: {
    host: "claude-code",
    relativePath: claudeSkillDirectory,
    lockEntry() {
      return { host: this.host, path: ".claude/skills/update-ddduck-specs" };
    },
    parentPaths(adapterPath) {
      return [path.dirname(path.dirname(adapterPath)), path.dirname(adapterPath)];
    },
    inspect({ adapterPath, operations }) {
      const state = pathState(adapterPath, operations);
      if (state.type === "absent") return "absent";
      return state.type === "directory" ? "valid" : "conflict";
    },
    materialize({ adapterPath, operations, touched }) {
      touched.push(adapterPath);
      operations.mkdirSync(adapterPath, { recursive: true });
    },
  },
  claudeSymlink: {
    host: "claude-code",
    relativePath: claudeSkillDirectory,
    target: "../../.agents/skills/update-ddduck-specs",
    lockEntry() {
      return { host: this.host, path: ".claude/skills/update-ddduck-specs", target: this.target };
    },
    parentPaths(adapterPath) {
      return [path.dirname(path.dirname(adapterPath)), path.dirname(adapterPath)];
    },
    inspect({ adapterPath, operations }) {
      const state = pathState(adapterPath, operations);
      if (state.type === "absent") return "absent";
      if (state.type !== "symlink" || operations.readlinkSync(adapterPath) !== this.target) return "conflict";
      return pathState(path.join(adapterPath, skillFileName), operations).type === "file" ? "valid" : "conflict";
    },
    materialize({ adapterPath, operations, touched }) {
      touched.push(path.dirname(adapterPath), adapterPath);
      operations.mkdirSync(path.dirname(adapterPath), { recursive: true });
      operations.symlinkSync(this.target, adapterPath);
    },
  },
};

const installTopologies = [
  {
    id: "codex",
    canonicalRelativePath: path.join(codexSkillDirectory, skillFileName),
    adapters: [hostSkillAdapters.codex],
  },
  {
    id: "claude-code",
    canonicalRelativePath: path.join(claudeSkillDirectory, skillFileName),
    adapters: [hostSkillAdapters.claudeDirectory],
  },
  {
    id: "shared",
    canonicalRelativePath: path.join(codexSkillDirectory, skillFileName),
    adapters: [hostSkillAdapters.codex, hostSkillAdapters.claudeSymlink],
  },
];

/**
 * Install (or upgrade) the bundled skill into a repository: load, plan, apply.
 * @param {{repository: string, skillName: string, skillPath: string, packageVersion: string, operations?: object}} options - Repository root, skill identity, bundled asset path, and ddduck version for the lock.
 * @returns {{action: "create"|"upgrade"|"no-op", skillSha256: string, bundleSha256: string, canonicalPath: string, lockPath: string}} The installation result.
 */
export function installSkill(options) {
  const bundle = loadSkillBundle(options);
  const plan = planSkillInstall({ ...options, bundle });
  return applySkillInstall({ ...options, bundle, plan });
}

/**
 * Read the bundled skill directory and compute per-file and bundle digests.
 * @param {{skillName: string, skillPath: string, operations?: object}} options - Skill name, SKILL.md path, and fs overrides for tests.
 * @returns {{name: string, files: {path: string, bytes: Buffer, sha256: string}[], skillSha256: string, bundleSha256: string, sha256: string}} The loaded bundle.
 */
export function loadSkillBundle({ skillName, skillPath, operations = {} }) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  if (pathState(skillPath, resolvedOperations).type !== "file") {
    throw new Error(`Missing bundled skill asset: ${skillPath}`);
  }
  const files = readBundleFiles(path.dirname(skillPath), resolvedOperations);
  const skill = files.find(({ path: relativePath }) => relativePath === skillFileName);
  if (!skill) throw new Error(`Missing bundled skill asset: ${skillPath}`);
  const bundleSha256 = files.length === 1 ? skill.sha256 : digestBundle(files);
  return {
    name: skillName,
    files,
    skillSha256: skill.sha256,
    bundleSha256,
    // Preserve the internal single-file field while older callers migrate.
    sha256: skill.sha256,
  };
}

/**
 * Inspect the repository's lock, canonical file, and host adapters and decide
 * the action: create, upgrade, or no-op — or throw on conflicting host state,
 * an incomplete lock, or a locally modified canonical skill.
 * @param {{repository: string, skillName: string, bundle: object, operations?: object}} options - Repository root, skill name, loaded bundle, and fs overrides.
 * @returns {{action: string, paths: object, topology: object, adaptersToMaterialize: object[], writeBundle: boolean, staleFiles: string[]}} The install plan for applySkillInstall.
 */
export function planSkillInstall({ repository, skillName, bundle, operations = {} }) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  const root = path.resolve(repository);
  const lockPath = path.join(root, lockRelativePath);
  const lockState = readLock(lockPath, resolvedOperations);
  const topology = selectTopology({ root, lockState, operations: resolvedOperations });
  const paths = installationPaths(root, topology);
  assertDirectoryParents(paths, topology, resolvedOperations);
  const canonical = pathState(paths.canonical, resolvedOperations);
  const adapters = inspectHostAdapters(paths, topology, resolvedOperations);
  const conflictingAdapter = adapters.find(({ state }) => state === "conflict");

  if (lockState.type === "invalid") throw incompleteLock(paths.lock);
  if (conflictingAdapter) throw conflictingHostAdapter(conflictingAdapter, paths);

  if (lockState.type === "absent") {
    const canonicalDirectory = pathState(paths.canonicalDirectory, resolvedOperations);
    if (
      canonicalDirectory.type === "directory" &&
      canonical.type === "absent" &&
      resolvedOperations.readdirSync(paths.canonicalDirectory).length > 0
    ) {
      throw conflictingHostState(
        `Conflicting canonical skill directory: ${paths.canonicalDirectory}`,
        paths.canonicalDirectory,
      );
    }
    if (canonical.type === "absent") {
      return createPlan({ paths, adapters, writeBundle: true });
    }
    if (
      canonical.type !== "file" ||
      sha256(resolvedOperations.readFileSync(paths.canonical)) !== bundle.skillSha256 ||
      bundle.files.length !== 1
    ) {
      throw conflictingHostState(`Conflicting canonical skill destination: ${paths.canonical}`, paths.canonical);
    }
    return createPlan({ paths, adapters, writeBundle: false });
  }

  const lock = lockState.value;
  if (!isValidLock(lock, skillName, topology)) throw incompleteLock(paths.lock);
  if (canonical.type === "absent") {
    assertRemainingBundleMatchesLock(paths, lock, resolvedOperations);
    return createPlan({ paths, adapters, writeBundle: true });
  }
  if (canonical.type !== "file") throw locallyModifiedCanonical(paths.canonical);
  assertInstalledBundleMatchesLock(paths, lock, resolvedOperations);
  if (adapters.some(({ state }) => state !== "valid")) throw incompleteLock(paths.lock);

  const installedDigest = lock.bundleSha256 ?? lock.skillSha256;
  const staleFiles =
    lock.files
      ?.map(({ path: relativePath }) => relativePath)
      .filter((relativePath) => !bundle.files.some((file) => file.path === relativePath)) ?? [];

  return {
    action: installedDigest === bundle.bundleSha256 ? "no-op" : "upgrade",
    paths,
    topology,
    adaptersToMaterialize: [],
    writeBundle: installedDigest !== bundle.bundleSha256,
    staleFiles,
  };
}

/**
 * Execute an install plan: atomically write each bundled file, materialize
 * host adapters, and write the lock; on failure roll back everything touched
 * and report any recovery failures in the thrown error.
 * @param {{packageVersion: string, bundle: object, plan: object, operations?: object}} options - ddduck version for the lock, loaded bundle, plan from planSkillInstall, and fs overrides.
 * @returns {{action: string, skillSha256: string, bundleSha256: string, canonicalPath: string, lockPath: string}} The installation result.
 */
export function applySkillInstall({ packageVersion, bundle, plan, operations = {} }) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  if (plan.action === "no-op") return installResult("no-op", bundle, plan);

  const touched = [];
  const originalBundle = plan.writeBundle ? snapshotDirectory(plan.paths.canonicalDirectory, resolvedOperations) : null;
  let bundleWritten = false;
  const materializedAdapters = [];

  try {
    if (plan.writeBundle) {
      bundleWritten = true;
      for (const file of bundle.files) {
        atomicWrite(path.join(plan.paths.canonicalDirectory, file.path), file.bytes, resolvedOperations, touched);
      }
      for (const relativePath of plan.staleFiles ?? []) {
        const stalePath = path.join(plan.paths.canonicalDirectory, relativePath);
        touched.push(stalePath);
        resolvedOperations.rmSync(stalePath, { force: true });
      }
    }
    for (const adapter of plan.adaptersToMaterialize) {
      adapter.materialize({
        adapterPath: plan.paths.adapters[adapter.host],
        operations: resolvedOperations,
        touched,
      });
      materializedAdapters.push(adapter);
    }

    atomicWrite(
      plan.paths.lock,
      `${JSON.stringify(createLock({ packageVersion, bundle, topology: plan.topology }), null, 2)}\n`,
      resolvedOperations,
      touched,
    );
    return installResult(plan.action, bundle, plan);
  } catch (error) {
    const recoveryFailures = restoreAfterFailure({
      plan,
      originalBundle,
      bundleWritten,
      materializedAdapters,
      operations: resolvedOperations,
      touched,
    });
    const paths = [...new Set(touched)].join(", ") || "none";
    const recovery = recoveryFailures.length === 0 ? "" : ` Recovery failures: ${recoveryFailures.join("; ")}.`;
    throw new Error(`Skill installation failed after touching: ${paths}. ${error.message}.${recovery}`);
  }
}

function installResult(action, bundle, plan) {
  return {
    action,
    skillSha256: bundle.skillSha256,
    bundleSha256: bundle.bundleSha256,
    canonicalPath: toPosixPath(plan.topology.canonicalRelativePath),
    lockPath: toPosixPath(lockRelativePath),
  };
}

function createPlan({ paths, adapters, writeBundle }) {
  return {
    action: "create",
    paths,
    topology: paths.topology,
    adaptersToMaterialize: adapters.filter(({ state }) => state === "absent").map(({ adapter }) => adapter),
    writeBundle,
    staleFiles: [],
  };
}

function installationPaths(root, topology) {
  const canonical = path.join(root, topology.canonicalRelativePath);
  return {
    canonical,
    canonicalDirectory: path.dirname(canonical),
    topology,
    adapters: Object.fromEntries(
      topology.adapters.map((adapter) => [adapter.host, path.join(root, adapter.relativePath)]),
    ),
    lock: path.join(root, lockRelativePath),
  };
}

function inspectHostAdapters(paths, topology, operations) {
  return topology.adapters.map((adapter) => ({
    adapter,
    state: adapter.inspect({ adapterPath: paths.adapters[adapter.host], operations }),
  }));
}

function assertDirectoryParents(paths, topology, operations) {
  const directories = [
    ...topology.adapters.flatMap((adapter) => adapter.parentPaths(paths.adapters[adapter.host])),
    path.dirname(paths.lock),
  ];
  for (const directory of new Set(directories)) {
    const state = pathState(directory, operations);
    if (!["absent", "directory"].includes(state.type)) {
      throw new Error(`Conflicting skill installation path: ${directory}`);
    }
  }
}

function readLock(lockPath, operations) {
  const state = pathState(lockPath, operations);
  if (state.type === "absent") return { type: "absent" };
  if (state.type !== "file") return { type: "invalid" };
  try {
    return { type: "valid", value: JSON.parse(operations.readFileSync(lockPath, "utf8")) };
  } catch {
    return { type: "invalid" };
  }
}

function pathState(filePath, operations) {
  try {
    const stat = operations.lstatSync(filePath);
    if (stat.isFile()) return { type: "file" };
    if (stat.isDirectory()) return { type: "directory" };
    if (stat.isSymbolicLink()) return { type: "symlink" };
    return { type: "other" };
  } catch (error) {
    if (error.code === "ENOENT") return { type: "absent" };
    throw error;
  }
}

function selectTopology({ root, lockState, operations }) {
  if (lockState.type === "valid") {
    const topology = installTopologies.find(
      (candidate) => toPosixPath(candidate.canonicalRelativePath) === toPosixPath(lockState.value.canonicalPath),
    );
    return topology ?? installTopologies[0];
  }

  const agents = pathState(path.join(root, ".agents"), operations).type;
  const claude = pathState(path.join(root, ".claude"), operations).type;
  if (agents === "directory" && claude === "directory") return installTopologies.find(({ id }) => id === "shared");
  if (claude === "directory") return installTopologies.find(({ id }) => id === "claude-code");
  return installTopologies.find(({ id }) => id === "codex");
}

function isValidLock(lock, skillName, topology) {
  return (
    lock &&
    [1, lockSchemaVersion].includes(lock.schemaVersion) &&
    lock.skill === skillName &&
    typeof lock.ddduckVersion === "string" &&
    lock.ddduckVersion.length > 0 &&
    toPosixPath(lock.canonicalPath) === toPosixPath(topology.canonicalRelativePath) &&
    /^[a-f0-9]{64}$/.test(lock.skillSha256) &&
    (lock.schemaVersion === 1 || isValidBundleLock(lock)) &&
    JSON.stringify(lock.adapters) === JSON.stringify(expectedAdapters(topology))
  );
}

function createLock({ packageVersion, bundle, topology }) {
  if (bundle.files.length === 1) {
    return {
      schemaVersion: 1,
      skill: bundle.name,
      ddduckVersion: packageVersion,
      canonicalPath: toPosixPath(topology.canonicalRelativePath),
      skillSha256: bundle.skillSha256,
      adapters: expectedAdapters(topology),
    };
  }
  return {
    schemaVersion: lockSchemaVersion,
    skill: bundle.name,
    ddduckVersion: packageVersion,
    canonicalPath: toPosixPath(topology.canonicalRelativePath),
    skillSha256: bundle.skillSha256,
    bundleSha256: bundle.bundleSha256,
    files: bundle.files.map(({ path: relativePath, sha256: fileSha256 }) => ({
      path: relativePath,
      sha256: fileSha256,
    })),
    adapters: expectedAdapters(topology),
  };
}

function expectedAdapters(topology) {
  return topology.adapters.map((adapter) => adapter.lockEntry());
}

function conflictingHostAdapter({ adapter }, paths) {
  const label = adapter.host === "claude-code" ? "Claude Code" : adapter.host;
  return conflictingHostState(
    `Conflicting ${label} adapter: ${paths.adapters[adapter.host]}`,
    paths.adapters[adapter.host],
  );
}

// Host-state conflicts are environment failures, not input failures: name the
// pre-existing path the user must resolve instead of the usage hint.
function conflictingHostState(message, conflictingPath) {
  const error = new Error(message);
  error.nextAction = `Move ${conflictingPath} aside or remove it, then re-run ddduck install skill update-ddduck-specs.`;
  return error;
}

function atomicWrite(destination, content, operations, touched) {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.tmp`);
  touched.push(directory, temporary, destination);
  try {
    operations.mkdirSync(directory, { recursive: true });
    operations.writeFileSync(temporary, content);
    operations.renameSync(temporary, destination);
  } finally {
    if (pathState(temporary, operations).type !== "absent") operations.rmSync(temporary, { force: true });
  }
}

function restoreAfterFailure({ plan, originalBundle, bundleWritten, materializedAdapters, operations, touched }) {
  const failures = [];
  for (const adapter of materializedAdapters.toReversed()) {
    try {
      const adapterPath = plan.paths.adapters[adapter.host];
      touched.push(adapterPath);
      if (pathState(adapterPath, operations).type !== "absent") {
        operations.rmSync(adapterPath, { recursive: true, force: true });
      }
    } catch (error) {
      failures.push(`remove ${adapter.host} adapter: ${error.message}`);
    }
  }
  if (!bundleWritten && originalBundle === null) return failures;

  try {
    touched.push(plan.paths.canonicalDirectory);
    operations.rmSync(plan.paths.canonicalDirectory, { recursive: true, force: true });
    for (const file of originalBundle ?? []) {
      atomicWrite(path.join(plan.paths.canonicalDirectory, file.path), file.bytes, operations, touched);
    }
  } catch (error) {
    failures.push(`restore canonical skill bundle: ${error.message}`);
  }
  return failures;
}

function incompleteLock(lockPath) {
  const error = new Error(`Incomplete or inconsistent skill lock: ${lockPath}`);
  // Deleting the lock is safe: the next install rebuilds it from the repository
  // state, and any canonical mismatch then surfaces as its own conflict.
  error.nextAction = `Delete ${lockPath}, then re-run ddduck install skill update-ddduck-specs to rebuild it.`;
  return error;
}

function locallyModifiedCanonical(canonicalPath) {
  const error = new Error(`Locally modified canonical skill: ${canonicalPath}`);
  error.nextAction = `Revert or remove ${canonicalPath}, then re-run ddduck install skill update-ddduck-specs.`;
  return error;
}

function locallyModifiedBundle(bundlePath) {
  const error = new Error(`Locally modified canonical skill bundle: ${bundlePath}`);
  error.nextAction = `Revert or remove ${bundlePath}, then re-run ddduck install skill update-ddduck-specs.`;
  return error;
}

function readBundleFiles(directory, operations, relativeDirectory = "") {
  const current = path.join(directory, relativeDirectory);
  const files = [];
  const entries = operations
    .readdirSync(current, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...readBundleFiles(directory, operations, relativePath));
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported bundled skill entry: ${path.join(directory, relativePath)}`);
    const bytes = operations.readFileSync(path.join(directory, relativePath));
    files.push({ path: toPosixPath(relativePath), bytes, sha256: sha256(bytes) });
  }
  return files;
}

function digestBundle(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(`${file.path.length}:${file.path}:${file.bytes.length}:`);
    digest.update(file.bytes);
  }
  return digest.digest("hex");
}

function isValidBundleLock(lock) {
  return (
    /^[a-f0-9]{64}$/.test(lock.bundleSha256) &&
    Array.isArray(lock.files) &&
    lock.files.length > 0 &&
    lock.files.every(
      (file) =>
        file &&
        typeof file.path === "string" &&
        file.path.length > 0 &&
        !path.isAbsolute(file.path) &&
        !file.path.split("/").includes("..") &&
        /^[a-f0-9]{64}$/.test(file.sha256),
    )
  );
}

function assertInstalledBundleMatchesLock(paths, lock, operations) {
  if (lock.schemaVersion === 1) {
    if (sha256(operations.readFileSync(paths.canonical)) !== lock.skillSha256) {
      throw locallyModifiedCanonical(paths.canonical);
    }
    const entries = snapshotDirectory(paths.canonicalDirectory, operations) ?? [];
    if (entries.some(({ path: relativePath }) => relativePath !== skillFileName)) {
      throw locallyModifiedBundle(paths.canonicalDirectory);
    }
    return;
  }

  const installed = snapshotDirectory(paths.canonicalDirectory, operations) ?? [];
  const expectedPaths = lock.files.map(({ path: relativePath }) => relativePath);
  if (
    JSON.stringify(installed.map(({ path: relativePath }) => relativePath)) !== JSON.stringify(expectedPaths) ||
    installed.some((file, index) => file.sha256 !== lock.files[index].sha256)
  ) {
    throw locallyModifiedBundle(paths.canonicalDirectory);
  }
}

function assertRemainingBundleMatchesLock(paths, lock, operations) {
  const installed = snapshotDirectory(paths.canonicalDirectory, operations) ?? [];
  const expected = new Map(
    lock.schemaVersion === 1
      ? [[skillFileName, lock.skillSha256]]
      : lock.files.map(({ path: relativePath, sha256: fileSha256 }) => [relativePath, fileSha256]),
  );
  if (installed.some((file) => expected.get(file.path) !== file.sha256)) {
    throw locallyModifiedBundle(paths.canonicalDirectory);
  }
}

function snapshotDirectory(directory, operations) {
  const state = pathState(directory, operations);
  if (state.type === "absent") return null;
  if (state.type !== "directory") throw locallyModifiedBundle(directory);
  return readBundleFiles(directory, operations);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPosixPath(value) {
  return String(value).replaceAll("\\", "/");
}
