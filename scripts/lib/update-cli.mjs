import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CliUsageError } from "./cli-contract.mjs";
import { shellQuote } from "./context-pack.mjs";
import { readAnswer } from "./skill-delegation.mjs";

/** Update this npm-global installation, after showing and confirming the exact command. */
export function updateCli({ frameworkRoot, assumeYes = false }) {
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new CliUsageError("update supports macOS and Linux only", {
      nextAction: "Update ddduck through your package manager on this platform.",
    });
  }
  const prefix = npmOutput(["prefix", "--global"]);
  if (!path.isAbsolute(prefix)) throw new CliUsageError("npm returned an invalid global prefix");
  const globalRoot = npmOutput(["root", "--global", "--prefix", prefix]);
  if (!path.isAbsolute(globalRoot)) throw new CliUsageError("npm returned an invalid global package directory");
  const installedRoot = path.join(globalRoot, "ddduck");
  try {
    if (lstatSync(installedRoot).isSymbolicLink()) {
      throw new CliUsageError("This ddduck is an npm-linked checkout; update its source with Git");
    }
    if (realpathSync(installedRoot) !== realpathSync(frameworkRoot)) {
      throw new CliUsageError(
        "This executable is not the npm global installation; update its checkout or project dependency with its package manager",
      );
    }
  } catch (error) {
    if (error.code === "ENOENT")
      throw new CliUsageError(
        "This executable is not an npm global installation; update its checkout or project dependency with its package manager",
      );
    throw error;
  }
  const current = JSON.parse(readFileSync(path.join(frameworkRoot, "package.json"), "utf8")).version;
  const currentParts = releaseParts(current);
  let latest;
  try {
    latest = JSON.parse(npmOutput(["view", "--global", "--prefix", prefix, "ddduck@latest", "version", "--json"]));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new CliUsageError("npm returned invalid JSON for the latest ddduck version");
  }
  const latestParts = releaseParts(latest);
  process.stdout.write(`Installed: ddduck ${current}\nAvailable: ddduck ${latest}\n`);
  const difference = latestParts.findIndex((part, index) => part !== currentParts[index]);
  if (difference === -1) {
    process.stdout.write("ddduck is already up to date.\n");
    return;
  }
  if (latestParts[difference] < currentParts[difference]) {
    process.stdout.write("The installed version is newer than latest; no downgrade performed.\n");
    return;
  }
  const args = ["install", "--global", "--prefix", prefix, "--engine-strict", "--force=false", `ddduck@${latest}`];
  process.stdout.write(`${["npm", ...args].map(shellQuote).join(" ")}\n`);
  if (!assumeYes) {
    process.stdout.write("Run it? [y/n] ");
    if (readAnswer().toLowerCase() !== "y") {
      throw new CliUsageError("update declined; nothing was installed", {
        nextAction: "Run ddduck update --yes to accept the displayed update without prompting.",
      });
    }
  }
  const installation = spawnSync("npm", args, { stdio: "inherit" });
  if (installation.error || installation.status !== 0) {
    throw new CliUsageError(
      `npm update failed: ${installation.error?.message ?? `exit status ${installation.status ?? installation.signal}`}`,
      { nextAction: "Inspect the npm diagnostic and retry the printed command when the issue is resolved." },
    );
  }
  const verification = spawnSync(
    process.execPath,
    [path.join(installedRoot, "scripts", "ddduck.mjs"), "--version", "--json"],
    { encoding: "utf8", timeout: 30000 },
  );
  let updated;
  try {
    updated = JSON.parse(verification.stdout);
  } catch {
    /* The verification error below covers invalid output. */
  }
  if (verification.error || verification.status !== 0 || updated?.name !== "ddduck" || updated?.version !== latest) {
    throw new CliUsageError(`npm finished, but the installed CLI could not be verified as ddduck ${latest}`, {
      nextAction: "Run ddduck --version and inspect the npm installation before retrying.",
    });
  }
  process.stdout.write(
    `Updated ddduck ${current} -> ${latest}.\nTo refresh your project's agent skill, run ddduck install skill.\n`,
  );
}

function npmOutput(args) {
  const result = spawnSync("npm", args, { encoding: "utf8", timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new CliUsageError(
      `npm ${args[0]} failed: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`,
      {
        nextAction: "Check that npm is available and its registry and global configuration are accessible, then retry.",
      },
    );
  }
  return result.stdout.trim();
}

function releaseParts(version) {
  // ponytail: stable releases only; use npm directly for prerelease updates.
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new CliUsageError(
      `Unsupported release version ${JSON.stringify(version)}; update stable releases here, or use your package manager for prereleases`,
    );
  }
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw new CliUsageError("Release version components exceed the supported numeric range");
  return parts;
}
