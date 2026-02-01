#!/usr/bin/env node

// Simple STDIO-based MCP test client.
// Usage:
//   node scripts/stdio_mcp_test_client.js <command> [args...]
// Example:
//   node scripts/stdio_mcp_test_client.js npx -y @nogataka/smart-edit@latest start-mcp-server --context codex

import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  LoggingMessageNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js';

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    globalThis.console.error('Usage: node scripts/stdio_mcp_test_client.js <command> [args...]');
    process.exitCode = 1;
    return;
  }

  const [command, ...commandArgs] = argv;

  const transport = new StdioClientTransport({
    command,
    args: commandArgs,
    env: process.env,
    stdio: 'pipe'
  });

  const client = new Client({
    name: 'smart-edit-stdio-test-client',
    version: 'dev'
  });

  const logNotification = (notification, message) => {
    globalThis.console.log(`[notification] ${notification.method}${message ? ` — ${message}` : ''}`);
    const params = notification.params;
    if (params && Object.keys(params).length > 0) {
      globalThis.console.log(
        `  params: ${JSON.stringify(params, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)}`
      );
    }
  };

  client.setNotificationHandler(ToolListChangedNotificationSchema, (notification) => {
    logNotification(notification, 'Tool list changed');
  });

  client.setNotificationHandler(PromptListChangedNotificationSchema, (notification) => {
    logNotification(notification, 'Prompt list changed');
  });

  client.setNotificationHandler(ResourceListChangedNotificationSchema, (notification) => {
    logNotification(notification, 'Resource list changed');
  });

  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
    logNotification(notification, `Resource updated: ${notification.params?.uri ?? ''}`);
  });

  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const { level, message, logger } = notification.params ?? {};
    const extra = [level, logger].filter(Boolean).join(' / ');
    logNotification(notification, extra ? `${extra}: ${message ?? ''}` : message ?? '');
  });

  client.fallbackNotificationHandler = (notification) => {
    logNotification(notification, 'Unhandled notification');
  };

  const logList = (heading, items, formatter) => {
    globalThis.console.log(`${heading} (${items.length}):`);
    if (items.length === 0) {
      globalThis.console.log('  (none)');
      return;
    }
    for (const item of items) {
      globalThis.console.log(`  - ${formatter(item)}`);
    }
  };

  try {
    await client.connect(transport);
    globalThis.console.log('Connected to MCP server. Performing basic health checks...');

    const serverInfo = client.getServerVersion();
    const serverCapabilities = client.getServerCapabilities();
    const instructions = client.getInstructions();
    globalThis.console.log('Server info:', serverInfo ?? '(not provided)');
    globalThis.console.log('Server capabilities:', serverCapabilities ?? '(not provided)');
    if (instructions) {
      globalThis.console.log('Server instructions:', instructions);
    }

    const tools = await client.listTools();
    logList('Discovered tools', tools.tools, (tool) => {
      const description = tool.description ? ` — ${tool.description}` : '';
      return `${tool.name}${description}`;
    });

    if (serverCapabilities?.prompts) {
      try {
        const prompts = [];
        let cursor;
        do {
          const params = cursor ? { cursor } : undefined;
          const response = await client.listPrompts(params);
          prompts.push(...response.prompts);
          cursor = response.nextCursor ?? null;
        } while (cursor);
        logList('Discovered prompts', prompts, (prompt) => {
          const description = prompt.description ? ` — ${prompt.description}` : '';
          const args =
            prompt.arguments && prompt.arguments.length > 0
              ? ` (args: ${prompt.arguments.map((arg) => arg.name).join(', ')})`
              : '';
          return `${prompt.name}${description}${args}`;
        });
      } catch (error) {
        globalThis.console.warn('Failed to list prompts:', error);
      }
    } else {
      globalThis.console.log('Prompts capability not advertised. Skipping listPrompts().');
    }

    if (serverCapabilities?.resources) {
      try {
        const resources = [];
        let cursor;
        do {
          const params = cursor ? { cursor } : undefined;
          const response = await client.listResources(params);
          resources.push(...response.resources);
          cursor = response.nextCursor ?? null;
        } while (cursor);
        logList('Discovered resources', resources, (resource) => {
          const description = resource.description ? ` — ${resource.description}` : '';
          const mime = resource.mimeType ? ` [${resource.mimeType}]` : '';
          return `${resource.uri}${mime}${description}`;
        });
      } catch (error) {
        globalThis.console.warn('Failed to list resources:', error);
      }
    } else {
      globalThis.console.log('Resources capability not advertised. Skipping listResources().');
    }

    globalThis.console.log('Health check complete. Disconnecting...');
  } catch (error) {
    globalThis.console.error('MCP stdio test client failed:', error);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

await main();
