/**
 * Delegation for `ddduck install skill`. ddduck installs nothing itself: it
 * builds the `npx skills add` command for the bundled skills directory, prints
 * that command verbatim, confirms it on standard input unless --yes was
 * passed, then runs it as a child process whose output streams through and
 * whose exit status is propagated. The `skills` CLI owns the host topology
 * (canonical copy plus per-agent symlinks) and its own installation state.
 */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";
import { shellQuote } from "./context-pack.mjs";

const defaultOperations = { spawnSync, readAnswer };

/**
 * Build the delegated command: every bundled skill, project scope, and no
 * second confirmation inside the child (ddduck already confirmed the printed
 * command). `npx --yes` keeps an uncached `skills` from prompting to install.
 * @param {string} skillsDirectory - Absolute path of the bundled skills directory.
 * @returns {{command: string, args: string[]}} The command and its argument vector.
 */
export function buildSkillsAddCommand(skillsDirectory) {
  return { command: "npx", args: ["--yes", "skills", "add", skillsDirectory, "--skill", "*", "-y"] };
}

/**
 * Render the delegated command as one copy-pasteable shell line.
 * @param {string} skillsDirectory - Absolute path of the bundled skills directory.
 * @returns {string} The command line, shell-quoted where needed.
 */
export function renderSkillsAddCommand(skillsDirectory) {
  const { command, args } = buildSkillsAddCommand(skillsDirectory);
  return [command, ...args].map(shellQuote).join(" ");
}

/**
 * Print the delegated command, confirm it unless --yes was passed, and run it
 * in the target repository.
 * @param {{skillsDirectory: string, repository: string, assumeYes?: boolean, stdout?: {write: (chunk: string) => unknown}, operations?: {spawnSync?: Function, readAnswer?: Function}}} options - Bundled skills directory, repository to install into, confirmation bypass, output stream, and child-process/stdin overrides for tests.
 * @returns {{status: number}} The delegated command's exit status (1 when it was killed by a signal).
 */
export function delegateSkillInstall({
  skillsDirectory,
  repository,
  assumeYes = false,
  stdout = process.stdout,
  operations = {},
}) {
  const resolvedOperations = { ...defaultOperations, ...operations };
  const { command, args } = buildSkillsAddCommand(skillsDirectory);

  stdout.write(`install skill delegates to the skills CLI; ddduck runs this command in ${repository}:\n`);
  stdout.write(`${renderSkillsAddCommand(skillsDirectory)}\n`);
  if (!assumeYes) {
    stdout.write("Run it? [y/n] ");
    const answer = resolvedOperations.readAnswer();
    if (answer !== "y" && answer !== "Y") throw declinedConfirmation();
  }

  const result = resolvedOperations.spawnSync(command, args, { cwd: repository, stdio: "inherit" });
  if (result.error) {
    const error = new Error(`Failed to run the skills CLI via npx: ${result.error.message}`);
    error.nextAction = "Make sure npx (Node.js) is on PATH, then re-run the printed command yourself.";
    throw error;
  }
  // A signal-killed child reports a null status; the CLI still has to exit
  // nonzero, because nothing was necessarily installed.
  return { status: Number.isInteger(result.status) ? result.status : 1 };
}

// A declined confirmation is neither an input error nor a host-state error:
// nothing was touched, and the only two ways forward are the flag or the
// printed command.
function declinedConfirmation() {
  const error = new Error("install skill declined at the confirmation prompt; nothing was installed");
  error.nextAction = "Re-run with --yes to skip the confirmation, or run the printed command yourself.";
  return error;
}

/**
 * Read one answer line from standard input synchronously, one byte at a time,
 * so the prompt works on a terminal without switching the synchronous CLI to
 * an asynchronous readline. A closed or exhausted stdin yields an empty
 * answer, which declines.
 * @returns {string} The trimmed answer (empty at end of input).
 */
function readAnswer() {
  const buffer = Buffer.alloc(1);
  let answer = "";
  for (;;) {
    let bytesRead;
    try {
      bytesRead = readSync(0, buffer, 0, 1, null);
    } catch (error) {
      // A non-blocking terminal has nothing to give yet; EOF ends the answer.
      if (error.code === "EAGAIN") continue;
      if (error.code === "EOF") break;
      throw error;
    }
    if (bytesRead === 0) break;
    const character = buffer.toString("utf8");
    if (character === "\n" || character === "\r") break;
    answer += character;
  }
  return answer.trim();
}
