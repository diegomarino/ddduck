export const defaultIgnoredEntryNames = Object.freeze(["node_modules"]);

// A directory/file entry is skipped by every ddduck repo scanner when its
// basename is a dot-entry, a known dependency directory, or a product-declared
// extra ignore. Name-based and deterministic; it never reads .gitignore.
export function shouldIgnoreScanEntry(name, extraNames = []) {
  return name.startsWith(".") || defaultIgnoredEntryNames.includes(name) || extraNames.includes(name);
}
