/* eslint-env node */

// Simple JSON-RPC server used for tests. Implements a minimal subset of the
// Language Server Protocol required by the NodeLanguageServerHandler tests.

import { Buffer } from 'node:buffer';
import process from 'node:process';

const { stdin, stdout } = process;

let buffer = Buffer.alloc(0);

stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

function processBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    const total = headerEnd + 4 + length;
    if (buffer.length < total) {
      return;
    }
    const body = buffer.slice(headerEnd + 4, total).toString('utf8');
    buffer = buffer.slice(total);

    try {
      const message = JSON.parse(body);
      handleMessage(message);
    } catch (error) {
      sendNotification('window/logMessage', {
        type: 1,
        message: `Malformed JSON: ${error}`
      });
    }
  }
}

function sendNotification(method, params) {
  sendMessage({ jsonrpc: '2.0', method, params });
}

function sendResponse(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`, 'utf8');
  stdout.write(Buffer.concat([header, body]));
}

function handleMessage(message) {
  if (message.method === 'textDocument/documentSymbol') {
    const result = {
      documentSymbols: [
        {
          name: 'main',
          kind: 12,
          location: {
            relativePath: 'app.py',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 2, character: 0 }
            }
          }
        }
      ],
      outlineSymbols: []
    };
    sendResponse(message.id, result);
    sendNotification('window/logMessage', {
      type: 3,
      message: 'documentSymbol handled'
    });
    return;
  }

  if (message.method === 'smart-edit/fullSymbolTree') {
    sendResponse(message.id, []);
    return;
  }

  if (message.method === 'smart-edit/referencingSymbols') {
    sendResponse(message.id, []);
    return;
  }

  if (message.method === 'smart-edit/overview') {
    sendResponse(message.id, {});
    return;
  }

  if (message.method === 'smart-edit/noResponse') {
    // Intentionally do not respond to exercise request timeouts.
    return;
  }

  if (message.method === 'shutdown') {
    sendResponse(message.id, null);
    sendNotification('server/shuttingDown');
    process.exit(0);
    return;
  }

  // Notifications such as didOpen/didChange don't require a response.
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    return;
  }

  sendError(message.id, -32601, `Unhandled method ${message.method}`);
}
