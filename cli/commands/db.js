/**
 * Database management commands for rudder CLI
 * CRUD operations on sailing.db tables
 */
import { jsonOut } from '../lib/core.js';
import {
  getDb, getAgent, getAllAgents, deleteAgent, clearAllAgents,
  upsertAgent, getRunsForTask, migrateFromStateJson
} from '../lib/db.js';
import { loadState, saveState } from '../lib/state.js';
import { addDynamicHelp } from '../lib/help.js';

/**
 * Register database commands
 */
export function registerDbCommands(program) {
  const db = program.command('db')
    .description('Database management (sailing.db)');

  addDynamicHelp(db, { entityType: 'db' });

  // db:status - show database info
  db.command('status')
    .description('Show database status and table counts')
    .option('--json', 'JSON output')
    .action((options) => {
      const database = getDb();

      const agentCount = database.prepare('SELECT COUNT(*) as count FROM agents').get().count;
      const runCount = database.prepare('SELECT COUNT(*) as count FROM runs').get().count;

      const statusCounts = database.prepare(`
        SELECT status, COUNT(*) as count FROM agents GROUP BY status
      `).all();

      if (options.json) {
        jsonOut({ agents: agentCount, runs: runCount, byStatus: statusCounts });
      } else {
        console.log('Database: sailing.db\n');
        console.log(`Agents: ${agentCount}`);
        statusCounts.forEach(s => console.log(`  ${s.status}: ${s.count}`));
        console.log(`\nRuns: ${runCount}`);
      }
    });

  // db:agents - list agents
  db.command('agents')
    .alias('list')
    .description('List all agents')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'JSON output')
    .action((options) => {
      const agents = getAllAgents({ status: options.status });

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
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const agent = getAgent(taskId);

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
        if (agent.exitCode !== null) console.log(`Exit code: ${agent.exitCode}`);
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
    .action((taskId) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const agent = getAgent(taskId);
      if (!agent) {
        console.error(`Agent not found: ${taskId}`);
        process.exit(1);
      }

      deleteAgent(taskId);
      console.log(`Deleted: ${taskId}`);
    });

  // db:clear - clear all agents
  db.command('clear')
    .description('Clear all agents')
    .option('--confirm', 'Confirm deletion')
    .action((options) => {
      if (!options.confirm) {
        console.error('Use --confirm to clear all agents');
        process.exit(1);
      }

      const count = clearAllAgents();
      console.log(`Cleared ${count} agent(s)`);
    });

  // db:runs - show runs for a task
  db.command('runs <task-id>')
    .description('Show run history for a task')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const runs = getRunsForTask(taskId);

      if (options.json) {
        jsonOut(runs);
      } else {
        if (runs.length === 0) {
          console.log(`No runs for ${taskId}`);
          return;
        }
        console.log(`Runs for ${taskId}:\n`);
        runs.forEach((r, i) => {
          const status = r.exit_code === 0 ? '✓' : r.exit_code === null ? '…' : '✗';
          console.log(`  ${status} Run #${r.id}: ${r.started_at}`);
          if (r.ended_at) console.log(`    Ended: ${r.ended_at}, exit: ${r.exit_code}`);
        });
      }
    });

  // db:migrate - migrate from state.json
  db.command('migrate')
    .description('Migrate agents from state.json to sailing.db')
    .option('--dry-run', 'Show what would be migrated')
    .action((options) => {
      const state = loadState();

      if (!state.agents || Object.keys(state.agents).length === 0) {
        console.log('No agents in state.json to migrate');
        return;
      }

      const count = Object.keys(state.agents).length;

      if (options.dryRun) {
        console.log(`Would migrate ${count} agent(s):`);
        Object.entries(state.agents).forEach(([taskId, data]) => {
          console.log(`  ${taskId}: ${data.status}`);
        });
        return;
      }

      const migrated = migrateFromStateJson(state.agents);
      console.log(`Migrated ${migrated} agent(s) to sailing.db`);

      // Remove agents from state.json (keep counters)
      delete state.agents;
      saveState(state);
      console.log('Removed agents from state.json');
    });

  // db:sql - run raw SQL query
  db.command('sql <query>')
    .description('Run raw SQL query (read-only)')
    .option('--write', 'Allow write operations')
    .option('--json', 'JSON output')
    .action((query, options) => {
      const database = getDb();

      // Safety check for writes
      const isWrite = /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)/i.test(query);
      if (isWrite && !options.write) {
        console.error('Write operations require --write flag');
        process.exit(1);
      }

      try {
        if (isWrite) {
          const result = database.prepare(query).run();
          if (options.json) {
            jsonOut(result);
          } else {
            console.log(`Changes: ${result.changes}`);
          }
        } else {
          const rows = database.prepare(query).all();
          if (options.json) {
            jsonOut(rows);
          } else {
            if (rows.length === 0) {
              console.log('No results');
            } else {
              console.table(rows);
            }
          }
        }
      } catch (err) {
        console.error(`SQL error: ${err.message}`);
        process.exit(1);
      }
    });
}
