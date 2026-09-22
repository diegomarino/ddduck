/**
 * Installer for the agent skills bundled in the package, behind `ddduck
 * install skill`. Discovers the bundled skills, selects a host topology per
 * skill by inspecting the repository (codex .agents/, claude-code .claude/, or
 * shared via symlink), plans create, upgrade, or no-op against the canonical
 * SKILL.md on disk, and applies each plan with atomic writes plus rollback of
 * everything touched on failure. Conflicting host state or a canonical file
 * this installer never wrote refuses with a nextAction naming the exact path
 * to resolve.
 *
 * .ddduck/agent-skills.lock.json records one entry per installed skill, but it
 * is a provenance note rather than an authority: every decision is taken from
 * the filesystem, a damaged or missing lock degrades to no entries instead of
 * failing an install, and the only field consulted is skillSha256 — the hint
 * that the installed bytes are ones this installer wrote, which makes an
 * upgrade safe and silent.
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

// Schema 2 holds one entry per installed skill; schema 1 held exactly one
// skill at the top level and is still read (and migrated on the next write).
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

const skillFileName = "SKILL.md";

// Every host path is derived from the skill name, so the same topologies serve
// any bundled skill without a per-skill special case.
function hostSkillAdapters(skillName) {
  const codexSkillDirectory = path.join(".agents", "skills", skillName);
  const claudeSkillDirectory = path.join(".claude", "skills", skillName);
  const directoryAdapter = (host, relativePath) => ({
    host,
    relativePath,
    lockEntry() {
      return { host: this.host, path: toPosixPath(this.relativePath) };
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
  });
  return {
    codex: directoryAdapter("codex", codexSkillDirectory),
    claudeDirectory: directoryAdapter("claude-code", claudeSkillDirectory),
    claudeSymlink: {
      host: "claude-code",
      relativePath: claudeSkillDirectory,
      target: `../../${toPosixPath(codexSkillDirectory)}`,
      lockEntry() {
        return { host: this.host, path: toPosixPath(this.relativePath), target: this.target };
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
}

function installTopologies(skillName) {
  const adapters = hostSkillAdapters(skillName);
  return [
    {
      id: "codex",
      canonicalRelativePath: path.join(adapters.codex.relativePath, skillFileName),
      adapters: [adapters.codex],
    },
    {
      id: "claude-code",
      canonicalRelativePath: path.join(adapters.claudeDirectory.relativePath, skillFileName),
      adapters: [adapters.claudeDirectory],
    },
    {
      id: "shared",
      canonicalRelativePath: path.join(adapters.codex.relativePath, skillFileName),
      adapters: [adapters.codex, adapters.claudeSymlink],
    },
  ];
}

/**
 * List the skills bundled under a skills root: every directory holding a
 * SKILL.md, sorted by name so selection and reporting stay deterministic.
 * @param {string} skillsRoot - Directory containing one directory per bundled skill.
 * @param {{operations?: object}} [options] - fs overrides for tests.
 * @returns {string[]} Bundled skill names, sorted; empty when the root is absent.
 */
export function listBundledSkills(skillsRoot, { operations = {} } = {}) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  let entries;
  try {
    entries = resolvedOperations.readdirSync(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => pathState(path.join(skillsRoot, name, skillFileName), resolvedOperations).type === "file")
    .sort();
}

/**
 * Install several bundled skills into one repository, in the given order.
 * A failing skill never blocks the others: each outcome carries either the
 * installation result or the error, so the caller can report the complete
 * picture and choose the exit status.
 * @param {{repository: string, skillsRoot: string, skillNames: string[], packageVersion: string, operations?: object}} options - Repository root, bundled skills root, skills to install, ddduck version for the lock, and fs overrides.
 * @returns {{skill: string, action?: string, skillSha256?: string, canonicalPath?: string, lockPath?: string, error?: Error}[]} One outcome per requested skill, in request order.
 */
export function installBundledSkills({ repository, skillsRoot, skillNames, packageVersion, operations = {} }) {
  return skillNames.map((skillName) => {
    try {
      return {
        skill: skillName,
        ...installSkill({
          repository,
          skillName,
          skillPath: path.join(skillsRoot, skillName, skillFileName),
          packageVersion,
          operations,
        }),
      };
    } catch (error) {
      return { skill: skillName, error };
    }
  });
}

/**
 * Install (or upgrade) one bundled skill into a repository: load, plan, apply.
 * @param {{repository: string, skillName: string, skillPath: string, packageVersion: string, operations?: object}} options - Repository root, skill identity, bundled asset path, and ddduck version for the lock.
 * @returns {{action: "create"|"upgrade"|"no-op", skillSha256: string, canonicalPath: string, lockPath: string}} The installation result.
 */
export function installSkill(options) {
  const bundle = loadSkillBundle(options);
  const plan = planSkillInstall({ ...options, bundle });
  return applySkillInstall({ ...options, bundle, plan });
}

/**
 * Read the bundled skill asset and compute its sha256.
 * @param {{skillName: string, skillPath: string, operations?: object}} options - Skill name, SKILL.md path, and fs overrides for tests.
 * @returns {{name: string, bytes: Buffer, sha256: string}} The loaded bundle.
 */
export function loadSkillBundle({ skillName, skillPath, operations = {} }) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  if (pathState(skillPath, resolvedOperations).type !== "file") {
    throw new Error(`Missing bundled skill asset: ${skillPath}`);
  }
  const bytes = resolvedOperations.readFileSync(skillPath);
  return { name: skillName, bytes, sha256: sha256(bytes) };
}

/**
 * Decide the action — create, upgrade, or no-op — by inspecting the canonical
 * file and the host adapters. Every decision comes from the filesystem; the
 * lock contributes one hint, the SHA-256 of the bytes this installer last
 * wrote, which distinguishes an older installed skill (safe to upgrade) from a
 * file the installer never wrote (refused). Throws on conflicting host state
 * or an unrecognized canonical file.
 * @param {{repository: string, skillName: string, bundle: {sha256: string}, operations?: object}} options - Repository root, skill name, loaded bundle, and fs overrides.
 * @returns {{action: string, paths: object, topology: object, otherEntries: object[], adaptersToMaterialize: object[], writeCanonical: boolean}} The install plan for applySkillInstall.
 */
export function planSkillInstall({ repository, skillName, bundle, operations = {} }) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  const root = path.resolve(repository);
  const entries = readLockEntries(path.join(root, lockRelativePath), resolvedOperations);
  // Entries for other skills are untouched provenance this install carries forward.
  const otherEntries = entries.filter((entry) => entry.skill !== skillName);
  const installedSha256 = entries.find((entry) => entry.skill === skillName)?.skillSha256;
  const topology = selectTopology({ root, skillName, operations: resolvedOperations });
  const paths = installationPaths(root, topology);
  assertDirectoryParents(paths, topology, resolvedOperations);
  const adapters = inspectHostAdapters(paths, topology, resolvedOperations);
  const conflictingAdapter = adapters.find(({ state }) => state === "conflict");
  if (conflictingAdapter) throw conflictingHostAdapter(conflictingAdapter, paths, skillName);

  const canonical = pathState(paths.canonical, resolvedOperations);
  if (canonical.type === "absent") {
    if (
      pathState(paths.canonicalDirectory, resolvedOperations).type === "directory" &&
      resolvedOperations.readdirSync(paths.canonicalDirectory).length > 0
    ) {
      throw conflictingHostState(
        `Conflicting canonical skill directory: ${paths.canonicalDirectory}`,
        paths.canonicalDirectory,
        skillName,
      );
    }
    return installPlan({ action: "create", paths, adapters, otherEntries, writeCanonical: true });
  }
  if (canonical.type !== "file") {
    throw conflictingHostState(
      `Conflicting canonical skill destination: ${paths.canonical}`,
      paths.canonical,
      skillName,
    );
  }

  const canonicalSha256 = sha256(resolvedOperations.readFileSync(paths.canonical));
  if (canonicalSha256 === bundle.sha256) {
    // The bundled bytes are already in place; only a missing adapter or a lock
    // that does not yet record this installation is left to write.
    const settled = installedSha256 === canonicalSha256 && adapters.every(({ state }) => state === "valid");
    return installPlan({
      action: settled ? "no-op" : "create",
      paths,
      adapters,
      otherEntries,
      writeCanonical: false,
    });
  }
  // The hint recognizes the installed bytes as the ones this installer wrote,
  // so replacing them loses no work the user did.
  if (installedSha256 === canonicalSha256) {
    return installPlan({ action: "upgrade", paths, adapters, otherEntries, writeCanonical: true });
  }
  if (installedSha256 !== undefined) throw locallyModifiedCanonical(paths.canonical, skillName);
  throw conflictingHostState(`Conflicting canonical skill destination: ${paths.canonical}`, paths.canonical, skillName);
}

/**
 * Execute an install plan: atomically write the canonical skill, materialize
 * host adapters, and write the lock; on failure roll back everything touched
 * and report any recovery failures in the thrown error.
 * @param {{packageVersion: string, bundle: {name: string, bytes: Buffer, sha256: string}, plan: object, operations?: object}} options - ddduck version for the lock, loaded bundle, plan from planSkillInstall, and fs overrides.
 * @returns {{action: string, skillSha256: string, canonicalPath: string, lockPath: string}} The installation result.
 */
export function applySkillInstall({ packageVersion, bundle, plan, operations = {} }) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  if (plan.action === "no-op") return installResult("no-op", bundle, plan);

  const touched = [];
  const originalCanonical =
    plan.writeCanonical && pathState(plan.paths.canonical, resolvedOperations).type === "file"
      ? resolvedOperations.readFileSync(plan.paths.canonical)
      : null;
  let canonicalWritten = false;
  const materializedAdapters = [];

  try {
    if (plan.writeCanonical) {
      atomicWrite(plan.paths.canonical, bundle.bytes, resolvedOperations, touched);
      canonicalWritten = true;
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
      `${JSON.stringify(createLock({ packageVersion, bundle, topology: plan.topology, otherEntries: plan.otherEntries }), null, 2)}\n`,
      resolvedOperations,
      touched,
    );
    return installResult(plan.action, bundle, plan);
  } catch (error) {
    const recoveryFailures = restoreAfterFailure({
      plan,
      originalCanonical,
      canonicalWritten,
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
    skillSha256: bundle.sha256,
    canonicalPath: toPosixPath(plan.topology.canonicalRelativePath),
    lockPath: toPosixPath(lockRelativePath),
  };
}

function installPlan({ action, paths, adapters, otherEntries, writeCanonical }) {
  return {
    action,
    paths,
    topology: paths.topology,
    otherEntries,
    adaptersToMaterialize: adapters.filter(({ state }) => state === "absent").map(({ adapter }) => adapter),
    writeCanonical,
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

// The lock is a provenance note, never an authority. Anything unreadable,
// unexpected, or half-written degrades to "no entries" instead of failing the
// install: the installation itself is described by the filesystem, and the
// next successful install rewrites the note. A schema-1 lock recorded exactly
// one skill at the top level and is read as a single entry.
function readLockEntries(lockPath, operations) {
  if (pathState(lockPath, operations).type !== "file") return [];
  let value;
  try {
    value = JSON.parse(operations.readFileSync(lockPath, "utf8"));
  } catch {
    return [];
  }
  if (!value || typeof value !== "object") return [];
  const records = Array.isArray(value.skills) ? value.skills : [value];
  return records
    .filter((record) => record && typeof record.skill === "string" && /^[a-f0-9]{64}$/.test(record.skillSha256))
    .map(({ skill, ddduckVersion, canonicalPath, skillSha256, adapters }) => ({
      skill,
      ddduckVersion,
      canonicalPath,
      skillSha256,
      adapters,
    }));
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

// Which topology is in force is a fact about the repository, so it is read
// from the repository: an existing installation is recognized by its canonical
// SKILL.md plus the shape of the Claude Code skill path beside it. Only when
// nothing is installed does the least-intrusive host heuristic choose.
function selectTopology({ root, skillName, operations }) {
  const topologies = installTopologies(skillName);
  const withId = (id) => topologies.find((topology) => topology.id === id);
  const canonicalExists = (topology) =>
    pathState(path.join(root, topology.canonicalRelativePath), operations).type === "file";
  const claudeSkillPath = pathState(path.join(root, withId("claude-code").adapters[0].relativePath), operations).type;
  const agents = pathState(path.join(root, ".agents"), operations).type;
  const claude = pathState(path.join(root, ".claude"), operations).type;

  // A Codex canonical file in a repository that also uses Claude Code is the
  // shared topology, whether or not its symlink is currently there: adapter
  // inspection then materializes a missing one and refuses a conflicting one.
  if (canonicalExists(withId("codex"))) return claude === "directory" ? withId("shared") : withId("codex");
  // A Claude Code installation stays where it is; promoting it would move the
  // canonical file rather than add a link beside it.
  if (claudeSkillPath === "directory" && canonicalExists(withId("claude-code"))) return withId("claude-code");

  if (agents === "directory" && claude === "directory") return withId("shared");
  if (claude === "directory") return withId("claude-code");
  return withId("codex");
}

function createLock({ packageVersion, bundle, topology, otherEntries }) {
  const entry = {
    skill: bundle.name,
    ddduckVersion: packageVersion,
    canonicalPath: toPosixPath(topology.canonicalRelativePath),
    skillSha256: bundle.sha256,
    adapters: expectedAdapters(topology),
  };
  return {
    schemaVersion: lockSchemaVersion,
    // Sorted by skill so the lock is a stable, reviewable diff whatever order
    // the skills were installed in.
    skills: [...otherEntries, entry].sort((left, right) => (left.skill < right.skill ? -1 : 1)),
  };
}

function expectedAdapters(topology) {
  return topology.adapters.map((adapter) => adapter.lockEntry());
}

function conflictingHostAdapter({ adapter }, paths, skillName) {
  const label = adapter.host === "claude-code" ? "Claude Code" : adapter.host;
  return conflictingHostState(
    `Conflicting ${label} adapter: ${paths.adapters[adapter.host]}`,
    paths.adapters[adapter.host],
    skillName,
  );
}

// Host-state conflicts are environment failures, not input failures: name the
// pre-existing path the user must resolve instead of the usage hint.
function conflictingHostState(message, conflictingPath, skillName) {
  const error = new Error(message);
  error.nextAction = `Move ${conflictingPath} aside or remove it, then re-run ddduck install skill ${skillName}.`;
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

function restoreAfterFailure({ plan, originalCanonical, canonicalWritten, materializedAdapters, operations, touched }) {
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
  if (!canonicalWritten) return failures;

  try {
    if (originalCanonical) {
      atomicWrite(plan.paths.canonical, originalCanonical, operations, touched);
    } else {
      touched.push(plan.paths.canonical);
      operations.rmSync(plan.paths.canonical, { force: true });
    }
  } catch (error) {
    failures.push(`restore canonical skill: ${error.message}`);
  }
  return failures;
}

function locallyModifiedCanonical(canonicalPath, skillName) {
  const error = new Error(`Locally modified canonical skill: ${canonicalPath}`);
  error.nextAction = `Revert or remove ${canonicalPath}, then re-run ddduck install skill ${skillName}.`;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPosixPath(value) {
  return String(value).replaceAll("\\", "/");
}
