import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectViews, renderView } from "../scripts/lib/archify-export.mjs";
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
test("complete models distribute sibling nodes across both dimensions without overlapping cards", async () => {
  const graph = { nodes: [{ id: "m", kind: "Model", name: "Branched model" }], edges: [] };
  for (let d = 0; d < 4; d++) {
    const domain = `domain:${d}`;
    graph.nodes.push({ id: domain, kind: "Domain", name: `Domain ${d}` });
    graph.edges.push({ id: `domain-edge-${d}`, from: "m", to: domain, kind: "owns", label: "owns" });
    for (let c = 0; c < 8; c++) {
      const id = `concept:${d}-${c}`;
      graph.nodes.push({ id, kind: "Concept", name: `Concept ${c}`, ownerDomain: domain });
      graph.edges.push({ id: `concept-edge-${d}-${c}`, from: domain, to: id, kind: "owns", label: "owns" });
    }
  }
  const rendered = await renderView(projectViews(graph)[0], graph);
  assert.ok(rendered.height / rendered.width < 2, "Complete model should not form a tall column");
  assert.ok(rendered.width / rendered.height < 2, "Complete model should not form a wide strip");
  const cards = [...rendered.svg.matchAll(/<g id="node-[\s\S]*?<\/g>/g)].map(([node]) => {
    const [, x, y, width, height] = node.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
    return [x, y, width, height].map(Number);
  });
  assert.equal(cards.length, graph.nodes.length);
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const [x, y, w, h] = cards[i],
        [otherX, otherY, otherW, otherH] = cards[j];
      assert.ok(x + w <= otherX || otherX + otherW <= x || y + h <= otherY || otherY + otherH <= y);
    }
  }
});
for (const file of [
  "docs/ddd/generated/graph/model-graph.json",
  "examples/reminders/ddd/generated/graph/model-graph.json",
]) {
  test(`preserves every node and relationship from ${file}`, async () => {
    const graph = load(file),
      views = projectViews(graph);
    assert.deepEqual(views[0].nodes, graph.nodes);
    assert.deepEqual(views[0].edges, graph.edges);
    const details = views.slice(2);
    assert.equal(details.length, graph.nodes.filter((n) => n.kind === "Domain").length);
    assert.deepEqual(
      new Set(details.flatMap((v) => v.members)),
      new Set(graph.nodes.filter((n) => n.kind === "Domain" || n.ownerDomain).map((n) => n.id)),
    );
    for (const v of views) {
      const ids = new Set(v.nodes.map((n) => n.id));
      assert.ok(v.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
    }
    const rendered = await renderView(views[0], graph);
    assert.equal((rendered.svg.match(/data-node-id=/g) || []).length, graph.nodes.length);
    assert.equal((rendered.svg.match(/data-edge-id=/g) || []).length, rendered.connections.length);
    assert.deepEqual(new Set(rendered.connections.map((e) => e.canonicalId)), new Set(graph.edges.map((e) => e.id)));
    assert.equal((rendered.svg.match(/data-domain-id=/g) || []).length, details.length);
    assert.ok(rendered.connections.every((e) => rendered.svg.includes(`data-edge-id="${e.id}"`)));
  });
}
test("supports renamed models, empty domains and model-scope members", async () => {
  const graph = {
    modelName: "Different model",
    nodes: [
      { id: "m", kind: "Model", name: "Different model" },
      { id: "empty", kind: "Domain", name: "Empty" },
      { id: "scope", kind: "UseCase", name: "A global use case" },
    ],
    edges: [{ id: "ownership", from: "m", to: "empty", kind: "owns", label: "owns" }],
  };
  const views = projectViews(graph);
  assert.equal(views.length, 3);
  assert.deepEqual(views[2].members, ["empty"]);
  assert.deepEqual(views[2].context, ["m"]);
  assert.equal(views[1].nodes.length, 3);
  for (const view of views) assert.ok((await renderView(view, graph)).svg.includes("data-node-id"));
});
test("external relationship sources remain context, not domain members", () => {
  const views = projectViews(load("docs/ddd/generated/graph/model-graph.json"));
  for (const view of views.slice(2)) {
    for (const id of view.context) assert.ok(!view.members.includes(id));
    for (const e of view.edges) if (e.kind === "relationship") assert.ok(view.nodes.some((n) => n.id === e.source));
  }
});
test("rejects duplicate IDs and unresolved graph references", () => {
  const graph = load("examples/reminders/ddd/generated/graph/model-graph.json");
  assert.throws(() => projectViews({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }), /duplicate/i);
  assert.throws(
    () => projectViews({ ...graph, edges: [...graph.edges, { id: "bad", from: "missing", to: graph.nodes[0].id }] }),
    /unknown/i,
  );
});

test("guarantees and reference arrows use a non-error palette", async () => {
  const graph = load("examples/reminders/ddd/generated/graph/model-graph.json");
  const rendered = await renderView(projectViews(graph)[0], graph);
  const guarantees = [...rendered.svg.matchAll(/<g [^>]*data-node-kind="Guarantee"[\s\S]*?<\/g>/g)].map(
    (match) => match[0],
  );
  assert.ok(guarantees.length > 0);
  assert.ok(guarantees.every((node) => node.includes('class="c-cloud"')));
  assert.ok(!rendered.svg.includes("var(--security-stroke)"));
});

test("unnamed guarantees keep cards compact and retain their full statement in the passport", async () => {
  const graph = load("examples/reminders/ddd/generated/graph/model-graph.json");
  const guarantee = graph.nodes.find((node) => node.kind === "Guarantee" && !node.name);
  const rendered = await renderView(projectViews(graph)[0], graph);
  const index = graph.nodes.indexOf(guarantee);
  const node = rendered.svg.match(new RegExp(`<g id="node-n${index}"[\\s\\S]*?</g>`))[0];
  const visibleText = [...node.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join(" ");
  assert.ok(visibleText.includes(guarantee.id));
  assert.ok(!visibleText.includes(guarantee.purpose));
  assert.ok(node.includes(`data-node-context="${guarantee.purpose}"`));
  assert.deepEqual(rendered.components[index], {
    id: `n${index}`,
    canonicalId: guarantee.id,
    semantic_kind: "Guarantee",
    title: guarantee.id,
    description: guarantee.purpose,
  });
});

test("named guarantees show their title and ID while retaining the full statement in the passport", async () => {
  const graph = load("docs/ddd/generated/graph/model-graph.json");
  const guarantee = graph.nodes.find((node) => node.kind === "Guarantee" && node.name);
  const rendered = await renderView(projectViews(graph)[0], graph);
  const node = rendered.svg.match(new RegExp(`<g id="node-n${graph.nodes.indexOf(guarantee)}"[\\s\\S]*?</g>`))[0];
  const visible = [...node.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join(" ");
  assert.ok(visible.includes(guarantee.name));
  assert.ok(visible.includes(guarantee.id));
  assert.ok(node.includes(`data-node-tag="${guarantee.id}"`));
  assert.ok(!visible.includes(guarantee.purpose));
  assert.ok(node.includes(guarantee.purpose));
  const component = rendered.components[graph.nodes.indexOf(guarantee)];
  assert.equal(component.title, guarantee.name);
  assert.equal(component.description, guarantee.purpose);
});
