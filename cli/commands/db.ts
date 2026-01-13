/**
 * Database management commands for rudder CLI
 * CRUD operations on JSON collections (agents.json, runs.json)
 */
import fs from 'fs';
import path from 'path';
import { jsonOut } from '../lib/core.js';
import {
  getAgentsDb, getRunsDb, getAgent, getAllAgents, deleteAgent, clearAllAgents,
  upsertAgent, getRunsForTask, migrateFromStateJson
} from '../lib/db.js';
import { resolvePlaceholders } from '../lib/paths.js';
import { addDynamicHelp } from '../lib/help.js';
import { AgentInfo } from '../lib/types/agent.js';

/**
 * Register database commands
 */
export function registerDbCommands(program) {
  const db = program.command('db')
    .description('Database management (NeDB JSON files)');

  addDynamicHelp(db, { entityType: 'db' });

  // db:status - show database info
  db.command('status')
    .description('Show database status and collection counts')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const agents = await getAllAgents();
      const agentsDb = getAgentsDb();
      const runsDb = getRunsDb();
      const runs = await runsDb.find({});

      const statusCounts = {};
      agents.forEach(a => {
        statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
      });

      if (options.json) {
        jsonOut({
          agents: agents.length,
          runs: runs.length,
          byStatus: statusCounts
        });
      } else {
        console.log('Database: jsondb (plain JSON files)\n');
        console.log(`Agents: ${agents.length}`);
        Object.entries(statusCounts).forEach(([status, count]) => {
          console.log(`  ${status}: ${count}`);
        });
        console.log(`\nRuns: ${runs.length}`);
      }
    });

  // db:agents - list agents
  db.command('agents')
    .alias('list')
    .description('List all agents')
    .option('--status <status>', 'Filter by status')
    .action(async (options: { status?: string; json?: boolean }) => {
      const agents = await getAllAgents({ status: options.status });

      if (options.json) {
        jsonOut(agents);
      } else {
        if (agents.length === 0) {
          console.log('No agents');
          return;
        }
        console.log('Agents:\n');
        agents.forEach(a => {
          const dirty = a.dirtyWorktree ? ' [dirty]' : '';
          console.log(`  ${a.taskId}: ${a.status}${dirty}`);
        });
      }
    });

  // db:agent - show single agent
  db.command('agent <task-id>')
    .description('Show agent details')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: { json?: boolean }) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const agent = await getAgent(taskId);

      if (!agent) {
        console.error(`Agent not found: ${taskId}`);
        process.exit(1);
      }

      if (options.json) {
        jsonOut(agent);
      } else {
        console.log(`Agent: ${agent.taskId}\n`);
        console.log(`Status: ${agent.status}`);
        if (agent.pid) console.log(`PID: ${agent.pid}`);
        if (agent.spawnedAt) console.log(`Spawned: ${agent.spawnedAt}`);
        if (agent.endedAt) console.log(`Ended: ${agent.endedAt}`);
        if (agent.exitCode !== undefined) console.log(`Exit code: ${agent.exitCode}`);
        if (agent.worktree) {
          console.log(`\nWorktree:`);
          console.log(`  Path: ${agent.worktree.path}`);
          console.log(`  Branch: ${agent.worktree.branch}`);
        }
        if (agent.dirtyWorktree) {
          console.log(`\nDirty: ${agent.uncommittedFiles} uncommitted files`);
        }
        if (agent.logFile) console.log(`\nLog: ${agent.logFile}`);
      }
    });

  // db:delete - delete agent entry
  db.command('delete <task-id>')
    .description('Delete agent entry')
    .action(async (taskId: string) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const agent = await getAgent(taskId);
      if (!agent) {
        console.error(`Agent not found: ${taskId}`);
        process.exit(1);
      }

      await deleteAgent(taskId);
      console.log(`Deleted: ${taskId}`);
    });

  // db:clear - clear all agents
  db.command('clear')
    .description('Clear all agents')
    .option('--confirm', 'Confirm deletion')
    .action(async (options: { confirm?: boolean }) => {
      if (!options.confirm) {
        console.error('Use --confirm to clear all agents');
        process.exit(1);
      }

      const count = await clearAllAgents();
      console.log(`Cleared ${count} agent(s)`);
    });

  // db:runs - show runs for a task
  db.command('runs <task-id>')
    .description('Show run history for a task')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: { json?: boolean }) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const runs = await getRunsForTask(taskId);

      if (options.json) {
        jsonOut(runs);
      } else {
        if (runs.length === 0) {
          console.log(`No runs for ${taskId}`);
          return;
        }
        console.log(`Runs for ${taskId}:\n`);
        runs.forEach((r) => {
          const status = r.exitCode === 0 ? '✓' : r.exitCode === undefined ? '…' : '✗';
          console.log(`  ${status} Run ${r._id}: ${r.startedAt}`);
          if (r.endedAt) console.log(`    Ended: ${r.endedAt}, exit: ${r.exitCode}`);
        });
      }
    });

  // db:migrate - migrate from haven's state.json
  db.command('migrate')
    .description('Migrate agents from haven state.json to jsondb')
    .option('--dry-run', 'Show what would be migrated')
    .action(async (options: { dryRun?: boolean }) => {
      // Read from haven's state.json (not project's)
      const havenPath = resolvePlaceholders('${haven}');
      const stateFile = path.join(havenPath, 'state.json');

      if (!fs.existsSync(stateFile)) {
        console.log('No haven state.json found');
        return;
      }

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      if (!state.agents || Object.keys(state.agents).length === 0) {
        console.log('No agents in state.json to migrate');
        return;
      }

      const stateAgents: Record<string, AgentInfo> = state.agents;
      const count = Object.keys(stateAgents).length;

      if (options.dryRun) {
        console.log(`Would migrate ${count} agent(s) from ${stateFile}:`);
        Object.entries(stateAgents).forEach(([taskId, data]) => {
          console.log(`  ${taskId}: ${data.status}`);
        });
        return;
      }

      const migrated = await migrateFromStateJson(state.agents);
      console.log(`Migrated ${migrated} agent(s) to jsondb`);

      // Remove agents from state.json (keep counters)
      delete state.agents;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
      console.log('Removed agents from state.json');
    });

  // db:compact - compact database files
  db.command('compact')
    .description('Compact database files (remove deleted entries)')
    .action(async () => {
      const agentsDb = getAgentsDb();
      const runsDb = getRunsDb();

      await agentsDb.compactDatafile();
      await runsDb.compactDatafile();

      console.log('Compacted: agents.json, runs.json');
    });
}
