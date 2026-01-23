/**
 * Agent check command: diagnose MCP connectivity
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findProjectRoot, resolvePlaceholders, ensureDir, getAgentsDir } from '../../managers/core-manager.js';
import { withModifies } from '../../lib/help.js';

interface McpConfigOptions {
  outputPath: string;
  projectRoot: string;
  externalPort?: number;
  externalSocket?: string;
  taskId?: string;
}

export function registerCheckCommand(agent) {
  // agent:check - Diagnose MCP connectivity
  withModifies(agent.command('check'), ['task'])
    .description('Diagnose MCP server connectivity (spawn quick test agent)')
    .option('--timeout <seconds>', 'Test timeout (default: 30)', parseInt, 30)
    .option('--debug', 'Show debug info')
    .option('--skip-spawn', 'Only check MCP server, skip agent spawn test')
    .option('--json', 'JSON output')
    .action(async (options: {
      timeout: number;
      debug?: boolean;
      skipSpawn?: boolean;
      json?: boolean;
    }) => {
      const { checkMcpAgentServer } = await import('../../lib/srt.js');
      const havenDir = resolvePlaceholders('${haven}');
      const projectRoot = findProjectRoot();

      const result: any = {
        haven: havenDir,
        project: projectRoot,
        mcp: { running: false },
        socat_test: null,
        spawn_test: null,
        status: 'unknown'
      };

      const debug = (msg) => {
        if (options.debug && !options.json) console.log(`  [debug] ${msg}`);
      };

      // Step 1: Check MCP agent server process
      if (!options.json) console.log('Checking MCP agent server...');

      const mcpStatus: any = checkMcpAgentServer(havenDir);
      result.mcp = {
        running: mcpStatus.running,
        socket: mcpStatus.socket,
        pid: mcpStatus.pid
      };

      if (!mcpStatus.running) {
        result.status = 'mcp_not_running';
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.error('\n❌ MCP agent server not running\n');
          console.error('Fix: bin/rdrctl start');
        }
        process.exit(1);
      }

      if (!options.json) {
        console.log(`  ✓ MCP running (pid: ${mcpStatus.pid})`);
        if (mcpStatus.mode === 'port') {
          console.log(`  Port: ${mcpStatus.port}`);
        } else {
          console.log(`  Socket: ${mcpStatus.socket}`);
        }
        console.log(`  Mode: ${mcpStatus.mode}`);
      }

      // Step 2: Test connection directly (no sandbox)
      if (!options.json) console.log('\nTesting connection...');

      try {
        const testRequest = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }) + '\n';
        let connectResult;

        if (mcpStatus.mode === 'port') {
          debug(`Testing: echo | nc 127.0.0.1 ${mcpStatus.port}`);
          connectResult = execSync(
            `echo '${testRequest}' | timeout 5 nc 127.0.0.1 ${mcpStatus.port}`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          );
        } else {
          debug(`Testing: echo | socat - UNIX-CONNECT:${mcpStatus.socket}`);
          connectResult = execSync(
            `echo '${testRequest}' | timeout 5 socat - UNIX-CONNECT:${mcpStatus.socket}`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          );
        }

        result.connection_test = { success: true, response_length: connectResult.length };

        if (!options.json) {
          console.log(`  ✓ Server responds (${connectResult.length} chars)`);
        }
        debug(`Response: ${connectResult.slice(0, 100)}...`);
      } catch (err) {
        result.connection_test = { success: false, error: err.message };
        result.status = 'connection_failed';

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.error(`  ✗ Connection failed`);
          if (mcpStatus.mode === 'port') {
            console.error(`\n❌ Cannot connect to MCP port ${mcpStatus.port}\n`);
            console.error('Debug:');
            console.error(`  nc -zv 127.0.0.1 ${mcpStatus.port}`);
          } else {
            console.error(`\n❌ socat cannot connect to MCP socket\n`);
            console.error('Debug:');
            console.error(`  ls -la ${mcpStatus.socket}`);
            console.error(`  echo | socat - UNIX-CONNECT:${mcpStatus.socket}`);
          }
        }
        process.exit(1);
      }

      // Step 3: Test connection from inside sandbox (before full agent spawn)
      if (!options.json) console.log('\nTesting connection from sandbox...');

      const agentDir = path.join(getAgentsDir(), '_check');
      ensureDir(agentDir);

      const { generateSrtConfig, startSocatBridge } = await import('../../lib/srt.js');
      const isLinux = process.platform === 'linux';

      let bridgeSocket: string | null = null;
      let bridgeCleanup: (() => void) | null = null;
      let testSocket: string | null = mcpStatus.socket;

      if (mcpStatus.mode === 'port' && isLinux) {
        const bridgeSocketPath = path.join(agentDir, 'mcp-bridge-test.sock');
        debug(`Starting socat bridge: ${bridgeSocketPath} → TCP:127.0.0.1:${mcpStatus.port}`);
        try {
          const bridge = startSocatBridge({
            socketPath: bridgeSocketPath,
            targetPort: mcpStatus.port
          });
          bridgeSocket = bridge.socket;
          bridgeCleanup = bridge.cleanup;
          testSocket = bridgeSocket;
          if (!options.json) {
            console.log(`  ✓ Bridge started (pid: ${bridge.pid})`);
          }
        } catch (err) {
          if (!options.json) {
            console.error(`  ✗ Failed to start socat bridge: ${err.message}`);
          }
          fs.rmSync(agentDir, { recursive: true, force: true });
          result.status = 'bridge_failed';
          process.exit(1);
        }
      }

      const srtConfigForTest = generateSrtConfig({
        outputPath: path.join(agentDir, 'srt-settings-test.json'),
        additionalWritePaths: [agentDir],
        allowUnixSockets: testSocket ? [testSocket] : [],
        allowAllUnixSockets: isLinux,
        strictMode: true
      });

      debug(`SRT config for sandbox test: ${srtConfigForTest}`);
      debug(`SRT config content: ${fs.readFileSync(srtConfigForTest, 'utf8')}`);

      try {
        let sandboxTestCmd;
        if (mcpStatus.mode === 'port' && !isLinux) {
          sandboxTestCmd = `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | nc 127.0.0.1 ${mcpStatus.port}`;
        } else {
          sandboxTestCmd = `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | socat - UNIX-CONNECT:${testSocket}`;
        }

        debug(`Sandbox test command: srt --settings ${srtConfigForTest} sh -c "${sandboxTestCmd}"`);

        const sandboxTestResult = execSync(
          `timeout 10 srt --settings ${srtConfigForTest} sh -c "${sandboxTestCmd}"`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );

        result.sandbox_connection_test = { success: true, response_length: sandboxTestResult.length };

        if (!options.json) {
          const modeDesc = mcpStatus.mode === 'port' && isLinux ? 'via bridge' : mcpStatus.mode;
          console.log(`  ✓ Connection from sandbox OK (${sandboxTestResult.length} chars, ${modeDesc})`);
        }
        debug(`Sandbox test response: ${sandboxTestResult.slice(0, 100)}...`);
      } catch (err) {
        result.sandbox_connection_test = { success: false, error: err.message, stderr: err.stderr?.slice(0, 500) };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.error(`  ✗ Connection from sandbox failed`);
          if (options.debug) {
            console.error(`\nError: ${err.message}`);
            if (err.stderr) console.error(`Stderr: ${err.stderr.slice(0, 500)}`);
          }
          console.error(`\n❌ Cannot connect to MCP from inside sandbox\n`);
          console.error('Possible causes:');
          if (mcpStatus.mode === 'port' && isLinux) {
            console.error('  - Socat bridge not working');
            console.error('  - allowAllUnixSockets not enabled');
          } else if (mcpStatus.mode === 'port') {
            console.error('  - Network namespace isolation (--unshare-net) blocks localhost');
          } else {
            console.error('  - Unix socket blocked by seccomp (Linux)');
            console.error('  - Socket path not in allowUnixSockets (macOS)');
          }
        }

        if (bridgeCleanup) bridgeCleanup();
        fs.rmSync(agentDir, { recursive: true, force: true });
        result.status = 'sandbox_connection_failed';
        process.exit(1);
      }

      if (bridgeCleanup) bridgeCleanup();

      // Step 4: Skip spawn test if requested
      if (options.skipSpawn) {
        fs.rmSync(agentDir, { recursive: true, force: true });
        result.status = 'ok';
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('\n✅ MCP server OK (spawn test skipped)\n');
        }
        process.exit(0);
      }

      // Step 5: Spawn test agent
      if (!options.json) console.log('\nTesting full agent spawn...');

      const { generateAgentMcpConfig, spawnClaudeWithSrt } = await import('../../lib/srt.js');
      let spawnBridgeCleanup: (() => void) | null = null;
      let spawnSocket: string | null = mcpStatus.socket;

      if (mcpStatus.mode === 'port' && isLinux) {
        const bridgeSocketPath = path.join(agentDir, 'mcp-bridge-spawn.sock');
        debug(`Starting socat bridge for spawn: ${bridgeSocketPath} → TCP:127.0.0.1:${mcpStatus.port}`);
        const bridge = startSocatBridge({
          socketPath: bridgeSocketPath,
          targetPort: mcpStatus.port
        });
        spawnBridgeCleanup = bridge.cleanup;
        spawnSocket = bridge.socket;
        if (!options.json) {
          console.log(`  ✓ Bridge for spawn started (pid: ${bridge.pid})`);
        }
      }

      const mcpConfigOptions: McpConfigOptions = {
        outputPath: path.join(agentDir, 'mcp-config.json'),
        projectRoot
      };

      if (mcpStatus.mode === 'port' && !isLinux) {
        mcpConfigOptions.externalPort = mcpStatus.port;
      } else if (spawnSocket) {
        mcpConfigOptions.externalSocket = spawnSocket;
      }

      const mcpConfig = generateAgentMcpConfig(mcpConfigOptions);

      debug(`MCP config: ${mcpConfig.configPath}`);
      debug(`MCP config content: ${fs.readFileSync(mcpConfig.configPath, 'utf8')}`);

      const additionalPaths = [agentDir];
      if (spawnSocket) {
        additionalPaths.push(path.dirname(spawnSocket));
      }

      const srtConfig = generateSrtConfig({
        outputPath: path.join(agentDir, 'srt-settings.json'),
        additionalWritePaths: additionalPaths,
        allowUnixSockets: spawnSocket ? [spawnSocket] : [],
        allowAllUnixSockets: isLinux,
        strictMode: true
      });

      debug(`SRT config: ${srtConfig}`);
      debug(`SRT config content: ${fs.readFileSync(srtConfig, 'utf8')}`);

      const testPrompt = `You are a diagnostic agent testing environment and MCP connectivity.

## Step 1: Environment Check
Run these commands and report results:
1. \`pwd\` - should show project directory
2. \`ls -la\` - should list project files

## Step 2: MCP Check
Call the rudder MCP tool exactly like this:

Tool: mcp__rudder__cli
Arguments: { "command": "status" }

## Output
After both checks, output exactly one of:
- ENV_OK MCP_OK - if both pwd/ls work AND MCP tool succeeds
- ENV_OK MCP_FAIL - if pwd/ls work but MCP fails
- ENV_FAIL - if pwd/ls fail

Exit immediately after outputting the result.`;

      let testOutput = '';
      let testStderr = '';
      const testStart = Date.now();

      try {
        const child = spawnClaudeWithSrt({
          prompt: testPrompt,
          cwd: projectRoot,
          sandbox: true,
          srtConfigPath: srtConfig,
          riskyMode: true,
          mcpConfigPath: mcpConfig.configPath,
          timeout: options.timeout,
          onStdout: (data) => { testOutput += data.toString(); },
          onStderr: (data) => { testStderr += data.toString(); }
        });

        debug(`Spawned with PID: ${child.pid}`);

        await new Promise((resolve) => {
          child.process.on('exit', resolve);
        });

        const duration = Date.now() - testStart;
        const envOk = testOutput.includes('ENV_OK');
        const mcpOk = testOutput.includes('MCP_OK');
        const success = envOk && mcpOk;

        result.spawn_test = {
          success,
          env_ok: envOk,
          mcp_ok: mcpOk,
          duration_ms: duration,
          output_preview: testOutput.slice(0, 300)
        };

        if (!envOk) {
          result.status = 'env_failed';
        } else if (!mcpOk) {
          result.status = 'mcp_call_failed';
        } else {
          result.status = 'ok';
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (success) {
          console.log(`  ✓ Environment OK (pwd, ls work)`);
          console.log(`  ✓ MCP connection works (${duration}ms)`);
          console.log('\n✅ All checks passed\n');
        } else {
          if (!envOk) {
            console.error(`  ✗ Environment check failed`);
          } else {
            console.log(`  ✓ Environment OK`);
          }
          if (!mcpOk) {
            console.error(`  ✗ MCP call failed (${duration}ms)`);
          }
          if (options.debug) {
            console.error(`\nRaw output (${testOutput.length} chars):\n${testOutput}`);
            if (testStderr) {
              console.error(`\nStderr:\n${testStderr}`);
            }
          } else {
            console.error(`\nOutput: ${testOutput.slice(0, 300)}`);
          }
          if (!envOk) {
            console.error('\n❌ Environment issue from sandbox\n');
            console.error('Possible causes:');
            console.error('  - CWD not accessible');
            console.error('  - Sandbox blocking file reads');
          } else {
            console.error('\n❌ MCP connectivity issue from sandbox\n');
            console.error('Possible causes:');
            console.error('  - nc/socat not in sandbox PATH');
            console.error('  - Port not accessible from sandbox (check allowedDomains includes 127.0.0.1)');
            console.error('  - Claude MCP initialization failed');
          }
        }

        if (spawnBridgeCleanup) spawnBridgeCleanup();
        fs.rmSync(agentDir, { recursive: true, force: true });

        process.exit(success ? 0 : 1);

      } catch (err) {
        result.spawn_test = { success: false, error: err.message };
        result.status = 'spawn_failed';

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.error(`  ✗ Spawn failed: ${err.message}`);
          console.error('\n❌ Cannot spawn test agent\n');
        }

        if (spawnBridgeCleanup) spawnBridgeCleanup();
        fs.rmSync(agentDir, { recursive: true, force: true });
        process.exit(1);
      }
    });
}
