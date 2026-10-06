import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Graphviz } from "@hpcc-js/wasm/graphviz";
const kinds = ["Model", "Domain", "Concept", "DomainInterface", "UseCase", "Guarantee", "Relationship"];
const paint = {
  Model: "cloud",
  Domain: "frontend",
  Concept: "database",
  DomainInterface: "external",
  UseCase: "backend",
  Guarantee: "cloud",
  Relationship: "messagebus",
};
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const quote = (s) => JSON.stringify(String(s));
export function projectViews(graph) {
  assert.ok(Array.isArray(graph.nodes) && Array.isArray(graph.edges), "Expected graph nodes and edges.");
  const byId = new Map();
  for (const n of graph.nodes) {
    assert.ok(typeof n.id === "string" && n.id, "Missing node ID.");
    assert.ok(!byId.has(n.id), `Duplicate node ID: ${n.id}`);
    assert.ok(kinds.includes(n.kind), `Unsupported DDD kind: ${n.kind}`);
    byId.set(n.id, n);
  }
  const model = graph.nodes.filter((n) => n.kind === "Model");
  assert.equal(model.length, 1, "Expected one Model.");
  const edgeIds = new Set();
  for (const e of graph.edges) {
    assert.ok(typeof e.id === "string" && !edgeIds.has(e.id), `Duplicate or missing edge ID: ${e.id}`);
    edgeIds.add(e.id);
    for (const id of [e.from, e.to]) assert.ok(byId.has(id), `Unknown edge endpoint: ${id}`);
    if (e.kind === "relationship")
      assert.equal(byId.get(e.source)?.kind, "Relationship", `Unknown Relationship source: ${e.source}`);
  }
  for (const n of graph.nodes)
    if (n.ownerDomain) assert.equal(byId.get(n.ownerDomain)?.kind, "Domain", `Unknown owner Domain: ${n.ownerDomain}`);
  const domains = graph.nodes.filter((n) => n.kind === "Domain");
  const full = {
    id: "complete",
    label: "Complete model",
    nodes: graph.nodes,
    edges: graph.edges,
    groups: domains.map((d) => ({
      id: d.id,
      label: d.name ?? d.id,
      members: graph.nodes.filter((n) => n.id === d.id || n.ownerDomain === d.id).map((n) => n.id),
    })),
    context: [],
  };
  const overviewNodes = graph.nodes.filter((n) => n.kind === "Model" || n.kind === "Domain" || !n.ownerDomain);
  const overviewIds = new Set(overviewNodes.map((n) => n.id));
  const endpoint = (id) => (overviewIds.has(id) ? id : byId.get(id).ownerDomain);
  const overview = {
    id: "model",
    label: "Model and domains",
    nodes: overviewNodes,
    edges: [],
    internalEdges: [],
    groups: [],
    context: [],
    summary: true,
  };
  for (const e of graph.edges) {
    const from = endpoint(e.from),
      to = endpoint(e.to);
    if (from === to) overview.internalEdges.push(e.id);
    else
      overview.edges.push({
        ...e,
        from,
        to,
        originalFrom: e.from,
        originalTo: e.to,
        projected: from !== e.from || to !== e.to,
      });
  }
  const details = domains.map((d, i) => {
    const group = full.groups.find((g) => g.id === d.id),
      local = new Set(group.members);
    const edges = graph.edges.filter((e) => local.has(e.from) || local.has(e.to) || local.has(e.source));
    const included = new Set(local);
    for (const e of edges) for (const id of [e.from, e.to, e.source]) if (byId.has(id)) included.add(id);
    return {
      id: `domain-${i}`,
      domain: d.id,
      label: d.name ?? d.id,
      nodes: graph.nodes.filter((n) => included.has(n.id)),
      members: group.members,
      context: [...included].filter((id) => !local.has(id)),
      edges,
      groups: [group],
    };
  });
  return [full, overview, ...details];
}
function wrap(s, max = 23) {
  const words = String(s)
    .split(/\s+/)
    .flatMap((w) => (w.length > max ? w.match(new RegExp(`.{1,${max}}`, "gu")) : [w]));
  const lines = [""];
  for (const w of words) {
    const i = lines.length - 1;
    if (lines[i] && lines[i].length + w.length + 1 > max) lines.push(w);
    else lines[i] += (lines[i] ? " " : "") + w;
  }
  return lines;
}
let engine;
export async function renderView(view, graph) {
  engine ??= await Graphviz.load();
  const alias = new Map(graph.nodes.map((n, i) => [n.id, `n${i}`]));
  const included = new Set(view.nodes.map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const presentation = new Map(
    view.nodes.map((n) => {
      const relation = graph.edges.find((e) => e.kind === "relationship" && e.source === n.id);
      const title = n.name ?? (relation ? `${relation.label} → ${byId.get(relation.to).name ?? relation.to}` : n.id);
      return [
        n.id,
        { title, description: n.purpose ?? "", lines: wrap(title), idLines: title === n.id ? [] : wrap(n.id, 32) },
      ];
    }),
  );
  const sizes = new Map(
    view.nodes.map((n) => [
      n.id,
      [
        n.kind === "Model" || n.kind === "Domain" ? 230 : 210,
        Math.max(78, 40 + presentation.get(n.id).lines.length * 18 + presentation.get(n.id).idLines.length * 14),
      ],
    ]),
  );
  const connections = view.edges.flatMap((e, i) => {
    const base = { canonicalId: e.id, kind: e.kind, projected: e.projected ?? false };
    if (!view.summary && e.kind === "relationship" && included.has(e.source))
      return [
        { ...base, id: `e${i}a`, from: e.from, to: e.source, label: e.label ?? e.kind },
        { ...base, id: `e${i}b`, from: e.source, to: e.to, label: e.mode ?? "" },
      ];
    return [{ ...base, id: `e${i}`, from: e.from, to: e.to, label: e.label ?? e.kind }];
  });
  const statements = view.nodes.map((n) => {
    const [w, h] = sizes.get(n.id);
    return `${alias.get(n.id)} [label="",width=${w / 72},height=${h / 72}];`;
  });
  const clustered = new Set(view.groups.flatMap((g) => g.members));
  const dot = [
    "digraph D {",
    'graph [rankdir=LR, nodesep=0.35, ranksep=0.8, compound=true, splines=spline, pad=0.35, bgcolor="transparent"];',
    "node [shape=box, fixedsize=true];",
    'edge [fontname="Arial",fontsize=12,arrowsize=0.7];',
  ];
  for (const g of view.groups) {
    dot.push(
      `subgraph cluster_${alias.get(g.id)} { label=${quote(g.label)}; fontname="Arial"; fontsize=16; margin=25;`,
    );
    for (const n of view.nodes.filter((n) => g.members.includes(n.id))) dot.push(statements[view.nodes.indexOf(n)]);
    dot.push("}");
  }
  dot.push(...statements.filter((_, i) => !clustered.has(view.nodes[i].id)));
  for (const e of connections)
    dot.push(
      `${alias.get(e.from)} -> ${alias.get(e.to)} [id=${quote(e.id)},label=${quote(e.label)},weight=${e.kind === "owns" ? 3 : 1}];`,
    );
  dot.push("}");
  const layout = JSON.parse(engine.layout(dot.join("\n"), "json", "dot"));
  const [, , width, height] = layout.bb.split(",").map(Number),
    margin = 28;
  const point = ([x, y]) => [x + margin, height - y + margin];
  const pathData = (points) => {
    const p = points.map(point);
    return (
      `M${p[0].join(" ")} ` +
      Array.from(
        { length: (p.length - 1) / 3 },
        (_, i) =>
          `C${p
            .slice(1 + i * 3, 4 + i * 3)
            .map((v) => v.join(" "))
            .join(" ")}`,
      ).join(" ")
    );
  };
  let groups = "",
    edges = "",
    nodes = "";
  for (const g of view.groups) {
    const cluster = layout.objects.find((o) => o.name === `cluster_${alias.get(g.id)}`);
    assert.ok(cluster?.bb);
    const [x0, y0, x1, y1] = cluster.bb.split(",").map(Number);
    groups += `<g data-domain-id="${esc(g.id)}"><rect data-graph-role="structural-frame" data-composition-frame-kind="domain" x="${x0 + margin}" y="${height - y1 + margin}" width="${x1 - x0}" height="${y1 - y0}" rx="20" class="domain-frame"/><text x="${x0 + margin + 18}" y="${height - y1 + margin + 23}" class="t-primary" font-size="16" font-weight="600">${esc(g.label)}</text></g>`;
  }
  for (const e of connections) {
    const placed = layout.edges?.find((o) => o.id === e.id);
    assert.ok(placed, `Missing routed edge ${e.id}`);
    const curve = placed._draw_?.find((op) => op.op === "b");
    assert.ok(curve, `Missing curve ${e.id}`);
    const dashed = !["owns", "relationship"].includes(e.kind);
    const color = e.kind === "owns" ? "var(--text-muted)" : dashed ? "var(--cloud-stroke)" : "var(--arrow)";
    edges += `<g data-edge-id="${e.id}" data-edge-key="${e.id}" data-edge-from="${alias.get(e.from)}" data-edge-to="${alias.get(e.to)}" data-edge-label="${esc(e.label)}" data-canonical-edge-id="${esc(e.canonicalId)}"><title>${esc(`${e.from} → ${e.label} → ${e.to}`)}</title><path d="${pathData(curve.points)}" fill="none" stroke="${color}" stroke-width="${e.kind === "owns" ? 1.3 : 1.8}" ${dashed ? 'stroke-dasharray="6 4"' : ""}/>`;
    for (const op of placed._hdraw_ ?? [])
      if (op.op === "P")
        edges += `<polygon points="${op.points
          .map(point)
          .map((p) => p.join(","))
          .join(" ")}" fill="${color}"/>`;
    if (e.label && placed.lp) {
      const [x, y] = point(placed.lp.split(",").map(Number));
      const w = Math.max(30, e.label.length * 6.4 + 12);
      edges += `<rect x="${x - w / 2}" y="${y - 10}" width="${w}" height="18" rx="4" fill="var(--mask)"/><text x="${x}" y="${y + 3}" text-anchor="middle" class="t-muted" font-size="12">${esc(e.label)}</text>`;
    }
    edges += "</g>";
  }
  for (const n of view.nodes) {
    const placed = layout.objects.find((o) => o.name === alias.get(n.id));
    assert.ok(placed?.pos);
    const [cx, cy] = point(placed.pos.split(",").map(Number));
    const [w, h] = sizes.get(n.id),
      x = cx - w / 2,
      y = cy - h / 2;
    const context = view.context.includes(n.id);
    const { title, description, lines, idLines } = presentation.get(n.id);
    const attrs = `id="node-${alias.get(n.id)}" data-node-id="${alias.get(n.id)}" data-node-label="${esc(title)}" data-node-kind="${n.kind}" data-node-tag="${esc(n.id)}" data-node-context="${esc(description)}" data-node-sublabel="${esc(context ? "External context" : n.ownerDomain ? (byId.get(n.ownerDomain).name ?? n.ownerDomain) : "Model scope")}" tabindex="0" role="button" aria-pressed="false" aria-label="${esc(title)}"`;
    let shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n.kind === "Relationship" ? h / 2 : n.kind === "Model" ? 22 : 10}" class="c-${paint[n.kind]}" stroke-width="1.6"/>`;
    if (n.kind === "Guarantee")
      shape = `<path d="M${x + 12} ${y}H${x + w - 12}L${x + w} ${y + 12}V${y + h - 12}L${x + w - 12} ${y + h}H${x + 12}L${x} ${y + h - 12}V${y + 12}Z" class="c-${paint[n.kind]}" stroke-width="1.6"/>`;
    if (n.kind === "UseCase")
      shape += `<path d="M${x + 12} ${y + 8}H${x + w - 12}" class="c-${paint[n.kind]}" fill="none" stroke-width="4"/>`;
    if (n.kind === "DomainInterface")
      shape += `<path d="M${x + 8} ${y + 12}H${x + 18}V${y + h - 12}H${x + 8}" fill="none" stroke="var(--text-muted)" stroke-width="3"/>`;
    nodes += `<g ${attrs} data-context="${context}"><title>${esc(`${n.id} · ${description}`)}</title>${shape}<text x="${x + 16}" y="${y + 20}" class="t-muted" font-size="10">${n.kind}${context ? " · context" : ""}</text>${lines
      .map(
        (line, i) =>
          `<text data-node-label="" x="${x + 16}" y="${y + 43 + i * 18}" class="t-primary" font-size="14">${esc(line)}</text>`,
      )
      .join("")}${idLines
      .map(
        (line, i) =>
          `<text x="${x + 16}" y="${y + 43 + lines.length * 18 + i * 14}" class="t-muted" font-size="10">${esc(line)}</text>`,
      )
      .join("")}</g>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width + margin * 2} ${height + margin * 2}" data-reader-fit="intrinsic-height" role="img" aria-label="${esc(view.label)}"><title>${esc(view.label)}</title><style>.domain-frame{fill:var(--panel);stroke:var(--frontend-stroke);stroke-opacity:.5;stroke-width:1.3}text{font-family:Arial,sans-serif}[data-context="true"]>rect,[data-context="true"]>path{stroke-dasharray:5 3}</style><rect width="100%" height="100%" fill="var(--mask)"/>${groups}${edges}${nodes}</svg>`;
  return {
    svg,
    connections,
    dot: dot.join("\n"),
    width: width + margin * 2,
    height: height + margin * 2,
    components: view.nodes.map((n) => ({
      id: alias.get(n.id),
      canonicalId: n.id,
      semantic_kind: n.kind,
      title: presentation.get(n.id).title,
      description: presentation.get(n.id).description,
    })),
  };
}
function adaptPassport(template) {
  const chip = '<span id="focus-context" data-passport="context" hidden></span>';
  const relations = '<div class="relationship-lens-list" id="relationship-lens-list"';
  assert.ok(template.includes(chip) && template.includes(relations), "Qualified Archify passport structure changed");
  const description = '<p id="focus-context" class="ddduck-passport-description" tabindex="0" hidden></p>';
  const style = `<style>
    .ddduck-passport-description {
      margin: 0; padding: .75rem; box-sizing: border-box;
      border-bottom: 1px solid var(--toolbar-border); color: var(--text);
      font-size: .6875rem; line-height: 1.55; white-space: pre-wrap;
      overflow-wrap: anywhere; max-height: min(12rem, 30vh); overflow: auto;
    }
    .ddduck-passport-description[hidden] { display: none; }
  </style>`;
  return template
    .replace(chip, "")
    .replace(relations, `${description}${relations}`)
    .replace("</head>", `${style}</head>`);
}

export async function exportModel(source, output, archifyRoot) {
  const bytes = readFileSync(source),
    graph = JSON.parse(bytes),
    views = projectViews(graph);
  const root = path.resolve(archifyRoot),
    template = adaptPassport(readFileSync(path.join(root, "assets/template.html"), "utf8"));
  const { writeDiagram } = await import(pathToFileURL(path.join(root, "renderers/shared/cli.mjs")));
  mkdirSync(output, { recursive: true });
  const records = [];
  const name = graph.modelName ?? graph.nodes.find((n) => n.kind === "Model").name ?? graph.modelId ?? "Model";
  for (const view of views) {
    const rendered = await renderView(view, graph);
    const meta = {
      title: `${name} · ${view.label}`,
      locale: "en",
      translations: Object.fromEntries(kinds.map((k) => [`viewer.kind.${k.toLowerCase()}`, k])),
    };
    const html = path.join(output, `${view.id}.html`);
    writeDiagram({
      outPath: path.resolve(html),
      template,
      diagramType: "architecture",
      meta,
      svg: rendered.svg,
      cards: [
        {
          dot: "cyan",
          title: view.summary ? "Model summary" : "Graph structure",
          items: [
            `${view.nodes.length} nodes · ${view.edges.length} semantic relationships`,
            view.summary
              ? "References to hidden members terminate at their Domain; detail views retain exact endpoints."
              : "Solid arrows: ownership and domain relationships. Dashed arrows: references. Dashed cards: external context.",
          ],
        },
      ],
    });
    writeFileSync(
      path.join(output, `${view.id}.json`),
      JSON.stringify({ ...view, components: rendered.components, connections: rendered.connections }, null, 2) + "\n",
    );
    writeFileSync(path.join(output, `${view.id}.dot`), rendered.dot + "\n");
    records.push({
      id: view.id,
      label: view.label,
      nodes: view.nodes.length,
      edges: view.edges.length,
      segments: rendered.connections.length,
      groups: view.groups.length,
      width: rendered.width,
      height: rendered.height,
      sha256: createHash("sha256").update(readFileSync(html)).digest("hex"),
    });
  }
  const options = records
    .map(
      (v) =>
        `<option value="${v.id}">${v.id === "model" ? "Model and sublevels" : esc(v.label)} · ${v.nodes} nodes</option>`,
    )
    .join("");
  const hierarchy = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(name)} · Model and sublevels</title><style>body{font:15px system-ui;background:#f3f5f8;color:#172033;margin:24px}h1{font-size:22px}iframe{width:100%;height:850px;border:0}details{border:1px solid #d8dfe9;border-radius:12px;background:white;margin:24px 0;padding:16px}summary{cursor:pointer;font-weight:600}a{color:#2855a0}</style><h1>Model and sublevels</h1><p>The overview summarizes references at Domain level. Each diagram below preserves exact endpoints and shows external context with dashed cards.</p><iframe title="Model overview" src="model.html"></iframe>${records
    .slice(2)
    .map(
      (v) =>
        `<details open><summary>${esc(v.label)} · ${v.nodes} nodes including context</summary><p><a href="${v.id}.html" target="_blank" rel="noopener">Open diagram / export</a></p><iframe loading="lazy" title="${esc(v.label)}" src="${v.id}.html"></iframe></details>`,
    )
    .join("")}</html>`;
  writeFileSync(path.join(output, "hierarchy.html"), hierarchy);
  // ponytail: a static HTML bundle shares one viewer frame; no new application framework.
  const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(name)} · Model atlas</title><style>body{margin:0;height:100vh;height:100dvh;display:flex;flex-direction:column;background:#f3f5f8;color:#172033;font:15px system-ui}header{flex:none;padding:20px 28px;background:white;border-bottom:1px solid #d8dfe9;display:flex;gap:24px;align-items:center;flex-wrap:wrap}h1{font-size:22px;margin:0}p{margin:6px 0;color:#536177}select,a{font:inherit}select{padding:10px;border:1px solid #b8c4d4;border-radius:8px;min-width:260px}a{color:#2855a0}iframe{display:block;flex:1;min-height:0;width:100%;border:0}nav{display:flex;gap:14px;align-items:center;flex-wrap:wrap}</style></head><body><header><div><h1>${esc(name)} · Model atlas</h1><p>Complete graph, model overview and domain details · ${graph.nodes.length} canonical nodes · ${graph.edges.length} relationships</p></div><nav><label for="view">View</label><select id="view">${options}</select><a id="separate" href="complete.html" target="_blank" rel="noopener">Open view separately</a></nav></header><iframe id="diagram" title="Complete model" src="complete.html"></iframe><script>const view=document.getElementById('view'),frame=document.getElementById('diagram'),link=document.getElementById('separate');function change(){frame.src=(view.value==='model'?'hierarchy':view.value)+'.html';frame.title=view.selectedOptions[0].text;link.href=frame.src;location.hash=view.value;}view.addEventListener('change',change);const initial=location.hash.slice(1);if([...view.options].some(o=>o.value===initial)){view.value=initial;change();}</script></body></html>`;
  writeFileSync(path.join(output, "index.html"), index);
  writeFileSync(
    path.join(output, "manifest.json"),
    JSON.stringify(
      {
        source: path.resolve(source),
        sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        archifyRoot: root,
        renderer: "custom DDD SVG adapter with Graphviz placement and Archify viewer",
        views: records,
      },
      null,
      2,
    ) + "\n",
  );
  return records;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source, output, root] = process.argv.slice(2);
  assert.ok(
    source && output && root,
    "Usage: node export-model.mjs <model-graph.json> <output-directory> <archify-package-directory>",
  );
  console.log(JSON.stringify(await exportModel(source, output, root)));
}
