/**
 * Install command - Unified installation/configuration for sailing
 *
 * Consolidates:
 * - MCP configuration (.mcp.json)
 * - Claude permissions (settings.local.json)
 * - Paths initialization (paths.yaml)
 * - Sandbox setup (optional)
 */
import fs from 'fs';
import path from 'path';
import { findProjectRoot, jsonOut, getPath } from '../managers/core-manager.js';
import { addDynamicHelp } from '../lib/help.js';
/**
 * Get path to .mcp.json
 */
function getMcpConfigPath() {
    const projectRoot = findProjectRoot();
    return path.join(projectRoot, '.mcp.json');
}
/**
 * Load existing .mcp.json or create empty
 */
function loadMcpConfig() {
    const configPath = getMcpConfigPath();
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        catch {
            console.error(`Warning: Could not parse ${configPath}`);
        }
    }
    return {};
}
/**
 * Save .mcp.json
 */
function saveMcpConfig(config) {
    const configPath = getMcpConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
/**
 * Get default rudder MCP server configuration
 * Uses socat to connect to the conductor socket (must be started separately)
 */
function getDefaultRudderMcp() {
    const havenPath = getPath('haven');
    const socketPath = path.join(havenPath, 'mcp-conductor.sock');
    return {
        command: 'socat',
        args: ['-', `UNIX-CONNECT:${socketPath}`]
    };
}
/**
 * Check if rudder MCP config is using the correct socat+socket format
 */
function isRudderMcpValid(server) {
    // Valid config uses socat to connect to conductor socket
    return server.command === 'socat' &&
        Array.isArray(server.args) &&
        server.args.length === 2 &&
        server.args[0] === '-' &&
        server.args[1].startsWith('UNIX-CONNECT:');
}
/**
 * Check if MCP is configured
 */
function checkMcp() {
    const config = loadMcpConfig();
    const hasRudder = !!config.mcpServers?.rudder;
    const isValid = hasRudder && isRudderMcpValid(config.mcpServers.rudder);
    return {
        configured: fs.existsSync(getMcpConfigPath()),
        hasRudder,
        isValid,
        config
    };
}
/**
 * Fix MCP configuration - adds rudder if missing or outdated, preserves others
 */
function fixMcp(options) {
    const configPath = getMcpConfigPath();
    const config = loadMcpConfig();
    if (!config.mcpServers) {
        config.mcpServers = {};
    }
    const defaultMcp = getDefaultRudderMcp();
    let added = false;
    let updated = false;
    let reason;
    if (!config.mcpServers.rudder) {
        // Add rudder MCP
        if (!options.dryRun) {
            config.mcpServers.rudder = defaultMcp;
            saveMcpConfig(config);
        }
        added = true;
    }
    else if (!isRudderMcpValid(config.mcpServers.rudder)) {
        // Outdated format - fix it automatically
        if (!options.dryRun) {
            config.mcpServers.rudder = defaultMcp;
            saveMcpConfig(config);
        }
        updated = true;
        reason = 'outdated format (now uses socat + socket)';
    }
    else if (options.force) {
        // Force update even if valid
        if (!options.dryRun) {
            config.mcpServers.rudder = defaultMcp;
            saveMcpConfig(config);
        }
        updated = true;
        reason = 'forced update';
    }
    return { added, updated, reason, path: configPath };
}
// =============================================================================
// Register Commands
// =============================================================================
async function doInstall(options) {
    // If --check, just show status
    if (options.check) {
        const mcpStatus = checkMcp();
        const permissionsOk = await checkPermissions();
        const result = {
            mcp: {
                configured: mcpStatus.configured,
                hasRudder: mcpStatus.hasRudder,
                isValid: mcpStatus.isValid,
                path: getMcpConfigPath()
            },
            permissions: permissionsOk,
            ok: mcpStatus.isValid && permissionsOk.ok
        };
        if (options.json) {
            jsonOut(result);
        }
        else {
            console.log('Installation Status\n');
            console.log('MCP Configuration:');
            console.log(`  File: ${result.mcp.path}`);
            console.log(`  Exists: ${result.mcp.configured ? 'Yes' : 'No'}`);
            if (result.mcp.hasRudder && !result.mcp.isValid) {
                console.log(`  Rudder MCP: ⚠ Outdated format (run install to fix)`);
            }
            else {
                console.log(`  Rudder MCP: ${result.mcp.hasRudder ? '✓ Configured' : '✗ Missing'}`);
            }
            console.log('\nClaude Permissions:');
            console.log(`  Required: ${permissionsOk.required}`);
            console.log(`  Present: ${permissionsOk.present}`);
            console.log(`  Status: ${permissionsOk.ok ? '✓ OK' : '✗ Missing permissions'}`);
            console.log(`\nOverall: ${result.ok ? '✓ OK' : '✗ Run `bin/rudder install` to fix'}`);
        }
        return;
    }
    // Do install/fix
    const results = {};
    // Fix MCP
    const mcpResult = fixMcp({ dryRun: options.dryRun, force: options.force });
    results.mcp = mcpResult;
    // Fix Permissions
    const permResult = await fixPermissions({ dryRun: options.dryRun });
    results.permissions = permResult;
    if (options.json) {
        jsonOut(results);
    }
    else {
        console.log('Installation\n');
        // MCP
        if (mcpResult.added) {
            if (options.dryRun) {
                console.log('MCP: Would add rudder conductor MCP (socat + socket)');
            }
            else {
                console.log('MCP: Added rudder conductor MCP (socat + socket)');
            }
        }
        else if (mcpResult.updated) {
            const reasonSuffix = mcpResult.reason ? ` - ${mcpResult.reason}` : '';
            if (options.dryRun) {
                console.log(`MCP: Would update rudder conductor MCP${reasonSuffix}`);
            }
            else {
                console.log(`MCP: Updated rudder conductor MCP${reasonSuffix}`);
            }
        }
        else {
            console.log('MCP: Already configured');
        }
        // Permissions
        if (permResult.added > 0) {
            if (options.dryRun) {
                console.log(`Permissions: Would add ${permResult.added} permissions`);
            }
            else {
                console.log(`Permissions: Added ${permResult.added} permissions`);
            }
        }
        else {
            console.log('Permissions: Already configured');
        }
        if (!options.dryRun) {
            console.log('\nDone!');
            console.log('\nReminder: Start the MCP conductor before using Claude:');
            console.log('  bin/rdrctl start');
        }
    }
}
export function registerInstallCommands(program) {
    // Main install command - does the installation by default
    const install = program.command('install')
        .description('Install/configure MCP and permissions')
        .option('--check', 'Check installation status only')
        .option('--dry-run', 'Show what would be done')
        .option('--force', 'Force update even if already configured')
        .option('--json', 'JSON output')
        .action(async (options) => {
        await doInstall(options);
    });
    // install:fix - Alias for install (for explicit fix)
    install.command('fix')
        .description('Fix installation (alias for install)')
        .option('--dry-run', 'Show what would be done')
        .option('--force', 'Force update even if already configured')
        .option('--json', 'JSON output')
        .action(async (options) => {
        await doInstall(options);
    });
    // install:check - Check status (alias for install --check)
    install.command('check')
        .description('Check installation status')
        .option('--json', 'JSON output')
        .action(async (options) => {
        await doInstall({ check: true, json: options.json });
    });
    // install:mcp - MCP-specific commands
    const mcp = install.command('mcp')
        .description('MCP configuration');
    mcp.command('check')
        .description('Check MCP configuration')
        .option('--json', 'JSON output')
        .action((options) => {
        const status = checkMcp();
        if (options.json) {
            jsonOut({
                path: getMcpConfigPath(),
                ...status
            });
        }
        else {
            console.log('MCP Configuration\n');
            console.log(`File: ${getMcpConfigPath()}`);
            console.log(`Exists: ${status.configured ? 'Yes' : 'No'}`);
            if (status.configured && status.config.mcpServers) {
                console.log('\nConfigured servers:');
                for (const [name, server] of Object.entries(status.config.mcpServers)) {
                    const isRudder = name === 'rudder';
                    const valid = isRudder && isRudderMcpValid(server);
                    const suffix = isRudder ? (valid ? ' (conductor ✓)' : ' (outdated ⚠)') : '';
                    console.log(`  ${name}: ${server.command} ${(server.args || []).join(' ')}${suffix}`);
                }
            }
            if (status.hasRudder && !status.isValid) {
                console.log(`\nRudder MCP: ⚠ Outdated format`);
                console.log('\nRun `bin/rudder install` to update.');
            }
            else {
                console.log(`\nRudder MCP: ${status.hasRudder ? '✓ Configured' : '✗ Missing'}`);
                if (!status.hasRudder) {
                    console.log('\nRun `bin/rudder install` to add rudder MCP.');
                }
            }
        }
    });
    mcp.command('fix')
        .description('Add/update rudder MCP configuration')
        .option('--dry-run', 'Show what would be done')
        .option('--force', 'Force update even if already configured')
        .option('--json', 'JSON output')
        .action((options) => {
        const result = fixMcp(options);
        if (options.json) {
            jsonOut(result);
        }
        else {
            const reasonSuffix = result.reason ? ` (${result.reason})` : '';
            if (result.added) {
                if (options.dryRun) {
                    console.log('Would add rudder MCP to .mcp.json (socat + socket)');
                }
                else {
                    console.log('Added rudder MCP to .mcp.json (socat + socket)');
                    console.log('\nReminder: Start the MCP conductor before using Claude:');
                    console.log('  bin/rdrctl start');
                }
            }
            else if (result.updated) {
                if (options.dryRun) {
                    console.log(`Would update rudder MCP in .mcp.json${reasonSuffix}`);
                }
                else {
                    console.log(`Updated rudder MCP in .mcp.json${reasonSuffix}`);
                    console.log('\nReminder: Start the MCP conductor before using Claude:');
                    console.log('  bin/rdrctl start');
                }
            }
            else {
                console.log('Rudder MCP already configured and valid');
                if (!options.force) {
                    console.log('Use --force to update anyway');
                }
            }
        }
    });
    mcp.command('show')
        .description('Show current MCP configuration')
        .option('--json', 'JSON output')
        .action((options) => {
        const configPath = getMcpConfigPath();
        if (!fs.existsSync(configPath)) {
            if (options.json) {
                jsonOut({ exists: false, path: configPath });
            }
            else {
                console.log(`MCP config not found: ${configPath}`);
            }
            return;
        }
        const config = loadMcpConfig();
        if (options.json) {
            jsonOut({ exists: true, path: configPath, config });
        }
        else {
            console.log(`File: ${configPath}\n`);
            console.log(JSON.stringify(config, null, 2));
        }
    });
    addDynamicHelp(install);
}
// =============================================================================
// Helper functions (import from permissions module logic)
// =============================================================================
async function checkPermissions() {
    const projectRoot = findProjectRoot();
    const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
    let existing = [];
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            existing = settings.permissions?.allow || [];
        }
        catch { }
    }
    const missing = BASE_PERMISSIONS.filter(p => !existing.includes(p));
    return {
        ok: missing.length === 0,
        required: BASE_PERMISSIONS.length,
        present: BASE_PERMISSIONS.length - missing.length,
        missing: missing.length
    };
}
// Base sailing permissions (same as permissions.ts)
const BASE_PERMISSIONS = [
    // MCP Conductor (all tools)
    'mcp__rudder__*',
    // Sailing skill
    'Skill(sailing)',
    // Dev commands (slash commands)
    'Skill(dev:prd-create)',
    'Skill(dev:prd-review)',
    'Skill(dev:prd-breakdown)',
    'Skill(dev:prd-story)',
    'Skill(dev:prd-story-finalize)',
    'Skill(dev:epic-create)',
    'Skill(dev:epic-review)',
    'Skill(dev:epic-breakdown)',
    'Skill(dev:task-create)',
    'Skill(dev:task-start)',
    'Skill(dev:task-done)',
    'Skill(dev:tasks-batch)',
    'Skill(dev:tasks-rewrite)',
    'Skill(dev:merge)',
    'Skill(dev:next)',
    'Skill(dev:status)',
    'Skill(dev:versions)',
    'Skill(dev:version-bump)',
    'Skill(dev:milestone-validate)',
    'Skill(dev:roadmap-sync)',
    'Skill(dev:tech-audit)',
    'Skill(dev:test-audit)',
    'Skill(dev:test-debug)',
    // Rudder CLI
    'Bash(bin/rudder:*)',
    'Bash(bin/rudder *:*)',
    'Bash(./bin/rudder:*)',
    'Bash(./bin/rudder *:*)',
    // Git
    'Bash(git:*)',
    'Bash(git *:*)',
    // Build tools
    'Bash(npm install:*)',
    'Bash(npm test:*)',
    'Bash(npm run:*)',
    'Bash(make:*)',
    // File operations
    'Bash(chmod:*)',
    'Bash(mkdir:*)',
    'Bash(ls:*)',
    'Bash(tee:*)',
    // Data processing
    'Bash(jq:*)',
    'Bash(yq:*)',
    'Bash(curl:*)',
    // Process management
    'Bash(ps:*)',
    'Bash(pgrep:*)',
    'Bash(pkill:*)',
    'Bash(lsof:*)',
    // Network
    'Bash(netstat:*)',
    'Bash(ss:*)',
    // Python
    'Bash(python:*)',
    'Bash(python3:*)',
    'Bash(pip install:*)',
    'Bash(pip3 install:*)',
    // Web
    'WebSearch',
    // Read permissions
    'Read(.claude/**)',
    'Read(.sailing/**)'
];
async function fixPermissions(options) {
    const projectRoot = findProjectRoot();
    const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
    let settings = {
        includeCoAuthoredBy: false,
        permissions: { allow: [] }
    };
    if (fs.existsSync(settingsPath)) {
        try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        catch { }
    }
    if (!settings.permissions)
        settings.permissions = { allow: [] };
    if (!Array.isArray(settings.permissions.allow))
        settings.permissions.allow = [];
    const existing = settings.permissions.allow;
    let added = 0;
    for (const perm of BASE_PERMISSIONS) {
        if (!existing.includes(perm)) {
            if (!options.dryRun) {
                existing.push(perm);
            }
            added++;
        }
    }
    if (!options.dryRun && added > 0) {
        const dir = path.dirname(settingsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    }
    return { added, path: settingsPath };
}
