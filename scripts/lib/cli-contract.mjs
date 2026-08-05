export class CliUsageError extends Error {
  constructor(message, { nextAction } = {}) {
    super(message);
    this.name = "CliUsageError";
    if (nextAction !== undefined) this.nextAction = nextAction;
  }
}

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

export function renderHelp(command) {
  const usage = {
    undefined: [
      "Usage: ddduck <command> [options]",
      "Commands: init, check, generate, query, install, create, move, split, retire.",
      "Run `ddduck <command> --help` for command usage.",
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
      "Success output: none.",
      "Exit status: 0 on a valid fresh product or help; nonzero on invalid source, stale views, leftover interrupted-operation state, or invalid input.",
      "JSON: unavailable; --json is not accepted.",
    ],
    generate: [
      "Syntax: ddduck generate [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery); text output is used.",
      "Writes: all required generated docs and graph views after staged validation.",
      "Success output: one text result with the root and refreshed generated paths.",
      "Exit status: 0 on publication or help; nonzero with no intended product changes on failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    query: [
      "Syntax: ddduck query <node|neighbors|impact|anchors|spec|context> [options] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery) except context requires it; --history is false.",
      "Writes: nothing.",
      "Success output: exactly one JSON query document.",
      "Exit status: 0 on a resolved query or help; nonzero on invalid input, product, or selection.",
      "JSON: output is always JSON; --json is accepted and has no effect.",
      "Options: --id <model-node-id> (repeatable for context), --root <product-root>, --history.",
    ],
    install: [
      "Syntax: ddduck install skill update-ddduck-specs [--repo <repository-root>]",
      "Defaults: --repo is the current directory.",
      "Writes: the selected host skill adapter and .ddduck/agent-skills.lock.json in --repo.",
      "Success output: one text result with the action (created, upgraded, or no-op), repository, canonical path, and lock path.",
      "Exit status: 0 on installation, no-op, or help; nonzero on invalid input or conflicting host state.",
      "JSON: unavailable; --json is not accepted.",
    ],
    create: [
      "Syntax: ddduck create guarantee --origin <origin> --classification <invariant|acceptance-criterion> --owner <domain-id> --statement <text> [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery); the next origin/classification serial is allocated.",
      "Writes: the new Guarantee, its owning Domain, and all generated views through staged publication.",
      "Success output: one text result with the allocated ID, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; nonzero with no intended product changes on failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    move: [
      "Syntax: ddduck move guarantee <guarantee-id> --to <domain-id> [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery).",
      "Writes: the Guarantee, affected Domains, and all generated views through staged publication.",
      "Success output: one text result with affected IDs, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; nonzero with no intended product changes on failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    split: [
      "Syntax: ddduck split guarantee <guarantee-id> --into <successor-id,successor-id> --decision ADR-NNN [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery).",
      "Writes: the source Guarantee lifecycle state and all generated views through staged publication.",
      "Success output: one text result with affected IDs, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; nonzero with no intended product changes on failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    retire: [
      "Syntax: ddduck retire guarantee <guarantee-id> --decision ADR-NNN [--root <product-root>] [--json]",
      "Defaults: --root is the resolved product root (enclosing directory, config, or unique discovery).",
      "Writes: the Guarantee lifecycle state and all generated views through staged publication.",
      "Success output: one text result with affected IDs, root, canonical paths, and generated paths.",
      "Exit status: 0 on publication or help; nonzero with no intended product changes on failure.",
      "JSON: --json emits the same result as one JSON object.",
    ],
    "audit-fr-to-code": [
      "Usage: audit-fr-to-code --input <audit.yaml> --source-root <source-id>=<checkout> [--source-root <source-id>=<checkout> ...] --json",
    ],
  };
  return `${(usage[command] ?? usage.undefined).join("\n")}\n`;
}

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

export function writeCliError(error, { stderr = process.stderr, nextAction } = {}) {
  stderr.write(`${formatCliError(error, { nextAction })}\n`);
  process.exitCode = 1;
}
