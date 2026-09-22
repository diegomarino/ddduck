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
import { installBundledSkills, installSkill, listBundledSkills } from "../scripts/lib/skill-installer.mjs";

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
  assert.deepEqual(JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8")), {
    schemaVersion: 2,
    skills: [
      {
        skill: "update-ddduck-specs",
        ddduckVersion: "test-version",
        canonicalPath: ".agents/skills/update-ddduck-specs/SKILL.md",
        skillSha256: result.skillSha256,
        adapters: [{ host: "codex", path: ".agents/skills/update-ddduck-specs" }],
      },
    ],
  });
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
  assert.deepEqual(JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8")), {
    schemaVersion: 2,
    skills: [
      {
        skill: "update-ddduck-specs",
        ddduckVersion: "test-version",
        canonicalPath: ".claude/skills/update-ddduck-specs/SKILL.md",
        skillSha256: result.skillSha256,
        adapters: [{ host: "claude-code", path: ".claude/skills/update-ddduck-specs" }],
      },
    ],
  });
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

test("upgrades a clean managed snapshot when the bundled skill changes", () => {
  const repository = makeRepository();
  const original = makeBundle("original skill\n");
  const updated = makeBundle("updated skill\n");
  install(repository, original);

  const result = install(repository, updated);

  assert.equal(result.action, "upgrade");
  assert.equal(readFileSync(path.join(repository, canonicalRelativePath), "utf8"), "updated skill\n");
  assert.equal(
    JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8")).skills[0].skillSha256,
    result.skillSha256,
  );
});

test("refuses to overwrite a locally modified managed snapshot and states the exit", () => {
  const repository = makeRepository();
  install(repository);
  const canonicalPath = path.join(repository, canonicalRelativePath);
  writeFileSync(canonicalPath, "local modification\n");

  const error = captureError(() => install(repository));

  assert.match(error.message, /Locally modified canonical skill: .*SKILL\.md/);
  assert.match(error.nextAction, /Revert or remove .*SKILL\.md, then re-run ddduck install skill update-ddduck-specs/);
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
  assert.equal(lock.skills[0].canonicalPath.includes("\\"), false);
  lock.skills[0].canonicalPath = ".agents\\skills\\update-ddduck-specs\\SKILL.md";
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const result = install(repository);

  assert.equal(result.action, "no-op");
});

test("refuses incomplete or inconsistent locks before mutation", () => {
  for (const lock of [
    { skill: "update-ddduck-specs" },
    { schemaVersion: 1, skill: "other" },
    { schemaVersion: 2, skills: [{ skill: "other" }] },
    { schemaVersion: 2, skill: "update-ddduck-specs" },
  ]) {
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

test("discovers every bundled skill directory that carries a SKILL.md", () => {
  assert.deepEqual(listBundledSkills(path.join(root, "skills")), ["update-ddduck-specs"]);

  const skillsRoot = makeSkillsRoot({ zulu: "zulu skill\n", alpha: "alpha skill\n" });
  mkdirSync(path.join(skillsRoot, "no-skill-file"), { recursive: true });
  writeFileSync(path.join(skillsRoot, "README.md"), "not a skill\n");

  assert.deepEqual(listBundledSkills(skillsRoot), ["alpha", "zulu"]);
  assert.deepEqual(listBundledSkills(path.join(skillsRoot, "missing")), []);
});

test("installs every bundled skill under one lock with one entry per skill", () => {
  const repository = makeRepository();
  const skillsRoot = makeSkillsRoot({ zulu: "zulu skill\n", alpha: "alpha skill\n" });

  const outcomes = installBundled(repository, skillsRoot);

  assert.deepEqual(
    outcomes.map(({ skill, action }) => [skill, action]),
    [
      ["alpha", "create"],
      ["zulu", "create"],
    ],
  );
  for (const skill of ["alpha", "zulu"]) {
    assert.equal(
      readFileSync(path.join(repository, ".agents", "skills", skill, "SKILL.md"), "utf8"),
      `${skill} skill\n`,
    );
  }
  const lock = JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8"));
  assert.equal(lock.schemaVersion, 2);
  assert.deepEqual(
    lock.skills.map(({ skill, canonicalPath }) => [skill, canonicalPath]),
    [
      ["alpha", ".agents/skills/alpha/SKILL.md"],
      ["zulu", ".agents/skills/zulu/SKILL.md"],
    ],
  );

  const repeated = installBundled(repository, skillsRoot);

  assert.deepEqual(
    repeated.map(({ action }) => action),
    ["no-op", "no-op"],
  );
});

test("installs the remaining skills when one skill conflicts, and names the failure", () => {
  const repository = makeRepository();
  const skillsRoot = makeSkillsRoot({ alpha: "alpha skill\n", zulu: "zulu skill\n" });
  const blocked = path.join(repository, ".agents", "skills", "alpha", "SKILL.md");
  mkdirSync(path.dirname(blocked), { recursive: true });
  writeFileSync(blocked, "user skill\n");

  const outcomes = installBundled(repository, skillsRoot);

  assert.equal(outcomes[0].skill, "alpha");
  assert.match(outcomes[0].error.message, /Conflicting canonical skill destination: .*alpha.*SKILL\.md/);
  assert.match(outcomes[0].error.nextAction, /re-run ddduck install skill alpha/);
  assert.equal(readFileSync(blocked, "utf8"), "user skill\n");
  assert.equal(outcomes[1].action, "create");
  assert.equal(readFileSync(path.join(repository, ".agents", "skills", "zulu", "SKILL.md"), "utf8"), "zulu skill\n");
  const lock = JSON.parse(readFileSync(path.join(repository, lockRelativePath), "utf8"));
  assert.deepEqual(
    lock.skills.map(({ skill }) => skill),
    ["zulu"],
  );
});

test("reads a version-1 single-skill lock and migrates it on the next write", () => {
  const repository = makeRepository();
  const skillsRoot = makeSkillsRoot({ alpha: "alpha skill\n", zulu: "zulu skill\n" });
  installBundledSkills({
    repository,
    skillsRoot,
    skillNames: ["alpha"],
    packageVersion: "test-version",
  });
  const lockPath = path.join(repository, lockRelativePath);
  const [migrated] = JSON.parse(readFileSync(lockPath, "utf8")).skills;
  writeFileSync(lockPath, `${JSON.stringify({ schemaVersion: 1, ...migrated }, null, 2)}\n`);
  const legacyLock = readFileSync(lockPath, "utf8");

  const unchanged = installBundledSkills({
    repository,
    skillsRoot,
    skillNames: ["alpha"],
    packageVersion: "test-version",
  });

  assert.equal(unchanged[0].action, "no-op");
  assert.equal(readFileSync(lockPath, "utf8"), legacyLock, "a no-op must not rewrite the lock");

  const outcomes = installBundled(repository, skillsRoot);

  assert.deepEqual(
    outcomes.map(({ action }) => action),
    ["no-op", "create"],
  );
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.equal(lock.schemaVersion, 2);
  assert.deepEqual(lock.skills, [migrated, { ...lock.skills[1] }]);
  assert.equal(lock.skills[1].skill, "zulu");
});

function installBundled(repository, skillsRoot) {
  return installBundledSkills({
    repository,
    skillsRoot,
    skillNames: listBundledSkills(skillsRoot),
    packageVersion: "test-version",
  });
}

function makeSkillsRoot(skills) {
  const skillsRoot = mkdtempSync(path.join(tmpdir(), "ddduck-skill-bundle-root-"));
  for (const [name, content] of Object.entries(skills)) {
    mkdirSync(path.join(skillsRoot, name), { recursive: true });
    writeFileSync(path.join(skillsRoot, name, "SKILL.md"), content);
  }
  return skillsRoot;
}

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

function makeBundle(content) {
  const directory = mkdtempSync(path.join(tmpdir(), "ddduck-skill-bundle-"));
  const skillPath = path.join(directory, "SKILL.md");
  writeFileSync(skillPath, content);
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
