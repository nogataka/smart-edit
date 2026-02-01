import fs from 'node:fs/promises';
import path from 'node:path';

import { JetBrainsCodeEditorNotAvailableError, PositionInFile } from './symbol.js';
import type {
  JetBrainsSymbol,
  LanguageServerSymbol,
  LanguageServerSymbolRetriever,
  Symbol as SmartEditSymbol
} from './symbol.js';
import type { SmartEditAgent } from './agent.js';

interface EditedFile {
  getContents(): string;
  deleteTextBetweenPositions(start: PositionInFile, end: PositionInFile): void;
  insertTextAtPosition(position: PositionInFile, text: string): void;
}

function assertNonNegative(value: number, description: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }
}

function positionToOffset(text: string, position: PositionInFile): number {
  assertNonNegative(position.line, 'Position line');
  assertNonNegative(position.col, 'Position column');

  let line = 0;
  let column = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (line === position.line && column === position.col) {
      return index;
    }

    const char = text[index];
    if (char === '\n') {
      line += 1;
      column = 0;
      continue;
    }
    if (char === '\r') {
      continue;
    }
    column += 1;
  }

  if (line === position.line && column === position.col) {
    return text.length;
  }

  throw new Error(`Position (${position.line}, ${position.col}) is out of bounds for provided content.`);
}

class InMemoryEditedFile implements EditedFile {
  private contents: string;

  constructor(contents: string) {
    this.contents = contents;
  }

  getContents(): string {
    return this.contents;
  }

  deleteTextBetweenPositions(start: PositionInFile, end: PositionInFile): void {
    const startOffset = positionToOffset(this.contents, start);
    const endOffset = positionToOffset(this.contents, end);
    if (endOffset < startOffset) {
      throw new Error('End position must not precede start position.');
    }
    this.contents = `${this.contents.slice(0, startOffset)}${this.contents.slice(endOffset)}`;
  }

  insertTextAtPosition(position: PositionInFile, text: string): void {
    const offset = positionToOffset(this.contents, position);
    this.contents = `${this.contents.slice(0, offset)}${text}${this.contents.slice(offset)}`;
  }
}

export abstract class CodeEditor<TSymbol extends SmartEditSymbol> {
  protected readonly projectRoot: string;
  protected readonly agent: SmartEditAgent | null;

  constructor(projectRoot: string, agent: SmartEditAgent | null = null) {
    this.projectRoot = projectRoot;
    this.agent = agent;
  }

  protected abstract openFile(relativePath: string): Promise<EditedFile>;

  protected abstract findUniqueSymbol(namePath: string, relativeFilePath: string): Promise<TSymbol> | TSymbol;

  protected async withEditedFile(
    relativePath: string,
    handler: (file: EditedFile) => Promise<void> | void
  ): Promise<void> {
    const editedFile = await this.openFile(relativePath);
    await handler(editedFile);

    const absolutePath = path.resolve(this.projectRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, editedFile.getContents(), { encoding: 'utf-8' });
    this.agent?.markFileModified(relativePath);
  }

  async replaceBody(namePath: string, relativeFilePath: string, body: string): Promise<void> {
    const symbol = await this.findUniqueSymbol(namePath, relativeFilePath);
    const startPos = symbol.getBodyStartPositionOrRaise();
    const endPos = symbol.getBodyEndPositionOrRaise();
    const trimmedBody = body.trim();

    await this.withEditedFile(relativeFilePath, (editedFile) => {
      editedFile.deleteTextBetweenPositions(startPos, endPos);
      editedFile.insertTextAtPosition(startPos, trimmedBody);
    });
  }

  async replace_body(namePath: string, relativeFilePath: string, body: string): Promise<void> {
    await this.replaceBody(namePath, relativeFilePath, body);
  }

  protected static countLeadingNewlines(text: string): number {
    let count = 0;
    for (const char of text) {
      if (char === '\n') {
        count += 1;
      } else if (char === '\r') {
        continue;
      } else {
        break;
      }
    }
    return count;
  }

  protected static countTrailingNewlines(text: string): number {
    let count = 0;
    for (let index = text.length - 1; index >= 0; index -= 1) {
      const char = text[index];
      if (char === '\n') {
        count += 1;
      } else if (char === '\r') {
        continue;
      } else {
        break;
      }
    }
    return count;
  }

  async insertAfterSymbol(namePath: string, relativeFilePath: string, body: string): Promise<void> {
    const symbol = await this.findUniqueSymbol(namePath, relativeFilePath);
    const endPos = symbol.getBodyEndPositionOrRaise();

    let normalizedBody = body;
    if (!normalizedBody.endsWith('\n')) {
      normalizedBody += '\n';
    }

    const originalLeading = CodeEditor.countLeadingNewlines(normalizedBody);
    normalizedBody = normalizedBody.replace(/^[\r\n]+/u, '');

    const minimumEmptyLines = symbol.isNeighbouringDefinitionSeparatedByEmptyLine() ? 1 : 0;
    const leadingEmptyLines = Math.max(minimumEmptyLines, originalLeading);

    if (leadingEmptyLines > 0) {
      normalizedBody = `${'\n'.repeat(leadingEmptyLines)}${normalizedBody}`;
    }

    normalizedBody = normalizedBody.replace(/[\r\n]+$/u, '') + '\n';

    const insertPosition = new PositionInFile({ line: endPos.line, col: endPos.col });

    await this.withEditedFile(relativeFilePath, (editedFile) => {
      editedFile.insertTextAtPosition(insertPosition, normalizedBody);
    });
  }

  async insert_after_symbol(namePath: string, relativeFilePath: string, body: string): Promise<void> {
    await this.insertAfterSymbol(namePath, relativeFilePath, body);
  }

  async insertBeforeSymbol(namePath: string, relativeFilePath: string, body: string): Promise<void> {
    const symbol = await this.findUniqueSymbol(namePath, relativeFilePath);
    const startPos = symbol.getBodyStartPositionOrRaise();
    let normalizedBody = body.replace(/\s+$/u, '') + '\n';

    const originalTrailing = CodeEditor.countTrailingNewlines(normalizedBody);
    const minimumTrailing = symbol.isNeighbouringDefinitionSeparatedByEmptyLine() ? 1 : 0;
    const trailing = Math.max(minimumTrailing, Math.max(0, originalTrailing - 1));
    if (trailing > 0) {
      normalizedBody += '\n'.repeat(trailing);
    }

    await this.withEditedFile(relativeFilePath, (editedFile) => {
      editedFile.insertTextAtPosition(new PositionInFile({ line: startPos.line, col: 0 }), normalizedBody);
    });
  }

  async insert_before_symbol(namePath: string, relativeFilePath: string, body: string): Promise<void> {
    await this.insertBeforeSymbol(namePath, relativeFilePath, body);
  }

  async insertAtLine(relativePath: string, line: number, content: string): Promise<void> {
    assertNonNegative(line, 'line');
    await this.withEditedFile(relativePath, (editedFile) => {
      editedFile.insertTextAtPosition(new PositionInFile({ line, col: 0 }), content);
    });
  }

  async insert_at_line(relativePath: string, line: number, content: string): Promise<void> {
    await this.insertAtLine(relativePath, line, content);
  }

  async deleteLines(relativePath: string, startLine: number, endLine: number): Promise<void> {
    assertNonNegative(startLine, 'start_line');
    assertNonNegative(endLine, 'end_line');
    if (endLine < startLine) {
      throw new Error('end_line must not be less than start_line.');
    }
    await this.withEditedFile(relativePath, (editedFile) => {
      const start = new PositionInFile({ line: startLine, col: 0 });
      const end = new PositionInFile({ line: endLine + 1, col: 0 });
      editedFile.deleteTextBetweenPositions(start, end);
    });
  }

  async delete_lines(relativePath: string, startLine: number, endLine: number): Promise<void> {
    await this.deleteLines(relativePath, startLine, endLine);
  }

  async deleteSymbol(namePath: string, relativeFilePath: string): Promise<void> {
    const symbol = await this.findUniqueSymbol(namePath, relativeFilePath);
    const startPos = symbol.getBodyStartPositionOrRaise();
    const endPos = symbol.getBodyEndPositionOrRaise();

    await this.withEditedFile(relativeFilePath, (editedFile) => {
      editedFile.deleteTextBetweenPositions(startPos, endPos);
    });
  }

  async delete_symbol(namePath: string, relativeFilePath: string): Promise<void> {
    await this.deleteSymbol(namePath, relativeFilePath);
  }
}

export class LanguageServerCodeEditor extends CodeEditor<LanguageServerSymbol> {
  private readonly symbolRetriever: LanguageServerSymbolRetriever;

  constructor(symbolRetriever: LanguageServerSymbolRetriever, agent: SmartEditAgent | null = null) {
    super(symbolRetriever.get_language_server().getRepositoryRootPath(), agent);
    this.symbolRetriever = symbolRetriever;
  }

  protected async openFile(relativePath: string): Promise<EditedFile> {
    const absolutePath = path.resolve(this.projectRoot, relativePath);
    const buffer = await fs.readFile(absolutePath, { encoding: 'utf-8' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${relativePath}`);
      }
      throw error;
    });
    return new InMemoryEditedFile(buffer);
  }

  protected findUniqueSymbol(namePath: string, relativeFilePath: string): LanguageServerSymbol {
    const matches = this.symbolRetriever.find_by_name(namePath, false, undefined, undefined, false, relativeFilePath);
    if (matches.length === 0) {
      throw new Error(`No symbol with name ${namePath} found in file ${relativeFilePath}`);
    }
    if (matches.length > 1) {
      const locations = matches
        .map((symbol) => symbol.location.to_dict())
        .map((location) => JSON.stringify(location))
        .join(', ');
      throw new Error(
        `Found multiple symbols with name ${namePath} in file ${relativeFilePath}. Their locations are: [${locations}]`
      );
    }
    const [match] = matches;
    if (!match) {
      throw new Error(`Invariant violation while retrieving symbol ${namePath} in ${relativeFilePath}`);
    }
    return match;
  }
}

export class JetBrainsCodeEditor extends CodeEditor<JetBrainsSymbol> {
  constructor(projectRoot: string, agent: SmartEditAgent | null = null) {
    super(projectRoot, agent);
    throw new JetBrainsCodeEditorNotAvailableError();
  }

  // The following methods exist to satisfy the abstract contract but will never be executed
  // because the constructor throws immediately.
  /* c8 ignore start */
  protected openFile(_relativePath: string): Promise<EditedFile> {
    throw new JetBrainsCodeEditorNotAvailableError();
  }

  protected findUniqueSymbol(_namePath: string, _relativeFilePath: string): JetBrainsSymbol {
    throw new JetBrainsCodeEditorNotAvailableError();
  }
  /* c8 ignore stop */
}
