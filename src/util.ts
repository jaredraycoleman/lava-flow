import LavaFlow from './lava-flow.js';
import { generateFolderUUID, documentExists } from './deterministic-uuid.js';

export async function createOrGetFolder(
  folderName: string | null,
  parentFolderID: string | null = null,
  folderPath: string[] = []
): Promise<Folder | null> {
  if (folderName == null || folderName === '') return null;
  const folder = (await getFolder(folderName, parentFolderID)) ?? (await createFolder(folderName, parentFolderID, folderPath));
  return folder;
}

export async function getFolder(folderName: string, parentFolderID: string | null): Promise<Folder | null> {
  if (parentFolderID !== null) {
    const parent = (game as Game).folders?.get(parentFolderID) as Folder;
    // v10 not supported by foundry-vtt-types yet
    // @ts-expect-error
    const matches = parent.children.filter((c) => c.folder.name === folderName) ?? [];
    return matches.length > 0 ? (matches[0].folder as Folder) : null;
  } else {
    return (
      (game as Game).folders?.find((f) => f.type === 'JournalEntry' && f.depth === 1 && f.name === folderName) ?? null
    );
  }
}

export async function createFolder(
  folderName: string,
  parentFolderID: string | null,
  folderPath: string[] = []
): Promise<Folder | null> {
  // Build the full path for this folder
  const fullPath = [...folderPath, folderName];
  const deterministicId = generateFolderUUID(fullPath);

  // Check if a folder with this ID already exists
  if (documentExists((game as Game).folders, deterministicId)) {
    return (game as Game).folders?.get(deterministicId) as Folder;
  }

  const folder = await Folder.create({
    _id: deterministicId,
    name: folderName,
    type: 'JournalEntry',
    folder: parentFolderID,
  }, { keepId: true });
  await folder?.setFlag(LavaFlow.FLAGS.SCOPE, LavaFlow.FLAGS.FOLDER, true);
  return folder ?? null;
}
