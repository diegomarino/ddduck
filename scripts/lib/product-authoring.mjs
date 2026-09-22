const kinds = {
  Domain: { prefix: "domain", directory: "domains", collection: "domains" },
  Concept: { prefix: "concept", directory: "concepts", collection: "concepts" },
  UseCase: { prefix: "use-case", directory: "use-cases", collection: "useCases" },
};

export function buildAuthoringPlan(snapshot, request) {
  const definition = kinds[request.kind];
  if (!definition) throw new Error(`Unsupported creation kind ${request.kind}`);
  const models = snapshot.nodes.filter(({ kind }) => kind === "Model");
  if (models.length !== 1) throw new Error("Creation requires exactly one Model");
  const [model] = models;
  const node =
    request.kind === "UseCase"
      ? globalThis.structuredClone(request.node)
      : {
          schemaVersion: "1",
          kind: request.kind,
          id: request.id,
          model: model.id,
          ...(request.kind === "Concept" ? { ownerDomain: request.ownerDomain } : {}),
          name: request.name,
          purpose: request.purpose,
          ...(request.kind === "Domain" ? { concepts: [], interfaces: [], guarantees: [] } : {}),
        };
  if (node?.kind !== request.kind) throw new Error(`create ${definition.prefix} requires kind ${request.kind}`);
  if (node.model !== model.id) throw new Error(`New node model must be ${model.id}`);
  if (typeof node.id !== "string" || !new RegExp(`^${definition.prefix}:[a-z0-9][a-z0-9-]*$`).test(node.id)) {
    throw new Error(`Invalid ${request.kind} ID ${JSON.stringify(node.id)}`);
  }
  if (snapshot.nodes.some(({ id }) => id === node.id)) throw new Error(`Model node ${node.id} already exists`);
  const destination = `model/${definition.directory}/${node.id.slice(definition.prefix.length + 1)}.yaml`;
  if (Object.values(snapshot.canonicalPaths).includes(destination)) {
    throw new Error(`Canonical destination already occupied: ${destination}`);
  }
  const parent =
    request.kind === "Concept"
      ? snapshot.nodes.find(({ id, kind }) => kind === "Domain" && id === node.ownerDomain)
      : model;
  if (!parent) throw new Error(`Unknown domain ${node.ownerDomain}`);
  return {
    operation: `create ${definition.prefix}`,
    affectedIds: [node.id, parent.id],
    replacements: [
      { path: destination, value: node },
      {
        path: snapshot.canonicalPaths[parent.id],
        value: { ...parent, [definition.collection]: [...(parent[definition.collection] ?? []), node.id] },
      },
    ],
  };
}
