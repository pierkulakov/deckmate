import { defineText, serverText } from './i18n.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertWritable, containedFile, type ServerConfig } from './config.ts';
import { CatalogError } from './catalog-service.ts';
import { appendActivity, describeBoardSave } from './activity.ts';
import { projectLanguage } from './project-language.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { boardAccessOf, boardCardIdOf, type BoardAccess, type BoardDocument, type BoardScene, type BoardSummary } from '../src/board-contracts.ts';
import { assertCatalogCoverFile, decodeCatalogCover, storeCatalogCover } from './catalog-covers.ts';
import { BoardSceneSafetyError, boardImageMimeTypes, boardSafetyText, maximumBoardBytes, maximumBoardImageBytes, sanitizeBoardScene, type BoardSafetyIssue } from '../src/board-scene-safety.ts';

const messages = defineText({
  boardRootChanged: "The project root changed or contains a symbolic link.",
  boardDirectoryLink: "The boards directory cannot be a symbolic link.",
  invalidBoardId: "Invalid board ID.",
  boardFileLink: "The board file cannot be a symbolic link.",
  invalidBoardTitle: "The title must contain 1 to 120 characters.",
  boardConflict: "The board changed in the files. Your drawing remains open; save a copy or load the new version.",
  boardLocked: "The board is locked. Edit boards/<id>.excalidraw to unlock it.",
  boardReadOnly: "The board is read-only. Switch access to Editable in the “…” menu.",
  boardImageMissing: "The drawing contains an image without a file. Wait for the image to upload.",
  boardTooLarge: "The board is larger than 20 MB.",
  boardDirectoryChanged: "The board directory changed.",
  boardChangedOnSave: "The board changed while saving. Your drawing remains in the editor.",
}, {
  boardRootChanged: "Корень проекта изменился или содержит ссылку.",
  boardDirectoryLink: "Папка boards не может быть ссылкой.",
  invalidBoardId: "Некорректный ID доски.",
  boardFileLink: "Файл доски не может быть ссылкой.",
  invalidBoardTitle: "Название: от 1 до 120 символов.",
  boardConflict: "Доска изменилась в файлах. Ваш рисунок остаётся открыт; сохраните его копией или загрузите новую версию.",
  boardLocked: "Доска заблокирована (Locked). Измените файл boards/<id>.excalidraw, чтобы снять блокировку.",
  boardReadOnly: "Доска открыта в режиме Read Only. Переключите доступ в Editable через меню «…».",
  boardImageMissing: "В рисунке есть изображение без файла. Дождитесь загрузки изображения.",
  boardTooLarge: "Доска больше 20 МБ.",
  boardDirectoryChanged: "Папка доски изменилась.",
  boardChangedOnSave: "Доска изменилась во время сохранения. Рисунок остаётся в редакторе.",
});


interface ExternalImage { path: string; mimeType: string; created: number }
type StoredBoard = BoardScene & { name: string; externalFiles?: Record<string, ExternalImage> };

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identifier = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
function linkedCards(scene: BoardScene): string[] {
  return [...new Set(scene.elements.filter(element => !element.isDeleted).map(boardCardIdOf)
    .filter((cardId): cardId is string => Boolean(cardId)))];
}

function validateScene(value: unknown, mode: 'read' | 'write') {
  try { return sanitizeBoardScene(value, mode); }
  catch (error) {
    if (error instanceof BoardSceneSafetyError) throw new CatalogError(422, serverText(boardSafetyText)[error.code]);
    throw error;
  }
}

export class Boards {
  private config: ServerConfig;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(config: ServerConfig) { this.config = config; }
  private root(source: DataSource) { return source === 'sandbox' && this.config.writeRoot ? this.config.writeRoot : this.config.dataRoot; }
  private async directory(source: DataSource, create = false): Promise<string> {
    const root = this.root(source);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || path.relative(path.resolve(root), await realpath(root)) !== '') throw new CatalogError(422, serverText(messages).boardRootChanged);
    const directory = path.join(root, 'boards');
    if (create) await mkdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CatalogError(422, serverText(messages).boardDirectoryLink);
    return containedFile(root, 'boards');
  }

  async read(source: DataSource, id: string): Promise<BoardDocument> {
    if (!identifier.test(id)) throw new CatalogError(400, serverText(messages).invalidBoardId);
    await this.directory(source);
    const filename = await containedFile(this.root(source), `boards/${id}.excalidraw`);
    if ((await lstat(path.join(this.root(source), `boards/${id}.excalidraw`))).isSymbolicLink()) throw new CatalogError(422, serverText(messages).boardFileLink);
    if ((await lstat(filename)).size > maximumBoardBytes) throw new CatalogError(422, serverText(messages).boardTooLarge);
    const bytes = await readFile(filename);
    const stored = JSON.parse(bytes.toString('utf8')) as StoredBoard;
    const { scene, issues } = validateScene(stored, 'read');
    const files: Record<string, unknown> = { ...scene.files };
    const usedFiles = new Set(scene.elements.filter(element => !element.isDeleted && element.type === 'image').map(element => element.fileId));
    let imageBytes = bytes.length;
    for (const [fileId, asset] of Object.entries(stored.externalFiles ?? {})) {
      if (!usedFiles.has(fileId)) continue;
      if (!asset || !boardImageMimeTypes.includes(asset.mimeType)) { issues.push('files'); continue; }
      await assertCatalogCoverFile(this.root(source), asset.path);
      const size = (await lstat(path.join(this.root(source), asset.path))).size;
      imageBytes += Math.ceil(size / 3) * 4;
      if (size > maximumBoardImageBytes || imageBytes > maximumBoardBytes) throw new CatalogError(422, serverText(boardSafetyText).limit);
      const dataURL = `data:${asset.mimeType};base64,${(await readFile(path.join(this.root(source), asset.path))).toString('base64')}`;
      try { decodeCatalogCover(dataURL); } catch { issues.push('files'); continue; }
      files[fileId] = { id: fileId, mimeType: asset.mimeType, created: asset.created, dataURL };
    }
    const hydrated = validateScene({ ...scene, files }, 'read');
    // 2026-11-10: inline files need the same signature check as external assets, even on read-only boards.
    for (const [fileId, file] of Object.entries(hydrated.scene.files)) {
      try { decodeCatalogCover((file as { dataURL: string }).dataURL); }
      catch { delete hydrated.scene.files[fileId]; issues.push('files'); }
    }
    const warnings = [...new Set<BoardSafetyIssue>([...issues, ...hydrated.issues])].map(issue => serverText(boardSafetyText)[issue]);
    const linkedCardIds = linkedCards(scene);
    return { id, title: stored.name || 'Vision', hash: hash(bytes), path: `boards/${id}.excalidraw`, linkedCardIds,
      updatedAt: (await lstat(filename)).mtime.toISOString(), access: boardAccessOf(stored),
      ...(warnings.length ? { warnings } : {}), scene: hydrated.scene };
  }

  async list(source: DataSource): Promise<BoardSummary[]> {
    let directory: string;
    try { directory = await this.directory(source); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: BoardSummary[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue;
      const id = entry.name.slice(0, -'.excalidraw'.length);
      if (!identifier.test(id)) continue;
      const { scene, ...summary } = await this.read(source, id);
      result.push(summary);
    }
    return result.sort((first, second) => first.title.localeCompare(second.title, 'ru'));
  }

  save(source: DataSource, input: { id?: string; title: string; hash: string; scene: BoardScene }): Promise<BoardDocument> {
    const operation = this.writes.then(async () => {
      const root = await assertWritable(this.config, source);
      if (!input.title.trim() || input.title.length > 120) throw new CatalogError(422, serverText(messages).invalidBoardTitle);
      const { scene } = validateScene(input.scene, 'write');
      const id = input.id ?? randomUUID();
      if (!identifier.test(id)) throw new CatalogError(400, serverText(messages).invalidBoardId);
      const directory = await this.directory(source, true);
      const filename = path.join(directory, `${id}.excalidraw`);
      let current: Buffer | null = null;
      try {
        if ((await lstat(filename)).isSymbolicLink()) throw new CatalogError(422, serverText(messages).boardFileLink);
        current = await readFile(await containedFile(root, `boards/${id}.excalidraw`));
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if ((current ? hash(current) : '') !== input.hash) throw new CatalogError(409, serverText(messages).boardConflict);
      // Access states (2026-11-04): Locked blocks every save; Read Only blocks content saves,
      // but a save that switches the state stays open — the «…» menu is the unlock path.
      const storedAccess: BoardAccess = current ? boardAccessOf(JSON.parse(current.toString('utf8')) as BoardScene) : 'editable';
      const nextAccess = boardAccessOf(scene);
      if (storedAccess === 'locked') throw new CatalogError(403, serverText(messages).boardLocked);
      if (storedAccess === 'readonly' && nextAccess === 'readonly') throw new CatalogError(403, serverText(messages).boardReadOnly);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      let renamed = false;
      let savedHash = '';
      const createdAssets: Awaited<ReturnType<typeof storeCatalogCover>>[] = [];
      try {
        const externalFiles: Record<string, ExternalImage> = {};
        const previous = current ? JSON.parse(current.toString('utf8')) as StoredBoard : null;
        // 2026-11-03: reuse the checked repository image store; disk scenes never embed base64.
        const usedFiles = new Set(scene.elements.filter(element => !element.isDeleted && element.type === 'image').map(element => element.fileId));
        for (const [fileId, value] of Object.entries(scene.files)) {
          if (!usedFiles.has(fileId)) continue;
          const image = value as { dataURL: string; mimeType: string; created: number };
          const decoded = decodeCatalogCover(image.dataURL);
          const mimeType = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[decoded.extension]!;
          let relativePath: string | undefined;
          const old = previous?.externalFiles?.[fileId];
          if (old) {
            await assertCatalogCoverFile(this.root(source), old.path);
            if ((await readFile(path.join(this.root(source), old.path))).equals(decoded.bytes)) relativePath = old.path;
          }
          if (!relativePath) {
            const asset = await storeCatalogCover(this.root(source), image.dataURL);
            createdAssets.push(asset);
            relativePath = asset.relativePath;
          }
          externalFiles[fileId] = { path: relativePath, mimeType, created: Number.isFinite(image.created) ? image.created : Date.now() };
        }
        for (const fileId of usedFiles) if (typeof fileId === 'string' && !externalFiles[fileId]) throw new CatalogError(422, serverText(messages).boardImageMissing);
        const bytes = Buffer.from(JSON.stringify({ type: 'excalidraw', version: 2, name: input.title.trim(), elements: scene.elements, appState: scene.appState, files: {}, externalFiles }, null, 2) + '\n');
        if (bytes.length > 20 * 1024 * 1024) throw new CatalogError(422, serverText(messages).boardTooLarge);
        // An unchanged board is a no-op: no rewrite, no journal event (2026-11-04).
        if (current && hash(current) === hash(bytes)) {
          return { id, title: input.title.trim(), hash: hash(bytes), path: `boards/${id}.excalidraw`,
            linkedCardIds: linkedCards(scene), updatedAt: (await lstat(filename)).mtime.toISOString(), access: nextAccess, scene };
        }
        await writeFile(temporary, bytes, { flag: 'wx' });
        if (await this.directory(source) !== directory) throw new CatalogError(422, serverText(messages).boardDirectoryChanged);
        let latest: Buffer | null = null;
        try { latest = await readFile(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if ((latest ? hash(latest) : '') !== input.hash) throw new CatalogError(409, serverText(messages).boardChangedOnSave);
        await rename(temporary, filename);
        renamed = true;
        savedHash = hash(bytes);
      } finally {
        if (!renamed) {
          if (await this.directory(source) === directory) await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
          for (const asset of createdAssets) await asset.remove();
        }
      }
      // The board journal (2026-11-04): one event per real save; a failure here must not fail the save itself.
      // 2026-11-06: the record is a project file, so it speaks the project's format language, not the request's.
      try {
        const formatLanguage = await projectLanguage(this.root(source));
        await appendActivity(this.root(source), describeBoardSave({
          id, title: input.title.trim(),
          elementCount: scene.elements.filter(element => !element.isDeleted).length,
          access: nextAccess,
        }, formatLanguage), formatLanguage);
      } catch { /* the file is already renamed; journaling is best-effort */ }
      // 2026-11-03: return the exact committed revision, avoiding a post-save read failure and duplicate-create retry.
      return { id, title: input.title.trim(), hash: savedHash, path: `boards/${id}.excalidraw`,
        linkedCardIds: linkedCards(scene), updatedAt: new Date().toISOString(), access: nextAccess, scene };
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async close(): Promise<void> { await this.writes; }
}
