import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { join } from 'path';
import { saveConfig, expandHome, getConfigFile, getConfigDir } from '../services/ConfigService.js';
import { desktopStateExists } from '../services/DesktopService.js';

function note(lines: string[]): void {
  console.log('');
  for (const line of lines) console.log(`  ${pc.dim(line)}`);
  console.log('');
}

export async function runSetupWizard(isFirstRun = false): Promise<void> {
  console.log('');

  if (isFirstRun) {
    p.intro(pc.bold(pc.cyan('Welcome to opencode-remote-telegram!')));
    console.log(`  ${pc.dim("Looks like this is your first time. Let's get you set up.")}`);
    console.log('');
  } else {
    p.intro(pc.bold(pc.cyan('opencode-remote-telegram — setup')));
  }

  // ── Step 1: Telegram Bot Token ──────────────────────────────────────────────
  p.log.step(pc.bold('Step 1 of 5 — Telegram Bot'));
  note([
    '1. Open Telegram and search for @BotFather',
    '2. Send /newbot and follow the instructions',
    '3. BotFather will give you a token that looks like:',
    '   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz',
    '4. Copy that token and paste it below.',
    '',
    `   The token will be stored in:`,
    `   ${getConfigFile()}`,
  ]);

  const telegramToken = await p.password({
    message: 'Paste your Telegram Bot Token:',
    validate: v => {
      if (!v) return 'Required.';
      if (!String(v).includes(':')) return 'That does not look like a valid bot token.';
    },
  });
  if (p.isCancel(telegramToken)) { p.cancel('Setup cancelled.'); process.exit(0); }

  // ── Step 2: Allowed user IDs ────────────────────────────────────────────────
  p.log.step(pc.bold('Step 2 of 5 — Access control'));
  note([
    'Restrict the bot to specific Telegram users.',
    'To find your user ID, message @userinfobot in Telegram.',
    'Leave empty to allow anyone who can reach the bot — not recommended',
    'if your bot token is shared or the bot is public.',
  ]);

  const allowedRaw = await p.text({
    message: 'Allowed Telegram User IDs (comma-separated, leave empty to allow all):',
    placeholder: '123456789, 987654321',
  });
  if (p.isCancel(allowedRaw)) { p.cancel('Setup cancelled.'); process.exit(0); }
  const allowedUserIds = String(allowedRaw || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  // ── Step 3: Projects base paths ─────────────────────────────────────────────
  p.log.step(pc.bold('Step 3 of 5 — Projects'));
  note([
    'Point to one or more folders that contain your projects.',
    'Every subdirectory will be auto-discovered as a project.',
    'Example: ~/Projects  →  discovers ~/Projects/my-app, ~/Projects/api, …',
    '',
    'You can enter multiple directories (comma-separated).',
    'Example: ~/Projects, ~/Work/clients',
  ]);

  const projectsBasePathRaw = await p.text({
    message: 'Projects base directories (comma-separated):',
    placeholder: '~/Projects',
    validate: v => {
      if (!v) return 'Required. Enter at least one directory.';
      const paths = String(v).split(',').map(s => s.trim()).filter(Boolean);
      for (const pathStr of paths) {
        if (!existsSync(expandHome(pathStr))) return `Directory not found: ${pathStr}`;
      }
    },
  });
  if (p.isCancel(projectsBasePathRaw)) { p.cancel('Setup cancelled.'); process.exit(0); }

  const projectsBasePaths = String(projectsBasePathRaw)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // ── Step 3b: OpenCode Desktop integration ──────────────────────────────────
  let discoverDesktopProjects = false;

  if (desktopStateExists()) {
    note([
      'OpenCode Desktop detected!',
      'Projects you open in OpenCode Desktop can automatically appear',
      'in the Telegram bot — even if they are not in the base directories above.',
    ]);

    const enableDesktop = await p.confirm({
      message: 'Auto-discover projects from OpenCode Desktop?',
      initialValue: true,
    });
    if (p.isCancel(enableDesktop)) { p.cancel('Setup cancelled.'); process.exit(0); }
    discoverDesktopProjects = enableDesktop;
  }

  // ── Step 4: OpenCode config ─────────────────────────────────────────────────
  p.log.step(pc.bold('Step 4 of 5 — OpenCode config'));
  note([
    'When opencode-remote-telegram starts a coding server for a project,',
    'it runs "opencode serve" in that project directory.',
    '',
    'If your projects have their own opencode.json, those are loaded —',
    'but they usually lack provider credentials (baseURL, apiKey) and will fail.',
    '',
    'Recommended: use a single global opencode.json for all projects.',
    `You can place it here and it will always be preferred:`,
    `  ${getConfigDir()}/opencode.json`,
    '',
    'If you choose project-specific, make sure each project\'s opencode.json',
    'includes the full provider config (baseURL, apiKey, models).',
  ]);

  const configMode = await p.select({
    message: 'Which OpenCode config should be used?',
    options: [
      {
        value: 'global',
        label: 'Global config for all projects (recommended)',
        hint: `one opencode.json at ${getConfigDir()}`,
      },
      {
        value: 'project',
        label: 'Project-specific config',
        hint: 'each project uses its own opencode.json',
      },
    ],
  });
  if (p.isCancel(configMode)) { p.cancel('Setup cancelled.'); process.exit(0); }

  const useGlobalConfig = configMode === 'global';
  let openCodeConfigPath: string | undefined;

  if (useGlobalConfig) {
    // Check if config already exists in the recommended location
    const defaultPath = `${getConfigDir()}/opencode.json`;
    const defaultExists = existsSync(defaultPath);

    if (defaultExists) {
      p.log.success(`Found opencode.json at ${defaultPath} — will use it automatically.`);
      openCodeConfigPath = defaultPath;
    } else {
      note([
        `No opencode.json found at ${defaultPath} yet.`,
        'You can either:',
        `  a) Copy your existing opencode.json there:`,
        `     cp /path/to/your/opencode.json ${defaultPath}`,
        '  b) Enter a different path below.',
        '',
        'The file at that location will always be loaded first,',
        'overriding any project-level opencode.json.',
      ]);

      const configPathRaw = await p.text({
        message: 'Path to your global opencode.json:',
        placeholder: defaultPath,
        initialValue: defaultPath,
        validate: v => {
          if (!v) return 'Required when using global config.';
          if (!existsSync(expandHome(String(v)))) {
            return `File not found. Create it first or copy your existing opencode.json there.`;
          }
        },
      });
      if (p.isCancel(configPathRaw)) { p.cancel('Setup cancelled.'); process.exit(0); }
      openCodeConfigPath = String(configPathRaw);
    }
  }

  // ── Step 5: Summary & Save ──────────────────────────────────────────────────
  p.log.step(pc.bold('Step 5 of 5 — Summary'));

  console.log('');
  console.log(`  ${pc.dim('Token')}     ${pc.green('✓')} set`);
  console.log(`  ${pc.dim('Users')}     ${allowedUserIds.length > 0 ? allowedUserIds.join(', ') : pc.yellow('all (open access)')}`);
  console.log(`  ${pc.dim('Folders')}   ${projectsBasePaths.map(p => pc.cyan(p)).join(', ')}`);
  if (discoverDesktopProjects) {
    console.log(`  ${pc.dim('Desktop')}   ${pc.green('✓')} auto-discover enabled`);
  }
  console.log(`  ${pc.dim('Config')}    ${useGlobalConfig ? pc.green('global') : pc.yellow('per-project')}`);
  console.log('');

  const spin = p.spinner();
  spin.start('Saving configuration…');

  saveConfig({
    telegramToken: String(telegramToken),
    allowedUserIds,
    projectsBasePaths,
    openCodeConfigPath,
    useGlobalConfig,
    discoverDesktopProjects,
  });

  spin.stop(`Configuration saved to ${getConfigFile()}`);

  p.outro(
    pc.green('✓ Setup complete!') +
    pc.dim('\n\n  Run ') + pc.cyan('opencode-remote-telegram start') + pc.dim(' to launch the bot.\n'),
  );
}
