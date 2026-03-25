#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { config as dotenvConfig } from 'dotenv';

// Load .env from package root as optional override
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenvConfig({ path: join(pkgRoot, '.env') });

import { Command } from 'commander';
import pc from 'picocolors';
import { createRequire } from 'module';
import { isFirstRun, getConfigFile } from './services/ConfigService.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string; name: string };

const program = new Command();

program
  .name('opencode-remote-telegram')
  .description('Telegram bot for remote OpenCode CLI access')
  .version(pkg.version, '-v, --version', 'Show version number')
  .option('-d, --debug', 'Enable debug logging (same as DEBUG=1)')
  .option('--verbose', 'Alias for --debug')
  .hook('preAction', () => {
    if (program.opts().debug || program.opts().verbose) {
      process.env.DEBUG = '1';
    }
  });

program
  .command('start')
  .description('Start the Telegram bot')
  .action(async () => {
    if (isFirstRun()) {
      console.log('');
      console.log(pc.yellow('  No configuration found.'));
      console.log(pc.dim(`  Expected: ${getConfigFile()}`));
      console.log('');
      const { runSetupWizard } = await import('./setup/SetupWizard.js');
      await runSetupWizard(true);
      console.log('');
    }

    const { startBot } = await import('./bot.js');
    await startBot();
  });

program
  .command('setup')
  .description('Run the interactive setup wizard')
  .action(async () => {
    const { runSetupWizard } = await import('./setup/SetupWizard.js');
    await runSetupWizard(false);
  });

program
  .command('test')
  .description('Test connection to OpenCode — verifies models, serve and prompt')
  .action(async () => {
    const { runConnectionTest } = await import('./setup/ConnectionTest.js');
    await runConnectionTest();
  });

// No subcommand — show banner + help
if (process.argv.length === 2) {
  console.log('');
  console.log(`  ${pc.bold(pc.cyan('opencode-remote-telegram'))} ${pc.dim(`v${pkg.version}`)}`);
  console.log(`  ${pc.dim('Control OpenCode from your phone via Telegram.')}`);
  console.log('');
  program.help();
}

program.parse(process.argv);
