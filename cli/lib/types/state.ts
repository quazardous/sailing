import { AgentRecord } from './agent.js';

export interface State {
  counters: {
    prd: number;
    epic: number;
    task: number;
    story: number;
    [key: string]: number; // Allow extensibility for new counters
  };
  /** @deprecated Agents are now stored in db/agents.json, not state.json */
  agents?: Record<string, AgentRecord>;
  // Add other state properties as needed
  [key: string]: unknown; // Allow loose typing for now until fully migrated
}
