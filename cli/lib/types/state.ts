import { AgentInfo } from './agent.js';

export interface State {
  counters: {
    prd: number;
    epic: number;
    task: number;
    story: number;
    [key: string]: number; // Allow extensibility for new counters
  };
  agents?: Record<string, AgentInfo>;
  // Add other state properties as needed
  [key: string]: any; // Allow loose typing for now until fully migrated
}
