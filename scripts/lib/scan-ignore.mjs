/**
 * The single skip predicate shared by every ddduck repository scanner (product
 * root discovery and the documentation reference walk), so both agree on which
 * directory entries are invisible. Name-based and deterministic; it never
 * reads .gitignore.
 */

export const defaultIgnoredEntryNames = Object.freeze(["node_modules"]);

/**
 * Decide whether a scanner should skip a directory/file entry: dot-entries,
 * known dependency directories, and product-declared extra ignores.
 * @param {string} name - The entry's basename.
 * @param {string[]} [extraNames] - Extra names from .ddduck/config.json ignore.
 * @returns {boolean} True when the entry must be skipped.
 */
export function shouldIgnoreScanEntry(name, extraNames = []) {
  return name.startsWith(".") || defaultIgnoredEntryNames.includes(name) || extraNames.includes(name);
}
