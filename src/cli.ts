#!/usr/bin/env node

import process from 'node:process';

import { runSmartEditCli } from './smart-edit/cli.js';

void runSmartEditCli().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
