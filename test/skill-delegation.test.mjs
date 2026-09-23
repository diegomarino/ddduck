import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkillsAddCommand,
  delegateSkillInstall,
  renderSkillsAddCommand,
} from "../scripts/lib/skill-delegation.mjs";

test("the delegated command installs every bundled skill into the project without prompting again", () => {
  const { command, args } = buildSkillsAddCommand("/packages/ddduck/skills");

  assert.equal(command, "npx");
  assert.deepEqual(args, ["--yes", "skills", "add", "/packages/ddduck/skills", "--skill", "*", "-y"]);
  assert.ok(!args.includes("-g"), "the delegated install must stay project-scoped");
  assert.ok(!args.includes("--copy"), "the delegated install must keep the canonical-copy-plus-symlink topology");
});

test("the printed command is the executed command, shell-quoted for copy-paste", () => {
  const { args } = buildSkillsAddCommand("/with space/skills");

  assert.equal(
    renderSkillsAddCommand("/with space/skills"),
    `npx --yes skills add '/with space/skills' --skill '*' -y`,
  );
  assert.equal(args[3], "/with space/skills", "the executed path must stay unquoted; only the printout is quoted");
});

test("confirmation runs the printed command in the repository and reports success", () => {
  const stdout = captureStream();
  const calls = [];
  const result = delegateSkillInstall({
    skillsDirectory: "/packages/ddduck/skills",
    repository: "/repo",
    stdout,
    operations: {
      readAnswer: () => "y",
      spawnSync: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0 };
      },
    },
  });

  assert.deepEqual(result, { status: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "npx");
  assert.deepEqual(calls[0].args, buildSkillsAddCommand("/packages/ddduck/skills").args);
  assert.equal(calls[0].options.cwd, "/repo");
  assert.equal(calls[0].options.stdio, "inherit");
  assert.match(stdout.text, /npx --yes skills add \/packages\/ddduck\/skills --skill '\*' -y\n/);
  assert.match(stdout.text, /\[y\/n\]/);
});

test("an uppercase Y confirms too", () => {
  let spawned = 0;
  delegateSkillInstall({
    skillsDirectory: "/skills",
    repository: "/repo",
    stdout: captureStream(),
    operations: {
      readAnswer: () => "Y",
      spawnSync: () => {
        spawned += 1;
        return { status: 0 };
      },
    },
  });

  assert.equal(spawned, 1);
});

test("any answer other than y aborts with no side effects and a next action naming --yes", () => {
  for (const answer of ["n", "N", "", "yes", "q"]) {
    const stdout = captureStream();
    assert.throws(
      () =>
        delegateSkillInstall({
          skillsDirectory: "/skills",
          repository: "/repo",
          stdout,
          operations: {
            readAnswer: () => answer,
            spawnSync: () => assert.fail(`answer ${JSON.stringify(answer)} must not run the delegated command`),
          },
        }),
      (error) => {
        assert.match(error.message, /declined/);
        assert.match(error.nextAction, /--yes/);
        return true;
      },
      `answer ${JSON.stringify(answer)} must abort`,
    );
    assert.match(stdout.text, /npx --yes skills add/, "the command must be printed before the prompt");
  }
});

test("--yes skips the confirmation so the command stays usable in CI and by agents", () => {
  const stdout = captureStream();
  let spawned = 0;
  const result = delegateSkillInstall({
    skillsDirectory: "/skills",
    repository: "/repo",
    assumeYes: true,
    stdout,
    operations: {
      readAnswer: () => assert.fail("--yes must not read stdin"),
      spawnSync: () => {
        spawned += 1;
        return { status: 0 };
      },
    },
  });

  assert.deepEqual(result, { status: 0 });
  assert.equal(spawned, 1);
  assert.match(stdout.text, /npx --yes skills add/, "--yes still prints the command it runs");
  assert.ok(!stdout.text.includes("[y/n]"));
});

test("the delegated exit status is propagated, including a signal-killed child", () => {
  const run = (outcome) =>
    delegateSkillInstall({
      skillsDirectory: "/skills",
      repository: "/repo",
      assumeYes: true,
      stdout: captureStream(),
      operations: { spawnSync: () => outcome },
    });

  assert.deepEqual(run({ status: 3 }), { status: 3 });
  assert.deepEqual(run({ status: null, signal: "SIGKILL" }), { status: 1 });
});

test("a delegated command that never starts names npx instead of reporting success", () => {
  assert.throws(
    () =>
      delegateSkillInstall({
        skillsDirectory: "/skills",
        repository: "/repo",
        assumeYes: true,
        stdout: captureStream(),
        operations: { spawnSync: () => ({ error: new Error("spawn npx ENOENT") }) },
      }),
    (error) => {
      assert.match(error.message, /npx/);
      assert.match(error.nextAction, /Node\.js|npx/);
      return true;
    },
  );
});

function captureStream() {
  return {
    text: "",
    write(chunk) {
      this.text += chunk;
      return true;
    },
  };
}
