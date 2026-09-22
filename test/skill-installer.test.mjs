import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { installSkill } from "../scripts/lib/skill-installer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledSkill = path.join(root, "skills", "update-ddduck-specs", "SKILL.md");
const canonicalRelativePath = path.join(".agents", "skills", "update-ddduck-specs", "SKILL.md");
const claudeCanonicalRelativePath = path.join(".claude", "skills", "update-ddduck-specs", "SKILL.md");
const claudeRelativePath = path.join(".claude", "skills", "update-ddduck-specs");
const codexAdapterRelativePath = path.join(".agents", "skills", "update-ddduck-specs");
const lockRelativePath = path.join(".ddduck", "agent-skills.lock.json");

test("defaults to a Codex canonical skill snapshot when no host directories exist", () => {
  const repository = makeRepository();

  const result = install(repository);

  assert.equal(result.action, "create");
  assert.equal(readFileSync(path.join(repository, canonicalRelativePath), "utf8"), readFileSync(bundledSkill, "utf8"));
  assert.equal(existsSync(path.join(repository, ".claude")), false);
  assertBundleLock(
    JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8")),
    result,
    ".agents/skills/update-ddduck-specs/SKILL.md",
    [{ host: "codex", path: ".agents/skills/update-ddduck-specs" }],
  );
});

test("installs directly into Claude Code when only .claude exists", () => {
  const repository = makeRepository();
  mkdirSync(path.join(repository, ".claude"), { recursive: true });

  const result = install(repository);

  assert.equal(result.action, "create");
  assert.equal(
    readFileSync(path.join(repository, claudeCanonicalRelativePath), "utf8"),
    readFileSync(bundledSkill, "utf8"),
  );
  assert.equal(existsSync(path.join(repository, ".agents")), false);
  assert.equal(lstatSync(path.join(repository, claudeRelativePath)).isDirectory(), true);
  assertBundleLock(
    JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8")),
    result,
    ".claude/skills/update-ddduck-specs/SKILL.md",
    [{ host: "claude-code", path: ".claude/skills/update-ddduck-specs" }],
  );
});

test("repeated installation is a quiet no-op", () => {
  const repository = makeRepository();
  install(repository);
  const lockPath = path.join(repository, lockRelativePath);
  const lockBefore = readFileSync(lockPath, "utf8");

  const result = install(repository);

  assert.equal(result.action, "no-op");
  assert.equal(readFileSync(lockPath, "utf8"), lockBefore);
});

test("installs the complete skill bundle including references", () => {
  const repository = makeRepository();
  const bundled = makeBundle("skill entrypoint\n", {
    "references/reviewing-changes.md": "review reference\n",
    "references/authoring-and-verification.md": "authoring reference\n",
  });

  const result = install(repository, bundled);

  assert.equal(result.action, "create");
  assert.equal(
    readFileSync(path.join(repository, codexAdapterRelativePath, "references", "reviewing-changes.md"), "utf8"),
    "review reference\n",
  );
  assert.equal(
    readFileSync(
      path.join(repository, codexAdapterRelativePath, "references", "authoring-and-verification.md"),
      "utf8",
    ),
    "authoring reference\n",
  );
  const lock = JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8"));
  assert.match(lock.bundleSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    lock.files.map(({ path: filePath }) => filePath),
    ["SKILL.md", "references/authoring-and-verification.md", "references/reviewing-changes.md"],
  );
});

test("refuses to overwrite a locally modified managed reference", () => {
  const repository = makeRepository();
  const bundled = makeBundle("skill entrypoint\n", { "references/reviewing-changes.md": "original\n" });
  install(repository, bundled);
  const installedReference = path.join(repository, codexAdapterRelativePath, "references", "reviewing-changes.md");
  writeFileSync(installedReference, "local modification\n");

  const error = captureError(() => install(repository, bundled));

  assert.match(error.message, /Locally modified canonical skill bundle/);
  assert.equal(readFileSync(installedReference, "utf8"), "local modification\n");
});

test("upgrades a legacy single-file lock to a complete bundle manifest", () => {
  const repository = makeRepository();
  const legacy = makeBundle("skill entrypoint\n");
  const bundled = makeBundle("skill entrypoint\n", { "references/reviewing-changes.md": "review reference\n" });
  install(repository, legacy);

  const result = install(repository, bundled);

  assert.equal(result.action, "upgrade");
  assert.equal(
    readFileSync(path.join(repository, codexAdapterRelativePath, "references", "reviewing-changes.md"), "utf8"),
    "review reference\n",
  );
  const lock = JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8"));
  assert.equal(lock.schemaVersion, 2);
  assert.equal(lock.bundleSha256, result.bundleSha256);
});

test("refuses a legacy bundle upgrade when the managed directory contains local files", () => {
  const repository = makeRepository();
  const legacy = makeBundle("skill entrypoint\n");
  const bundled = makeBundle("skill entrypoint\n", { "references/reviewing-changes.md": "review reference\n" });
  install(repository, legacy);
  const localNotes = path.join(repository, codexAdapterRelativePath, "local-notes.md");
  writeFileSync(localNotes, "keep me\n");

  const error = captureError(() => install(repository, bundled));

  assert.match(error.message, /Locally modified canonical skill bundle/);
  assert.equal(readFileSync(localNotes, "utf8"), "keep me\n");
  assert.equal(existsSync(path.join(repository, codexAdapterRelativePath, "references")), false);
});

test("upgrades a clean managed snapshot when the bundled skill changes", () => {
  const repository = makeRepository();
  const original = makeBundle("original skill\n");
  const updated = makeBundle("updated skill\n");
  install(repository, original);

  const result = install(repository, updated);

  assert.equal(result.action, "upgrade");
  assert.equal(readFileSync(path.join(repository, canonicalRelativePath), "utf8"), "updated skill\n");
  assert.equal(
    JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8")).skillSha256,
    result.skillSha256,
  );
});

test("refuses to overwrite a locally modified managed snapshot and states the exit", () => {
  const repository = makeRepository();
  install(repository);
  const canonicalPath = path.join(repository, canonicalRelativePath);
  writeFileSync(canonicalPath, "local modification\n");

  const error = captureError(() => install(repository));

  assert.match(error.message, /Locally modified canonical skill bundle: .*update-ddduck-specs/);
  assert.match(
    error.nextAction,
    /Revert or remove .*update-ddduck-specs, then re-run ddduck install skill update-ddduck-specs/,
  );
  assert.equal(readFileSync(canonicalPath, "utf8"), "local modification\n");
});

test("repairs a valid lock whose canonical skill file is missing", () => {
  const repository = makeRepository();
  install(repository);
  const lockPath = path.join(repository, lockRelativePath);
  const lockBefore = readFileSync(lockPath, "utf8");
  rmSync(path.join(repository, ".agents"), { recursive: true, force: true });

  const result = install(repository);

  assert.equal(result.action, "create");
  assert.equal(readFileSync(path.join(repository, canonicalRelativePath), "utf8"), readFileSync(bundledSkill, "utf8"));
  assert.equal(readFileSync(lockPath, "utf8"), lockBefore);
});

test("treats an empty lockless managed canonical directory as absent", () => {
  const repository = makeRepository();
  mkdirSync(path.join(repository, codexAdapterRelativePath), { recursive: true });

  const result = install(repository);

  assert.equal(result.action, "create");
  assert.equal(readFileSync(path.join(repository, canonicalRelativePath), "utf8"), readFileSync(bundledSkill, "utf8"));
  assert.ok(existsSync(path.join(repository, lockRelativePath)));
});

test("refuses a conflicting Codex destination without creating a lock", () => {
  const repository = makeRepository();
  const canonicalPath = path.join(repository, canonicalRelativePath);
  mkdirSync(path.dirname(canonicalPath), { recursive: true });
  writeFileSync(canonicalPath, "user skill\n");

  assert.throws(() => install(repository), /Conflicting canonical skill destination: .*SKILL\.md/);
  assert.equal(readFileSync(canonicalPath, "utf8"), "user skill\n");
  assert.equal(existsSync(path.join(repository, lockRelativePath)), false);
});

test("refuses a non-empty unmanaged canonical skill directory without writing into it", () => {
  const repository = makeRepository();
  const canonicalDirectory = path.join(repository, ".agents", "skills", "update-ddduck-specs");
  mkdirSync(canonicalDirectory, { recursive: true });
  writeFileSync(path.join(canonicalDirectory, "user-notes.md"), "user content\n");

  assert.throws(() => install(repository), /Conflicting canonical skill directory: .*update-ddduck-specs/);
  assert.equal(existsSync(path.join(canonicalDirectory, "SKILL.md")), false);
  assert.equal(existsSync(path.join(repository, lockRelativePath)), false);
});

test("refuses a symlinked host parent before it can redirect installation", () => {
  const repository = makeRepository();
  const outside = makeRepository();
  symlinkSync(outside, path.join(repository, ".agents"));

  assert.throws(() => install(repository), /Conflicting skill installation path: .*\.agents/);
  assert.equal(existsSync(path.join(outside, "skills", "update-ddduck-specs", "SKILL.md")), false);
  assert.equal(existsSync(path.join(repository, lockRelativePath)), false);
});

test("refuses conflicting and broken Claude Code destinations without changing them", () => {
  for (const createAdapter of [
    (adapterPath) => {
      mkdirSync(adapterPath, { recursive: true });
      writeFileSync(path.join(adapterPath, "user-notes.md"), "user content\n");
    },
    (adapterPath) => {
      mkdirSync(path.dirname(adapterPath), { recursive: true });
      symlinkSync("missing-target", adapterPath);
    },
  ]) {
    const repository = makeRepository();
    const adapterPath = path.join(repository, claudeRelativePath);
    createAdapter(adapterPath);

    assert.throws(
      () => install(repository),
      /Conflicting (?:Claude Code adapter|canonical skill directory): .*update-ddduck-specs/,
    );
    assert.equal(existsSync(path.join(repository, lockRelativePath)), false);
  }
});

test("preserves unrelated skills and host configuration", () => {
  const repository = makeRepository();
  const unrelatedCodexSkill = path.join(repository, ".agents", "skills", "unrelated", "SKILL.md");
  const unrelatedClaudeSkill = path.join(repository, ".claude", "skills", "unrelated", "SKILL.md");
  mkdirSync(path.dirname(unrelatedCodexSkill), { recursive: true });
  mkdirSync(path.dirname(unrelatedClaudeSkill), { recursive: true });
  writeFileSync(unrelatedCodexSkill, "unrelated Codex\n");
  writeFileSync(unrelatedClaudeSkill, "unrelated Claude\n");

  install(repository);

  assert.equal(readFileSync(unrelatedCodexSkill, "utf8"), "unrelated Codex\n");
  assert.equal(readFileSync(unrelatedClaudeSkill, "utf8"), "unrelated Claude\n");
});

test("accepts a healthy install whose lock canonicalPath was committed with Windows separators", () => {
  const repository = makeRepository();
  install(repository);
  const lockPath = path.join(repository, lockRelativePath);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.equal(lock.canonicalPath.includes("\\"), false);
  lock.canonicalPath = ".agents\\skills\\update-ddduck-specs\\SKILL.md";
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const result = install(repository);

  assert.equal(result.action, "no-op");
});

test("refuses incomplete or inconsistent locks before mutation", () => {
  for (const lock of [{ skill: "update-ddduck-specs" }, { schemaVersion: 1, skill: "other" }]) {
    const repository = makeRepository();
    const lockPath = path.join(repository, lockRelativePath);
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(lock)}\n`);

    assert.throws(() => install(repository), /Incomplete or inconsistent skill lock: .*agent-skills\.lock\.json/);
    assert.equal(existsSync(path.join(repository, canonicalRelativePath)), false);
  }
});

test("refuses a missing packaged skill asset before mutation", () => {
  const repository = makeRepository();

  assert.throws(() => install(repository, path.join(repository, "missing", "SKILL.md")), /Missing bundled skill asset/);
  assert.equal(existsSync(path.join(repository, canonicalRelativePath)), false);
  assert.equal(existsSync(path.join(repository, lockRelativePath)), false);
});

test("does not write a lock when canonical installation fails", () => {
  const repository = makeRepository();

  assert.throws(
    () =>
      installSkill({
        repository,
        skillName: "update-ddduck-specs",
        skillPath: bundledSkill,
        packageVersion: "test-version",
        operations: {
          renameSync: () => {
            throw new Error("simulated rename failure");
          },
        },
      }),
    /simulated rename failure/,
  );
  assert.equal(existsSync(path.join(repository, lockRelativePath)), false);
});

test("restores an upgraded canonical skill when lock writing fails", () => {
  const repository = makeRepository();
  const original = makeBundle("original skill\n");
  const updated = makeBundle("updated skill\n");
  install(repository, original);
  const canonicalPath = path.join(repository, canonicalRelativePath);
  const lockPath = path.join(repository, lockRelativePath);
  const lockBefore = readFileSync(lockPath, "utf8");
  let renameCalls = 0;

  const error = captureError(() =>
    installSkill({
      repository,
      skillName: "update-ddduck-specs",
      skillPath: updated,
      packageVersion: "test-version",
      operations: {
        renameSync: (...args) => {
          renameCalls += 1;
          if (renameCalls === 2) throw new Error("simulated lock rename failure");
          return renameSync(...args);
        },
      },
    }),
  );

  assert.match(error.message, /simulated lock rename failure/);
  assert.match(error.message, new RegExp(escapeRegex(lockPath)));
  assert.equal(readFileSync(canonicalPath, "utf8"), "original skill\n");
  assert.equal(readFileSync(lockPath, "utf8"), lockBefore);
  assert.deepEqual(temporaryFiles(repository), []);
});

test("cleans up newly created canonical and Claude adapter when lock writing fails", () => {
  const repository = makeRepository();
  let renameCalls = 0;

  const error = captureError(() =>
    installSkill({
      repository,
      skillName: "update-ddduck-specs",
      skillPath: bundledSkill,
      packageVersion: "test-version",
      operations: {
        renameSync: (...args) => {
          renameCalls += 1;
          if (renameCalls === 2) throw new Error("simulated lock rename failure");
          return renameSync(...args);
        },
      },
    }),
  );

  assert.match(error.message, /simulated lock rename failure/);
  assert.doesNotMatch(error.message, /Recovery failures/);
  assert.equal(pathExists(path.join(repository, canonicalRelativePath)), false);
  assert.equal(pathExists(path.join(repository, codexAdapterRelativePath)), false);
  assert.equal(pathExists(path.join(repository, claudeRelativePath)), false);
  assert.equal(pathExists(path.join(repository, lockRelativePath)), false);
  assert.deepEqual(temporaryFiles(repository), []);

  const retried = install(repository);

  assert.equal(retried.action, "create");
  assert.equal(readFileSync(path.join(repository, canonicalRelativePath), "utf8"), readFileSync(bundledSkill, "utf8"));
});

test("cleans up both shared-topology adapters when lock writing fails and allows a healthy retry", () => {
  const repository = makeRepository();
  mkdirSync(path.join(repository, ".agents"));
  mkdirSync(path.join(repository, ".claude"));
  let renameCalls = 0;

  const error = captureError(() =>
    installSkill({
      repository,
      skillName: "update-ddduck-specs",
      skillPath: bundledSkill,
      packageVersion: "test-version",
      operations: {
        renameSync: (...args) => {
          renameCalls += 1;
          if (renameCalls === 2) throw new Error("simulated lock rename failure");
          return renameSync(...args);
        },
      },
    }),
  );

  assert.match(error.message, /simulated lock rename failure/);
  assert.doesNotMatch(error.message, /Recovery failures/);
  assert.equal(pathExists(path.join(repository, codexAdapterRelativePath)), false);
  assert.equal(pathExists(path.join(repository, claudeRelativePath)), false);
  assert.equal(pathExists(path.join(repository, lockRelativePath)), false);
  assert.deepEqual(temporaryFiles(repository), []);

  const retried = install(repository);

  assert.equal(retried.action, "create");
  assert.equal(lstatSync(path.join(repository, claudeRelativePath)).isSymbolicLink(), true);
  assert.equal(
    readFileSync(path.join(repository, claudeCanonicalRelativePath), "utf8"),
    readFileSync(bundledSkill, "utf8"),
  );
});

test("reports recovery failure alongside a lock-write failure", () => {
  const repository = makeRepository();
  const original = makeBundle("original skill\n");
  const updated = makeBundle("updated skill\n");
  install(repository, original);
  let renameCalls = 0;

  const error = captureError(() =>
    installSkill({
      repository,
      skillName: "update-ddduck-specs",
      skillPath: updated,
      packageVersion: "test-version",
      operations: {
        renameSync: (...args) => {
          renameCalls += 1;
          if (renameCalls === 2) throw new Error("simulated lock rename failure");
          if (renameCalls === 3) throw new Error("simulated rollback rename failure");
          return renameSync(...args);
        },
      },
    }),
  );

  assert.match(error.message, /simulated lock rename failure/);
  assert.match(error.message, /simulated rollback rename failure/);
  assert.deepEqual(temporaryFiles(repository), []);
});

function install(repository, skillPath = bundledSkill) {
  return installSkill({
    repository,
    skillName: "update-ddduck-specs",
    skillPath,
    packageVersion: "test-version",
  });
}

function makeRepository() {
  return mkdtempSync(path.join(tmpdir(), "ddduck-skill-installer-"));
}

function makeBundle(content, files = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "ddduck-skill-bundle-"));
  const skillPath = path.join(directory, "SKILL.md");
  writeFileSync(skillPath, content);
  for (const [relativePath, bytes] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, bytes);
  }
  return skillPath;
}

function temporaryFiles(repository) {
  return [
    ...readdirIfPresent(path.join(repository, ".agents", "skills", "update-ddduck-specs")),
    ...readdirIfPresent(path.join(repository, ".ddduck")),
  ].filter((name) => name.endsWith(".tmp"));
}

function readdirIfPresent(directory) {
  try {
    return readdirSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathExists(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function captureError(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  assert.fail("Expected installation to fail");
}

function assertBundleLock(lock, result, canonicalPath, adapters) {
  assert.equal(lock.schemaVersion, 2);
  assert.equal(lock.skill, "update-ddduck-specs");
  assert.equal(lock.ddduckVersion, "test-version");
  assert.equal(lock.canonicalPath, canonicalPath);
  assert.equal(lock.skillSha256, result.skillSha256);
  assert.equal(lock.bundleSha256, result.bundleSha256);
  assert.deepEqual(lock.adapters, adapters);
  assert.deepEqual(
    lock.files.map(({ path: relativePath }) => relativePath),
    [
      "SKILL.md",
      "references/authoring-and-verification.md",
      "references/modeling-and-evidence.md",
      "references/reviewing-changes.md",
    ],
  );
}
