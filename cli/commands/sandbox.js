/**
 * Sandbox commands for rudder CLI
 * Manages sandbox-runtime (srt) configuration and dependencies
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';
import { getPathsInfo, findProjectRoot } from '../lib/core.js';

/**
 * Detect OS and required dependencies
 */
function detectPlatform() {
  const platform = os.platform();

  if (platform === 'linux') {
    return {
      platform: 'linux',
      deps: [
        { name: 'ripgrep', cmd: 'rg', pkg: 'ripgrep' },
        { name: 'bubblewrap', cmd: 'bwrap', pkg: 'bubblewrap' },
        { name: 'socat', cmd: 'socat', pkg: 'socat' }
      ],
      installCmd: 'sudo dnf install ripgrep bubblewrap socat  # or apt install'
    };
  } else if (platform === 'darwin') {
    return {
      platform: 'macos',
      deps: [
        { name: 'ripgrep', cmd: 'rg', pkg: 'ripgrep' }
      ],
      installCmd: 'brew install ripgrep'
    };
  } else {
    return {
      platform: platform,
      deps: [],
      installCmd: null,
      unsupported: true
    };
  }
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check srt installation and dependencies
 */
function checkSrt() {
  const results = {
    srtInstalled: false,
    srtVersion: null,
    platform: null,
    deps: [],
    missing: [],
    configPath: null,
    configExists: false
  };

  // Check srt
  try {
    const version = execSync('npm list -g @anthropic-ai/sandbox-runtime --depth=0 2>/dev/null', { encoding: 'utf8' });
    results.srtInstalled = version.includes('@anthropic-ai/sandbox-runtime');
    const match = version.match(/@anthropic-ai\/sandbox-runtime@([\d.]+)/);
    if (match) results.srtVersion = match[1];
  } catch {
    results.srtInstalled = commandExists('srt');
  }

  // Check platform deps
  const platformInfo = detectPlatform();
  results.platform = platformInfo.platform;

  for (const dep of platformInfo.deps) {
    const exists = commandExists(dep.cmd);
    results.deps.push({ ...dep, installed: exists });
    if (!exists) results.missing.push(dep);
  }

  // Check config
  const paths = getPathsInfo();
  if (paths.srtConfig) {
    results.configPath = paths.srtConfig.absolute;
    results.configExists = fs.existsSync(paths.srtConfig.absolute);
  }

  return { ...results, platformInfo };
}

/**
 * Generate default srt config
 */
function generateDefaultConfig(projectRoot) {
  const homeDir = os.homedir();

  return {
    network: {
      allowedDomains: [
        'api.anthropic.com',
        '*.anthropic.com',
        'sentry.io',
        'statsig.anthropic.com',
        'github.com',
        '*.github.com',
        'api.github.com',
        'raw.githubusercontent.com',
        'registry.npmjs.org',
        '*.npmjs.org'
      ],
      deniedDomains: []
    },
    filesystem: {
      allowWrite: [
        '.',
        `${homeDir}/.claude`,
        `${homeDir}/.claude.json`,
        `${homeDir}/.npm/_logs`,
        '/tmp'
      ],
      denyWrite: [],
      denyRead: [
        `${homeDir}/.ssh`,
        `${homeDir}/.gnupg`,
        `${homeDir}/.aws`
      ]
    }
  };
}

/**
 * sandbox:check - Check srt installation and dependencies
 */
function sandboxCheck(args, options) {
  const status = checkSrt();

  console.log('Sandbox Runtime Status\n');
  console.log('='.repeat(50));

  // srt installation
  console.log(`\nsrt installed:    ${status.srtInstalled ? '✓ Yes' : '✗ No'}`);
  if (status.srtVersion) {
    console.log(`srt version:      ${status.srtVersion}`);
  }

  // Platform
  console.log(`\nPlatform:         ${status.platform}`);

  // Dependencies
  if (status.deps.length > 0) {
    console.log('\nDependencies:');
    for (const dep of status.deps) {
      const icon = dep.installed ? '✓' : '✗';
      console.log(`  ${icon} ${dep.name} (${dep.cmd})`);
    }
  }

  // Config
  console.log(`\nConfig path:      ${status.configPath || 'N/A'}`);
  console.log(`Config exists:    ${status.configExists ? '✓ Yes' : '✗ No'}`);

  // Recommendations
  if (!status.srtInstalled || status.missing.length > 0 || !status.configExists) {
    console.log('\n' + '='.repeat(50));
    console.log('Setup Required:\n');

    if (!status.srtInstalled) {
      console.log('  npm install -g @anthropic-ai/sandbox-runtime');
    }

    if (status.missing.length > 0 && status.platformInfo.installCmd) {
      console.log(`  ${status.platformInfo.installCmd}`);
    }

    if (!status.configExists) {
      console.log('  rudder sandbox:init    # Generate config');
    }
  } else {
    console.log('\n✓ Sandbox ready');
  }

  // Always show path customization hint
  console.log('\nCustomize path in .sailing/paths.yaml:');
  console.log('  srtConfig: ~/.srt-settings.json    # Global');
  console.log('  srtConfig: .sailing/srt.json       # Per-project');

  return status;
}

/**
 * sandbox:init - Initialize srt config
 */
function sandboxInit(args, options) {
  const paths = getPathsInfo();
  const projectRoot = findProjectRoot();

  if (!paths.srtConfig) {
    console.error('Error: Cannot determine srt config path');
    process.exit(1);
  }

  const configPath = paths.srtConfig.absolute;

  // Check if exists
  if (fs.existsSync(configPath) && !options.force) {
    console.log(`Config already exists: ${configPath}`);
    console.log('Use --force to overwrite');
    return;
  }

  // Generate config
  const config = generateDefaultConfig(projectRoot);

  // Ensure directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write config
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Created: ${configPath}`);
  console.log('\nDefault domains allowed:');
  for (const domain of config.network.allowedDomains) {
    console.log(`  - ${domain}`);
  }
  console.log('\nEdit this file to customize sandbox restrictions.');
}

/**
 * sandbox:show - Show current config
 */
function sandboxShow(args, options) {
  const paths = getPathsInfo();

  if (!paths.srtConfig || !fs.existsSync(paths.srtConfig.absolute)) {
    console.log('No srt config found. Run: rudder sandbox:init');
    return;
  }

  const config = JSON.parse(fs.readFileSync(paths.srtConfig.absolute, 'utf8'));
  console.log(`Config: ${paths.srtConfig.absolute}\n`);
  console.log(JSON.stringify(config, null, 2));
}

/**
 * Register sandbox commands
 */
export function registerSandboxCommands(program) {
  const sandbox = program
    .command('sandbox')
    .description('Manage sandbox-runtime (srt) for agent isolation');

  sandbox
    .command('check')
    .description('Check srt installation and dependencies')
    .action((options) => sandboxCheck([], options));

  sandbox
    .command('init')
    .description('Initialize srt config for this project')
    .option('-f, --force', 'Overwrite existing config')
    .action((options) => sandboxInit([], options));

  sandbox
    .command('show')
    .description('Show current srt config')
    .action((options) => sandboxShow([], options));

  // sandbox:run - proxy to claude with sandbox
  sandbox
    .command('run [prompt...]')
    .description('Run Claude with sandbox (debug/test mode)')
    .option('-w, --workdir <path>', 'Working directory (default: temp dir)')
    .option('-p, --prompt <text>', 'Prompt text (alternative to positional args)')
    .option('--no-sandbox', 'Run without sandbox wrapper')
    .option('--debug', 'Enable srt debug mode')
    .action((promptArgs, options) => {
      // Use temp dir by default for safety
      let cwd;
      if (options.workdir) {
        cwd = path.resolve(options.workdir);
      } else {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rudder-sandbox-'));
        console.error(`Created temp workdir: ${cwd}`);
      }

      // Get prompt from args or option
      let prompt = options.prompt || promptArgs.join(' ');

      // If no prompt, try to read from stdin
      if (!prompt) {
        // Check if stdin has data (not a TTY)
        if (!process.stdin.isTTY) {
          prompt = fs.readFileSync(0, 'utf8').trim();
        }
      }

      if (!prompt) {
        console.error('Usage: rudder sandbox:run "your prompt"');
        console.error('   or: echo "prompt" | rudder sandbox:run');
        process.exit(1);
      }

      // Build command
      let cmd, args;
      if (options.sandbox !== false) {
        const paths = getPathsInfo();
        cmd = 'srt';
        args = [];

        // Debug mode
        if (options.debug) {
          args.push('--debug');
        }

        // Use project config if available
        if (paths.srtConfig && fs.existsSync(paths.srtConfig.absolute)) {
          args.push('--settings', paths.srtConfig.absolute);
        }

        args.push('claude', '-p', prompt);
      } else {
        cmd = 'claude';
        args = ['-p', prompt];
      }

      console.error(`CWD: ${cwd}`);
      console.error(`CMD: ${cmd} ${args.join(' ')}`);
      console.error('---');

      // Run synchronously with stdio inherited
      const result = spawnSync(cmd, args, {
        cwd,
        stdio: 'inherit',
        env: {
          ...process.env,
          ...(options.debug && { SRT_DEBUG: '1' })
        }
      });

      process.exit(result.status || 0);
    });

}
