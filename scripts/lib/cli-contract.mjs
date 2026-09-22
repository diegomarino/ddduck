/**
 * The shared CLI contract for every ddduck command surface: the usage-error
 * type, the option/positional parser, the per-command --help text (including
 * the documented exit codes: 0 success, 1 failure, 2 retryable busy), and the
 * single-format error writer that always emits `Error: ...` plus a `Next:`
 * action line. Consumed by ddduck.mjs, query-model.mjs, and
 * audit-fr-to-code.mjs so agents can rely on one stable error shape.
 */

/** Invalid CLI input; may carry a nextAction line for the error writer. */
export class CliUsageError extends Error {
  constructor(message, { nextAction } = {}) {
    super(message);
    this.name = "CliUsageError";
    if (nextAction !== undefined) this.nextAction = nextAction;
  }
}

/**
 * Parse command arguments against a declared option/positional shape,
 * supporting --name value and --name=value, boolean flags, repeatable
 * options, and duplicate rejection.
 * @param {string[]} args - Arguments after the command word.
 * @param {{positionals?: {min?: number, max?: number, syntax?: string}, options?: Record<string, {value?: boolean, repeatable?: boolean}>}} [spec] - Accepted positional bounds and option definitions.
 * @returns {{positionals: string[], options: Record<string, string|string[]|boolean>}} Parsed values (booleans default false, repeatables default []).
 */
export function parseCommandArgs(args, { positionals = {}, options = {} } = {}) {
  const minimum = positionals.min ?? 0;
  const maximum = positionals.max ?? minimum;
  const parsed = {};
  for (const [name, definition] of Object.entries(options)) {
    if (!definition.value) parsed[name] = false;
    if (definition.repeatable) parsed[name] = [];
  }
  const values = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      values.push(argument);
      continue;
    }
    const separatorIndex = argument.indexOf("=");
    const name = separatorIndex === -1 ? argument.slice(2) : argument.slice(2, separatorIndex);
    const inlineValue = separatorIndex === -1 ? undefined : argument.slice(separatorIndex + 1);
    const definition = options[name];
    if (!definition) throw new CliUsageError(`Unknown option --${name}`);
    if (!definition.repeatable && (definition.value ? parsed[name] !== undefined : parsed[name])) {
      throw new CliUsageError(`Duplicate option --${name}`);
    }
    if (!definition.value) {
      if (inlineValue !== undefined) throw new CliUsageError(`Option --${name} does not take a value`);
      parsed[name] = true;
      continue;
    }
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value === "") throw new CliUsageError(`Missing value for --${name}`);
    if (inlineValue === undefined && value.startsWith("--")) {
      throw new CliUsageError(`Missing value for --${name}; pass values starting with -- as --${name}=<value>`);
    }
    if (definition.repeatable) parsed[name].push(value);
    else parsed[name] = value;
    if (inlineValue === undefined) index += 1;
  }

  if (values.length < minimum || values.length > maximum) {
    const expected = minimum === maximum ? minimum : `${minimum}-${maximum}`;
    const usage = positionals.syntax ? `; usage: ${positionals.syntax}` : "";
    throw new CliUsageError(
      `Expected ${expected} positional argument${minimum === 1 && maximum === 1 ? "" : "s"}${usage}`,
    );
  }
  return { positionals: values, options: parsed };
}

/**
 * Render the --help text for one command, or the top-level command list.
 * @param {string} [command] - Command name; unknown or absent yields the overview.
 * @returns {string} The help text, newline-terminated.
 */
export function renderHelp(command) {
  const usage = {
    undefined: [
      "Usage: ddduck <command> [options]",
      "Commands: init, check, generate, query, install, create, move, split, retire.",
      "Options: --version (-v) prints the ddduck version; --help prints usage.",
      "Run `ddduck <command> --help` for command usage.",
    ],
    version: [
      "Syntax: ddduck --version | ddduck -v [--json]",
      "Defaults: text output is used.",
      "Writes: nothing.",
      "Success output: one text line, `ddduck <version>`, naming the installed package version.",
      "Exit status: 0 on success or help; 1 on invalid input.",
      'JSON: --json emits {"name":"ddduck","version":"<version>"} as one JSON object.',
    ],
    init: [
      "Syntax: ddduck init [destination] --id model:<product-id> [--json]",
      "Defaults: destination is the productRoot configured in .ddduck/config.json, else ddd.",
      "Writes: product.yaml, canonical directories, and all generated views in the new product root.",
      "Success output: one text result with root, Model ID, canonical paths, and generated paths.",
      "Exit status: 0 on success or help; nonzero if input is invalid or the destination is not empty.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    check: [
      "Syntax: ddduck check [--root <product-root>] [--base <previous-product-root>] [--docs-root <docs-root> ...] [--source-only]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery); --base is unset; documentation references are checked inside the product root unless --docs-root replaces that scope; generated freshness is checked.",
      "Writes: nothing.",
      "Success output: none on standard output; when --root is omitted, one standard-error note names the validated root.",
      "Exit status: 0 on a valid fresh product or help; 2 when the product root is busy (operation lock held by a running process, retryable); 1 on invalid source, stale views, leftover interrupted-operation state, or invalid input.",
      "JSON: unavailable; --json is not accepted.",
    ],
    generate: [
      "Syntax: ddduck generate [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery); text output is used.",
      "Writes: all required generated docs and graph views after staged validation.",
      "Success output: one text result with the root and refreshed generated paths.",
      "Exit status: 0 on publication or help; 2 when the product root is busy (operation lock held by a running process, retryable); 1 with no intended product changes on any other failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    query: [
      "Syntax: ddduck query <node|neighbors|impact|anchors|spec|context> [options] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery); --history is false.",
      "Writes: nothing.",
      "Success output: exactly one JSON query document.",
      "Exit status: 0 on a resolved query or help; 2 when the product root is busy (operation lock held by a running process, retryable); 1 on invalid input, product, or selection.",
      "JSON: output is always JSON; --json is accepted and has no effect.",
      "Options: --id <model-node-id> (repeatable for context), --root <product-root>, --history.",
    ],
    install: [
      "Syntax: ddduck install skill [<skill-name>] [--repo <repository-root>] [--json]",
      "Defaults: --repo is the current directory; without <skill-name> every skill bundled in the package is installed.",
      "Writes: the selected host skill adapter for each installed skill and .ddduck/agent-skills.lock.json in --repo.",
      "Success output: one text result line per selected skill with the action (created, upgraded, or no-op), repository, canonical path, and lock path.",
      "Exit status: 0 when every selected skill installs, no-ops, or help; 1 on invalid input or conflicting host state, after installing the skills that had none.",
      "JSON: --json emits one JSON object with one result per selected skill.",
    ],
    create: [
      "Syntax: ddduck create guarantee --origin <origin> --classification <invariant|acceptance-criterion> --owner <domain-id> --statement <text> [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery); the next origin/classification serial is allocated.",
      "Writes: the new Guarantee, its owning Domain, and all generated views through staged publication.",
      "Success output: one text result with the allocated ID, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; 2 when the product root is busy (operation lock held by a running process, retryable); 1 with no intended product changes on any other failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    move: [
      "Syntax: ddduck move guarantee <guarantee-id> --to <domain-id> [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery).",
      "Writes: the Guarantee, affected Domains, and all generated views through staged publication.",
      "Success output: one text result with affected IDs, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; 2 when the product root is busy (operation lock held by a running process, retryable); 1 with no intended product changes on any other failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    split: [
      "Syntax: ddduck split guarantee <guarantee-id> --into <successor-id,successor-id> --decision ADR-NNN [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery).",
      "Writes: the source Guarantee lifecycle state and all generated views through staged publication.",
      "Success output: one text result with affected IDs, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; 2 when the product root is busy (operation lock held by a running process, retryable); 1 with no intended product changes on any other failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    retire: [
      "Syntax: ddduck retire guarantee <guarantee-id> --decision ADR-NNN [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery).",
      "Writes: the Guarantee lifecycle state and all generated views through staged publication.",
      "Success output: one text result with affected IDs, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; 2 when the product root is busy (operation lock held by a running process, retryable); 1 with no intended product changes on any other failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    "audit-fr-to-code": [
      "Usage: audit-fr-to-code --input <audit.yaml> --source-root <source-id>=<checkout> [--source-root <source-id>=<checkout> ...] --json",
    ],
  };
  return `${(usage[command] ?? usage.undefined).join("\n")}\n`;
}

/**
 * Format any error into the CLI contract shape: `Error: <message>` (multi-line
 * diagnostics preserved) followed by a `Next: <action>` line, preferring the
 * error's own nextAction over the caller's fallback.
 * @param {unknown} error - The thrown error or value.
 * @param {{nextAction?: string}} [options] - Fallback next action.
 * @returns {string} The formatted error text (no trailing newline).
 */
export function formatCliError(error, { nextAction } = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const action = error?.nextAction ?? nextAction ?? "Review the diagnostic, correct the input, and retry.";
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) {
    const safeMessage = (lines[0] ?? "").replace(/[.\s]+$/, "");
    return `Error: ${safeMessage}. Next: ${action}`;
  }
  return [`Error: ${lines[0]}`, ...lines.slice(1), `Next: ${action}`].join("\n");
}

/**
 * Write a formatted error to stderr and set the process exit code.
 * @param {unknown} error - The thrown error or value.
 * @param {{stderr?: {write: (chunk: string) => unknown}, nextAction?: string}} [options] - Stream override and fallback next action.
 * @returns {void}
 */
export function writeCliError(error, { stderr = process.stderr, nextAction } = {}) {
  stderr.write(`${formatCliError(error, { nextAction })}\n`);
  // Exit 1 is the default failure code; an error may carry a distinct code
  // (exit 2 marks the retryable busy case, see ProductBusyError).
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
}
