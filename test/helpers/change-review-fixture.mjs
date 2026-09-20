import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { parse, stringify } from "yaml";

const example = fileURLToPath(new URL("../../examples/reminders/ddd/", import.meta.url));

export function editFixtureNode(root, relativePath, edit) {
  const target = path.join(root, relativePath);
  const node = parse(readFileSync(target, "utf8"));
  edit(node);
  writeFileSync(target, stringify(node));
}

export function createChangeReviewFixture(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "ddduck diff ' $fixture-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const beforeRoot = path.join(directory, "before");
  const afterRoot = path.join(directory, "after");
  cpSync(example, beforeRoot, { recursive: true });
  rmSync(path.join(beforeRoot, "generated"), { recursive: true, force: true });
  writeFileSync(
    path.join(beforeRoot, "model/guarantees/members-ac-05.yaml"),
    stringify({
      schemaVersion: "1",
      kind: "Guarantee",
      id: "MEMBERS-AC-05",
      model: "model:members-reminders",
      ownerDomain: "domain:members",
      classification: "acceptance-criterion",
      statement: "A member can receive a reminder.",
      status: "active",
    }),
  );
  editFixtureNode(beforeRoot, "model/domains/members.yaml", (node) => node.guarantees.push("MEMBERS-AC-05"));
  cpSync(beforeRoot, afterRoot, { recursive: true });
  editFixtureNode(afterRoot, "model/guarantees/members-ac-05.yaml", (node) => {
    node.ownerDomain = "domain:reminders";
    node.ownershipHistory = ["domain:members"];
  });
  editFixtureNode(afterRoot, "model/domains/members.yaml", (node) => {
    node.guarantees = node.guarantees.filter((id) => id !== "MEMBERS-AC-05");
  });
  editFixtureNode(afterRoot, "model/domains/reminders.yaml", (node) => node.guarantees.push("MEMBERS-AC-05"));
  mkdirSync(path.join(afterRoot, "generated"), { recursive: true });
  writeFileSync(path.join(afterRoot, "generated/stale.txt"), "stale generated output\n");
  return { beforeRoot, afterRoot };
}
