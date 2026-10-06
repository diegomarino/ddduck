import path from "node:path";
import { createInterface } from "node:readline/promises";
import { CliUsageError, parseCommandArgs } from "./cli-contract.mjs";
import { findRepositoryRoot } from "./ddduck-config.mjs";
import { resolveInitDestination } from "./product-root-resolver.mjs";

/** Resolve init answers before any filesystem mutation. */
export async function resolveInitInput(
  args,
  { cwd = process.cwd(), input = process.stdin, output = process.stderr } = {},
) {
  const { positionals, options } = parseCommandArgs(args, {
    positionals: { min: 0, max: 1 },
    options: { id: { value: true }, name: { value: true }, yes: { value: false }, json: { value: false } },
  });
  if (!options.yes) {
    if (!input.isTTY || !output.isTTY || options.json) {
      throw new CliUsageError("init requires --yes when prompts are unavailable", {
        nextAction: "Run ddduck init --yes to accept defaults, or supply --name, --id, and a destination with --yes.",
      });
    }
  }
  let name = (options.name ?? options.id?.slice("model:".length) ?? path.basename(findRepositoryRoot(cwd))).trim();
  let destination = resolveInitDestination({ cwd, explicitDestination: positionals[0] });
  let productId;
  if (!options.yes && (!options.name || !options.id || !positionals[0])) {
    const controller = new globalThis.AbortController();
    const readline = createInterface({ input, output, terminal: true });
    readline.on("SIGINT", () => controller.abort());
    readline.on("close", () => controller.abort());
    const ask = async (label, value) => {
      const answer = readline.question(`${label}: `, { signal: controller.signal });
      readline.write(value);
      return (await answer).trim();
    };
    try {
      output.write("Press Enter to accept each value, edit it to change it, or Ctrl+C to cancel.\n");
      if (!options.name) name = await ask("Product name", name);
      productId = options.id ?? (await ask("Model ID", inferredId(name)));
      if (!positionals[0]) {
        const answer = await ask("Product directory", path.relative(cwd, destination) || ".");
        if (!answer) throw new CliUsageError("Product directory must not be empty");
        destination = resolveInitDestination({ cwd, explicitDestination: answer });
      }
      controller.signal.throwIfAborted();
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      const cancelled = new CliUsageError("init cancelled; nothing was created", {
        nextAction: "Run ddduck init when you are ready.",
      });
      cancelled.exitCode = 130;
      throw cancelled;
    } finally {
      readline.close();
    }
  }
  productId ??= options.id ?? inferredId(name);
  if (!name) throw new CliUsageError("Product name must not be empty; supply --name <name>");
  if (!/^model:[a-z0-9][a-z0-9-]*$/.test(productId)) {
    throw new CliUsageError(
      `Invalid product ID ${JSON.stringify(productId)}; expected model:<lowercase-slug> (for example model:library); supply --id model:<product-id>`,
    );
  }
  return { name, productId, destination, json: options.json };
}

function inferredId(name) {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `model:${slug}`;
}
