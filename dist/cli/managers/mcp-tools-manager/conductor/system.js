/**
 * MCP Conductor Tools - System and context operations
 */
import { getConductorManager } from '../../conductor-manager.js';
import { getAllPrds, getAllTasks } from '../../artefacts-manager.js';
import { getAllVersions } from '../../version-manager.js';
import { ok } from '../types.js';
// Import CONDUCTOR_TOOLS reference for help - will be set by index.ts
let conductorToolsRef = [];
export function setConductorToolsRef(tools) {
    conductorToolsRef = tools;
}
export const SYSTEM_TOOLS = [
    // ========== SYSTEM ==========
    {
        tool: {
            name: 'system_status',
            description: 'Get project status overview',
            inputSchema: { type: 'object', properties: {} }
        },
        handler: () => {
            const prds = getAllPrds();
            const tasks = getAllTasks();
            const conductor = getConductorManager();
            const agentsRecord = conductor.getAllAgents();
            const agentsList = Object.values(agentsRecord);
            const byStatus = {};
            tasks.forEach(t => {
                const status = t.data?.status || 'Unknown';
                byStatus[status] = (byStatus[status] || 0) + 1;
            });
            const nextActions = [];
            if (byStatus['In Progress'] > 0) {
                nextActions.push({
                    tool: 'agent_list',
                    args: { status: 'running' },
                    reason: 'Check running agents',
                    priority: 'normal'
                });
            }
            nextActions.push({
                tool: 'workflow_ready',
                args: {},
                reason: 'Find tasks ready to start',
                priority: 'normal'
            });
            return ok({
                success: true,
                data: {
                    prds: prds.length,
                    tasks: { total: tasks.length, byStatus },
                    agents: {
                        total: agentsList.length,
                        running: agentsList.filter(a => a.status === 'running' || a.status === 'spawned').length
                    }
                },
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'system_versions',
            description: 'Get component versions',
            inputSchema: { type: 'object', properties: {} }
        },
        handler: () => {
            const versions = getAllVersions();
            return ok({ success: true, data: versions });
        }
    },
    {
        tool: {
            name: 'system_help',
            description: 'List all available tools by category',
            inputSchema: { type: 'object', properties: {} }
        },
        handler: () => {
            const toolsByCategory = {};
            conductorToolsRef.forEach(t => {
                const [cat] = t.tool.name.split('_');
                if (!toolsByCategory[cat])
                    toolsByCategory[cat] = [];
                toolsByCategory[cat].push({
                    name: t.tool.name,
                    description: t.tool.description || ''
                });
            });
            return ok({
                success: true,
                data: {
                    categories: Object.keys(toolsByCategory),
                    tools: toolsByCategory,
                    total: conductorToolsRef.length
                }
            });
        }
    }
];
