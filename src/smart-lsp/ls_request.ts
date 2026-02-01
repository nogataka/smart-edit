import type {
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentSymbolResult,
  DocumentSymbolsOptions,
  FullSymbolTreeOptions,
  ReferenceInSymbol,
  ReferencingSymbolsOptions,
  SmartLanguageServerHandler,
  SmartLanguageServerNotifications,
  SmartLanguageServerRequests,
  UnifiedSymbolInformation
} from './ls.js';

export interface DocumentSymbolRequestParams {
  textDocument: { uri: string };
  options?: DocumentSymbolsOptions;
}

export interface LanguageServerRequestDelegate {
  sendRequest(method: string, params?: unknown): unknown;
}

export class LanguageServerRequest implements SmartLanguageServerRequests {
  private readonly delegate: LanguageServerRequestDelegate;

  constructor(handler: LanguageServerRequestDelegate) {
    this.delegate = handler;
  }

  documentSymbol(params: DocumentSymbolRequestParams): DocumentSymbolResult | null {
    return this.delegate.sendRequest('textDocument/documentSymbol', params) as DocumentSymbolResult | null;
  }

  fullSymbolTree(params: FullSymbolTreeOptions): UnifiedSymbolInformation[] | null {
    return this.delegate.sendRequest('smart-edit/fullSymbolTree', params) as UnifiedSymbolInformation[] | null;
  }

  referencingSymbols(params: ReferencingSymbolsOptions): ReferenceInSymbol[] | null {
    return this.delegate.sendRequest('smart-edit/referencingSymbols', params) as ReferenceInSymbol[] | null;
  }

  overview(relativeFilePath: string): Record<string, UnifiedSymbolInformation[]> | null {
    return this.delegate.sendRequest('smart-edit/overview', relativeFilePath) as Record<string, UnifiedSymbolInformation[]> | null;
  }

  shutdown(): void {
    void this.delegate.sendRequest('shutdown');
  }
}

export class LspNotification implements SmartLanguageServerNotifications {
  private readonly send: (method: string, params?: unknown) => void;

  constructor(sender: (method: string, params?: unknown) => void) {
    this.send = sender;
  }

  initialized(params: unknown = null): void {
    this.send('initialized', params);
  }

  exit(): void {
    this.send('exit');
  }

  didOpenTextDocument(params: DidOpenTextDocumentParams): void {
    this.send('textDocument/didOpen', params ?? null);
  }

  didChangeTextDocument(params: DidChangeTextDocumentParams): void {
    this.send('textDocument/didChange', params ?? null);
  }

  didCloseTextDocument(params: DidCloseTextDocumentParams): void {
    this.send('textDocument/didClose', params ?? null);
  }
}

export type SmartLanguageServerHandlerLike = SmartLanguageServerHandler & {
  sendRequest(method: string, params?: unknown): unknown;
};
