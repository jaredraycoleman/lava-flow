/**
 * Generates deterministic 16-character IDs based on path strings using a simple hash algorithm.
 * This ensures that the same path always generates the same ID, making imports idempotent.
 * Foundry VTT requires IDs to be exactly 16 alphanumeric characters.
 */

/**
 * Simple hash function to convert a string to a 32-bit integer
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Converts a number to a base-36 string (alphanumeric)
 */
function toBase36(num: number, length: number): string {
  return num.toString(36).padStart(length, '0');
}

/**
 * Generates a deterministic 16-character alphanumeric ID from a path string.
 * Foundry VTT requires document IDs to be exactly 16 alphanumeric characters.
 *
 * @param path - The file path or unique identifier
 * @param namespace - Optional namespace to prevent collisions (e.g., 'folder', 'journal', 'page')
 * @returns A deterministic 16-character alphanumeric ID
 *
 * @example
 * generateDeterministicUUID('vault/notes/my-note.md', 'page')
 * // Always returns the same 16-char ID for this path+namespace combination
 */
export function generateDeterministicUUID(path: string, namespace: string = ''): string {
  // Combine path and namespace to create unique input
  const input = `${namespace}:${path}`;

  // Generate multiple hash values by using different seeds
  const hash1 = hashString(input);
  const hash2 = hashString(input + 'salt1');
  const hash3 = hashString(input + 'salt2');

  // Build 16-character ID using base-36 (0-9, a-z)
  // We need 16 characters, so we'll use ~5-6 chars from each hash
  const part1 = toBase36(hash1, 6); // 6 chars
  const part2 = toBase36(hash2, 5); // 5 chars
  const part3 = toBase36(hash3, 5); // 5 chars

  // Combine and ensure exactly 16 characters
  const id = (part1 + part2 + part3).substring(0, 16);

  return id;
}

/**
 * Checks if Foundry VTT already has a document with the given ID.
 *
 * @param collection - The Foundry document collection (e.g., game.journal, game.folders)
 * @param id - The ID to check
 * @returns True if a document with this ID already exists
 */
export function documentExists(collection: any, id: string): boolean {
  return collection?.get(id) != null;
}

/**
 * Generates a unique deterministic 16-character ID for a folder based on its full path.
 *
 * @param folderPath - Array of folder names from root to current folder
 * @returns A deterministic 16-character alphanumeric ID for the folder
 *
 * @example
 * generateFolderUUID(['vault', 'notes', 'programming'])
 */
export function generateFolderUUID(folderPath: string[]): string {
  const path = folderPath.join('/');
  return generateDeterministicUUID(path, 'folder');
}

/**
 * Generates a unique deterministic 16-character ID for a journal entry based on its path.
 *
 * @param filePath - The full path to the markdown file
 * @returns A deterministic 16-character alphanumeric ID for the journal entry
 *
 * @example
 * generateJournalUUID('vault/notes/my-note.md')
 */
export function generateJournalUUID(filePath: string): string {
  return generateDeterministicUUID(filePath, 'journal');
}

/**
 * Generates a unique deterministic 16-character ID for a journal page based on its path.
 *
 * @param filePath - The full path to the markdown file
 * @param pageName - Optional page name for multi-page entries
 * @returns A deterministic 16-character alphanumeric ID for the journal page
 *
 * @example
 * generatePageUUID('vault/notes/my-note.md')
 * generatePageUUID('vault/notes/my-note.md', 'Introduction')
 */
export function generatePageUUID(filePath: string, pageName: string = ''): string {
  const path = pageName ? `${filePath}#${pageName}` : filePath;
  return generateDeterministicUUID(path, 'page');
}
