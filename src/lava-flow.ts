import { FileInfo, MDFileInfo, OtherFileInfo } from './file-info.js';
import { FolderInfo } from './folder-info.js';
import { LavaFlowForm } from './lava-flow-form.js';
import { LavaFlowSettings } from './lava-flow-settings.js';
import { createOrGetFolder } from './util.js';
import { JournalEntryDataConstructorData } from '@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/journalEntryData';
import { generateJournalUUID, generatePageUUID, documentExists } from './deterministic-uuid.js';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export default class LavaFlow {
  static ID = 'lava-flow-jrayc';

  static FLAGS = {
    FOLDER: 'lavaFlowFolder',
    JOURNAL: 'lavaFlowJournalEntry',
    SCOPE: 'world',
    LASTSETTINGS: 'lava-flow-last-settings',
  };

  static TEMPLATES = {
    IMPORTDIAG: `modules/${this.ID}/templates/lava-flow-import.hbs`,
  };

  static log(msg: string, notify: boolean = false): void {
    console.log(LavaFlow.toLogMessage(msg));
    if (notify) ui?.notifications?.info(LavaFlow.toLogMessage(msg));
  }

  static errorHandling(e: any): void {
    console.error(LavaFlow.toLogMessage(e.stack));
    ui?.notifications?.error(LavaFlow.toLogMessage('Unexpected error. Please see the console for more details.'));
  }

  static toLogMessage(msg: string): string {
    return `Lava Flow | ${msg}`;
  }

  static isGM(): boolean {
    return (game as Game).user?.isGM ?? false;
  }

  static createUIElements(html: any): void {
    if (!LavaFlow.isGM()) return;

    // Use proper Foundry version detection
    const isV13 = (game as any)?.release?.generation >= 13;
    
    // Convert HTMLElement to jQuery if needed (v13 passes HTMLElement)
    const $html = isV13 ? $(html as HTMLElement) : html;
    
    const className = `${LavaFlow.ID}-btn`;
    const tooltip = (game as Game).i18n.localize('LAVA-FLOW-JRAYC.button-label');
    
    // Create button with v13-compatible styling
    const buttonHtml = isV13 
      ? `<button type="button" class="${className}" data-action="importVault"><i class="fas fa-upload"></i><span>${tooltip}</span></button>`
      : `<div class="${LavaFlow.ID}-row action-buttons flexrow"><button class="${className}"><i class="fas fa-upload"></i> ${tooltip}</button></div>`;
    
    const button = $(buttonHtml);
    
    button.on('click', function () {
      LavaFlow.createForm();
    });
    
    // Use different selector strategy based on version
    if (isV13) {
      // v13: Append to header-actions container
      $html.find('.header-actions').append(button);
    } else {
      // v12: Insert after header-actions
      $html.find('.header-actions:first-child').after(button);
    }
  }

  static createForm(): void {
    if (!LavaFlow.isGM()) return;
    new LavaFlowForm().render(true);
  }

  static async importVault(event: Event, settings: LavaFlowSettings): Promise<void> {
    if (!LavaFlow.isGM()) return;
    LavaFlow.log('Begin import...', true);

    try {
      await this.saveSettings(settings);

      if (settings.vaultFiles == null) return;

      if (settings.importNonMarkdown) {
        await LavaFlow.validateUploadLocation(settings);
      }

      // Pre-scan for existing images if skip duplicates is enabled
      let existingImagePaths: Map<string, string> = new Map();
      let totalImages = 0;
      let skippedImages = 0;

      if (settings.importNonMarkdown && settings.skipDuplicateImages) {
        const result = await LavaFlow.getExistingImageFiles(settings);
        existingImagePaths = result.existingFiles;
      }

      const rootFoundryFolder = await createOrGetFolder(settings.rootFolderName);

      const rootFolder = LavaFlow.createFolderStructure(settings.vaultFiles);

      // Pass the existing image paths to the import process
      const importStats = await LavaFlow.importFolder(rootFolder, settings, rootFoundryFolder, existingImagePaths);
      totalImages = importStats.totalImages;
      skippedImages = importStats.skippedImages;

      const importedFiles: FileInfo[] = rootFolder.getFilesRecursive();

      const allJournals = importedFiles
        .filter((f) => f.journalPage !== null)
        // @ts-expect-error
        .map((f) => f.journalPage) as JournalEntryPage[];
      for (let i = 0; i < importedFiles.length; i++) await LavaFlow.updateLinks(importedFiles[i], allJournals);

      if (settings.createIndexFile || settings.createBacklinks) {
        const mdFiles = importedFiles.filter((f) => f instanceof MDFileInfo) as MDFileInfo[];
        if (settings.createIndexFile) await LavaFlow.createIndexFile(settings, mdFiles, rootFoundryFolder);

        if (settings.createBacklinks) await LavaFlow.createBacklinks(mdFiles);
      }

      // Update to HTML after we have done all our MD edits
      if(settings.useTinyMCE)
        await LavaFlow.ConvertAllToHTML(allJournals);

      // Show completion message with summary
      let message = 'Import complete.';
      if (settings.importNonMarkdown && settings.skipDuplicateImages && totalImages > 0) {
        message += ` Skipped ${skippedImages}/${totalImages} duplicate images.`;
      }
      LavaFlow.log(message, true);
    } catch (e: any) {
      LavaFlow.errorHandling(e);
    }
  }  

  static createFolderStructure(fileList: FileList): FolderInfo {
    // let previousDirectories: string[] = [];
    const rootFolder = new FolderInfo('');
    for (let i = 0; i < fileList.length; i++) {
      const file = FileInfo.get(fileList[i]);
      if (file.isHidden() || file.isCanvas()) continue;
      let parentFolder = rootFolder;
      // Skip the first directory (vault root folder name) to ensure consistent IDs
      const directoriesWithoutRoot = file.directories.length > 1 ? file.directories.slice(1) : [];
      for (let j = 0; j < directoriesWithoutRoot.length; j++) {
        const folderName = directoriesWithoutRoot[j];
        const matches = parentFolder.childFolders.filter((f) => f.name === folderName);
        const currentFolder = matches.length > 0 ? matches[0] : new FolderInfo(folderName);
        if (matches.length < 1) parentFolder.childFolders.push(currentFolder);
        parentFolder = currentFolder;
      }
      parentFolder.files.push(file);
    }
    return rootFolder;
  }

  static async saveSettings(settings: LavaFlowSettings): Promise<void> {
    const savedSettings = new LavaFlowSettings();
    Object.assign(savedSettings, settings);
    savedSettings.vaultFiles = null;
    await (game as Game).user?.setFlag(LavaFlow.FLAGS.SCOPE, LavaFlow.FLAGS.LASTSETTINGS, savedSettings);
  }

  static async importFolder(
    folder: FolderInfo,
    settings: LavaFlowSettings,
    parentFolder: Folder | null,
    existingImagePaths: Map<string, string> = new Map(),
    currentPath: string[] = [],
  ): Promise<{ totalImages: number; skippedImages: number }> {
    let totalImages = 0;
    let skippedImages = 0;

    const hasMDFiles = folder.files.filter((f) => f instanceof MDFileInfo).length > 0;
    const combineFiles =
      settings.combineNotes && hasMDFiles && (!settings.combineNotesNoSubfolders || folder.childFolders.length < 1);

    let parentJournal: JournalEntry | null = null;

    const oneJournalPerFile =
      !combineFiles &&
      folder.name !== '' &&
      folder.getFilesRecursive().filter((f) => f instanceof MDFileInfo).length > 0;

    if (combineFiles) {
      // For combined folders, use the folder path as the journal identifier
      const folderPath = folder.name !== '' ? [...currentPath, folder.name].join('/') : currentPath.join('/');
      parentJournal = await this.createJournal(folder.name, parentFolder, settings.playerObserve, folderPath);
    }

    if (
      oneJournalPerFile ||
      (combineFiles &&
        folder.childFolders.filter(
          (childFolder) => childFolder.getFilesRecursive().filter((f) => f instanceof MDFileInfo).length > 0,
        ).length > 0)
    ) {
      parentFolder = await createOrGetFolder(folder.name, parentFolder?.id, currentPath);
    }

    for (let i = 0; i < folder.files.length; i++) {
      const stats = await this.importFile(folder.files[i], settings, parentFolder, parentJournal, existingImagePaths);
      totalImages += stats.totalImages;
      skippedImages += stats.skippedImages;
    }

    for (let i = 0; i < folder.childFolders.length; i++) {
      const childPath = folder.name !== '' ? [...currentPath, folder.name] : currentPath;
      const stats = await this.importFolder(folder.childFolders[i], settings, parentFolder, existingImagePaths, childPath);
      totalImages += stats.totalImages;
      skippedImages += stats.skippedImages;
    }

    return { totalImages, skippedImages };
  }

  static async importFile(
    file: FileInfo,
    settings: LavaFlowSettings,
    rootFolder: Folder | null,
    parentJournal: JournalEntry | null,
    existingImagePaths: Map<string, string> = new Map(),
  ): Promise<{ totalImages: number; skippedImages: number }> {
    if (file instanceof MDFileInfo) {
      await this.importMarkdownFile(file, settings, rootFolder, parentJournal);
      return { totalImages: 0, skippedImages: 0 };
    } else if (settings.importNonMarkdown && file instanceof OtherFileInfo) {
      const wasSkipped = await this.importOtherFile(file, settings, existingImagePaths);
      return { totalImages: 1, skippedImages: wasSkipped ? 1 : 0 };
    }
    return { totalImages: 0, skippedImages: 0 };
  }

  static async importMarkdownFile(
    file: MDFileInfo,
    settings: LavaFlowSettings,
    parentFolder: Folder | null,
    parentJournal: JournalEntry | null,
  ): Promise<void> {
    const pageName = file.fileNameNoExt;
    const journalName = parentJournal?.name ?? pageName;

    // Get the file path without the vault root folder for deterministic UUID generation
    // This ensures the same file has the same ID regardless of vault folder name
    const pathParts = file.originalFile.webkitRelativePath.split('/');
    const filePath = pathParts.length > 1 ? pathParts.slice(1).join('/') : file.originalFile.webkitRelativePath;

    // Try to find journal by deterministic ID first, then by name
    let journal = null;
    if (!parentJournal) {
      const deterministicId = generateJournalUUID(filePath);
      // @ts-ignore - game global
      journal = documentExists((game as Game).journal, deterministicId)
        ? ((game as Game).journal?.get(deterministicId) as JournalEntry)
        : null;

      // Fallback to finding by name and folder if deterministic lookup fails
      if (!journal) {
        // @ts-ignore - game global
        journal = ((game as Game).journal?.find(
          (j: JournalEntry) => j.name === journalName && j.folder === parentFolder,
        ) as JournalEntry);
      }
    }

    const finalJournal = journal ?? parentJournal ?? (await LavaFlow.createJournal(journalName, parentFolder, settings.playerObserve, filePath));

    const { body, isPublic } = await LavaFlow.parseFrontmatterAndBody(file, settings);

    // @ts-expect-error
    let journalPage: JournalEntryPage = finalJournal.pages.find((p: JournalEntryPage) => p.name === pageName) ?? null;

    if (journalPage !== null && settings.overwrite) await LavaFlow.updateJournalPage(journalPage, body);
    else if (journalPage === null || (!settings.overwrite && !settings.ignoreDuplicate))
      journalPage = await LavaFlow.createJournalPage(pageName, body, finalJournal, filePath);

    // (Avoid flipping an entire combined-journal when combineNotes is on and parentJournal was provided.)
    if (isPublic && parentJournal === null) {
      await finalJournal.update({
        // @ts-expect-error
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
    } else if (!isPublic && parentJournal === null) {
      await finalJournal.update({
        // @ts-expect-error
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
      });
    }

    file.journalPage = journalPage;
  }


  static async importOtherFile(
    file: OtherFileInfo,
    settings: LavaFlowSettings,
    existingImagePaths: Map<string, string> = new Map(),
  ): Promise<boolean> {
    const source = settings.useS3 ? 's3' : 'data';
    const body = settings.useS3 ? { bucket: settings.s3Bucket } : {};

    // Check if file already exists in pre-scanned map
    if (settings.skipDuplicateImages && existingImagePaths.has(file.originalFile.name)) {
      file.uploadPath = existingImagePaths.get(file.originalFile.name)!;
      return true; // Skipped
    }

    // Upload the file
    const uploadResponse: any = await FilePicker.upload(source, settings.mediaFolder, file.originalFile, body);
    if (uploadResponse?.path) file.uploadPath = decodeURI(uploadResponse.path);
    return false; // Not skipped
  }

  static async getExistingImageFiles(settings: LavaFlowSettings): Promise<{ existingFiles: Map<string, string> }> {
    const existingFiles = new Map<string, string>();
    const source = settings.useS3 ? 's3' : 'data';
    const body = settings.useS3 && settings.s3Bucket ? { bucket: settings.s3Bucket } : {};

    try {
      const browseResult: any = await FilePicker.browse(source, settings.mediaFolder, body);

      if (browseResult?.files) {
        for (const filePath of browseResult.files) {
          const fileName = filePath.split('/').pop();
          if (fileName) {
            // Decode the filename to handle spaces and special characters
            const decodedFileName = decodeURIComponent(fileName);
            existingFiles.set(decodedFileName, decodeURI(filePath));
          }
        }
      }
    } catch (error: any) {
      // If browse fails, folder might not exist yet - that's okay
    }

    return { existingFiles };
  }

  static async validateUploadLocation(settings: LavaFlowSettings): Promise<void> {
    if (settings.useS3) {
      if (settings.s3Bucket === null || settings.s3Region === null) throw new Error('S3 settings are invalid.');
    } else {
      try {
        await FilePicker.browse('data', settings.mediaFolder);
        return;
      } catch (error: any) {
        // Directory doesn't exist, create it
      }
      await FilePicker.createDirectory('data', settings.mediaFolder);
    }
  }

  static async createIndexFile(
    settings: LavaFlowSettings,
    files: FileInfo[],
    rootFolder: Folder | null,
  ): Promise<void> {
    const indexJournalName = 'Index';
    const indexJournal = (game as Game).journal?.find((j) => j.name === indexJournalName && j.folder === rootFolder);
    const mdDictionary = files.filter((d) => d instanceof MDFileInfo);
    const directories = [...new Set(mdDictionary.map((d) => LavaFlow.getIndexTopDirectory(d)))];
    directories.sort();
    let content = '';
    for (let j = 0; j < directories.length; j++) {
      content += `<h1>${directories[j]}</h1>`;
      const journals = mdDictionary
        .filter((d) => LavaFlow.getIndexTopDirectory(d) === directories[j])
        .map((d) => d.journalPage);
      content += `<ul>${journals.map((journal) => `<li>${journal?.link ?? ''}</li>`).join('\n')}</ul>`;
    }
    if (indexJournal != null) await LavaFlow.updateJournalPage(indexJournal, content);
    else {
      const journal = await LavaFlow.createJournal(indexJournalName, rootFolder, settings.playerObserve);
      await LavaFlow.createJournalPage(indexJournalName, content, journal);
    }
  }

  static getIndexTopDirectory(fileInfo: FileInfo): string {
    return fileInfo.directories.length > 1 ? fileInfo.directories[1] : 'Uncatergorized';
  }

  static async createBacklinks(files: MDFileInfo[]): Promise<void> {
    for (let i = 0; i < files.length; i++) {
      const fileInfo = files[i];
      if (fileInfo.journalPage === null) continue;
      const backlinkFiles: MDFileInfo[] = [];
      for (let j = 0; j < files.length; j++) {
        if (j === i) continue;
        const otherFileInfo = files[j];
        const page = otherFileInfo.journalPage?.pages?.contents[0];
        const link = fileInfo.getLink();
        if (page !== undefined && page !== null && link !== null && (page.text.markdown as string).includes(link))
          backlinkFiles.push(otherFileInfo);
      }
      if (backlinkFiles.length > 0) {
        backlinkFiles.sort((a, b) => a.fileNameNoExt.localeCompare(b.fileNameNoExt));
        const backLinkList = backlinkFiles.map((b) => `- ${b.getLink() ?? ''}`).join('\r\n');
        const page = fileInfo.journalPage.pages.contents[0];
        // TODO when v10 types are ready, this cast will be unecessary
        const newText = `${page.text.markdown as string}\r\n#References\r\n${backLinkList}`;
        page.update({ text: { markdown: newText } });
      }
    }
  }

  static linkMatch(fileInfo: FileInfo, matchFileInfo: FileInfo): boolean {
    if (matchFileInfo !== fileInfo && matchFileInfo instanceof MDFileInfo) {
      const linkPatterns = fileInfo.getLinkRegex();
      for (let i = 0; i < linkPatterns.length; i++) {
        if (matchFileInfo.links.filter((l) => l.match(linkPatterns[i])).length > 0) return true;
      }
    }
    return false;
  }

  static decodeHtml(html: string): string {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
  }

  static async createJournal(
    journalName: string,
    parentFolder: Folder | null,
    playerObserve: boolean,
    filePath?: string,
  ): Promise<JournalEntry> {
    // Generate deterministic UUID if file path is provided
    let deterministicId: string | undefined;
    if (filePath) {
      deterministicId = generateJournalUUID(filePath);
      console.log(`Lava Flow | createJournal called for "${journalName}" with deterministic ID: ${deterministicId}`);

      // Check if a journal with this ID already exists
      if (documentExists((game as Game).journal, deterministicId)) {
        console.log(`Lava Flow | Journal already exists with ID: ${deterministicId}`);
        return (game as Game).journal?.get(deterministicId) as JournalEntry;
      }
    } else {
      console.log(`Lava Flow | createJournal called for "${journalName}" WITHOUT file path - will use random ID`);
    }

    const entryData: JournalEntryDataConstructorData = {
      ...(deterministicId && { _id: deterministicId }),
      name: journalName,
      folder: parentFolder?.id,
      // @ts-expect-error
      ...(playerObserve && {ownership:{default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER}})
    };

    console.log(`Lava Flow | Creating journal with data:`, { ...entryData, _id: entryData._id || 'RANDOM' });

    const entry = (await JournalEntry.create(entryData, { keepId: true })) ?? new JournalEntry();
    console.log(`Lava Flow | Created journal "${journalName}" with actual ID: ${entry.id}`);
    await entry.setFlag(LavaFlow.FLAGS.SCOPE, LavaFlow.FLAGS.JOURNAL, true);
    return entry;
  }

  private static async createJournalPage(
    pageName: string,
    content: string,
    journalEntry: JournalEntry,
    filePath?: string,
  ): Promise<JournalEntry> {
    // Generate deterministic UUID if file path is provided
    let deterministicId: string | undefined;
    if (filePath) {
      deterministicId = generatePageUUID(filePath, pageName);

      // Check if a page with this ID already exists in this journal
      // @ts-expect-error
      const existingPage = journalEntry.pages?.get(deterministicId);
      if (existingPage) {
        return existingPage;
      }
    }

    // @ts-expect-error
    const page = await JournalEntryPage.create(
      {
        ...(deterministicId && { _id: deterministicId }),
        name: pageName,
        // @ts-expect-error
        text: { markdown: content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.MARKDOWN },
      },
      { parent: journalEntry, keepId: true },
    );
    await page.setFlag("core","sheetClass","core.MarkdownJournalPageSheet");
    return page;
  }

  // @ts-expect-error
  static async updateJournalPage(page: JournalEntryPage, content: string, ): Promise<void> {
    if (page === undefined || page === null) return;
    await page.update({ text: { markdown: content } });
  }

  static async parseFrontmatterAndBody(
    file: FileInfo,
    settings?: LavaFlowSettings
  ): Promise<{ body: string; isPublic: boolean; frontmatter: Record<string, any> }> {
    let raw = await file.originalFile.text();

    // Grab YAML frontmatter block if present
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
    let frontmatter: Record<string, any> = {};
    let isPublic = false;

    if (fmMatch) {
      try {
        const yaml = fmMatch[1];
        // super-lightweight YAML-ish parse to avoid extra deps
        yaml.split(/\r?\n/).forEach((line) => {
          const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
          if (!m) return;
          const key = m[1].toLowerCase();
          let val: any = m[2].trim();
          if (/^true$/i.test(val.toLowerCase())) val = true;
          else if (/^false$/i.test(val.toLowerCase())) val = false;
          else if (/^['"].*['"]$/.test(val)) val = val.slice(1, -1);
          frontmatter[key] = val;
        });
      } catch (e) {
        console.warn(`Lava Flow | Error parsing YAML frontmatter in file ${file.originalFile.name}: ${e}`);
      }

      isPublic = frontmatter['public'] === true || String(frontmatter['visibility']).toLowerCase() === 'public';
    }

    // Now produce the body exactly like your current logic
    // strip YAML frontmatter
    let body = raw.replace(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/, '');

    // optionally strip DM-only callout blocks (> [!dm] format)
    if (settings?.stripObsidianComments) {
      // Match callout blocks: > [!dm] followed by lines starting with >
      body = body.replace(/^> \[!dm\].*$(\r?\n^>.*$)*/gm, '');
    }

    // keep your existing heading tweak
    body = body.replace(/^#[0-9A-Za-z]+\b/gm, ' $&');

    return { body, isPublic, frontmatter };
  }

  // @ts-expect-error
  static async updateLinks(fileInfo: FileInfo, allPages: JournalEntryPage[]): Promise<void> {
    const linkPatterns = fileInfo.getLinkRegex();
    for (let i = 0; i < allPages.length; i++) {
      const comparePage = allPages[i];

      for (let j = 0; j < linkPatterns.length; j++) {
        const pattern = linkPatterns[j];
        const linkMatches = (comparePage.text.markdown as string).matchAll(pattern);
        if (linkMatches === null) continue;
        for (const linkMatch of linkMatches) {
          const alias = (linkMatch[2] ?? '|').split('|')[1].trim();
          let link = fileInfo.getLink(alias);
          if (link === null) continue;
          if (fileInfo instanceof OtherFileInfo) {
            const resizeMatches = linkMatch[0].match(/\|\d+(x\d+)?\]/gi);
            if (resizeMatches !== null && resizeMatches.length > 0) {
              const dimensions = resizeMatches[0]
                .replace(/(\||\])/gi, '')
                .toLowerCase()
                .split('x');
              if (dimensions.length === 1) dimensions.push('*');
              const dimensionsString = dimensions.join('x');
              link = link.replace(/\)$/gi, ` =${dimensionsString})`);
            }
          }
          const newContent = comparePage.text.markdown.replace(linkMatch[0], link);
          await LavaFlow.updateJournalPage(allPages[i], newContent);
        }
      }
    }
  }

  // @ts-expect-error
  static async ConvertAllToHTML(allJournals: JournalEntryPage[]) {
    const promises = allJournals.map((j) => LavaFlow.ConvertToHTML(j));
    await Promise.all(promises);
  }
  
  // @ts-expect-error
  static async ConvertToHTML(page: JournalEntryPage){
    await Promise.all([
      page.update({
        // @ts-expect-error
        text: { markdown: "", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      }),
      page.setFlag("core","sheetClass","core.JournalTextTinyMCESheet")
    ])
  }
}
