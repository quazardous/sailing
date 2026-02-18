import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

// Import panel components for global registration
import WelcomePanel from './panels/WelcomePanel.vue';
import PrdOverviewPanel from './panels/PrdOverviewPanel.vue';
import DetailPanel from './panels/DetailPanel.vue';
import StatsPanel from './panels/StatsPanel.vue';
import MetaPanel from './panels/MetaPanel.vue';
import GanttPanel from './panels/GanttPanel.vue';
import DagPanel from './panels/DagPanel.vue';
import AgentDetailPanel from './panels/AgentDetailPanel.vue';
import LogsPanel from './panels/LogsPanel.vue';
import ManagePanel from './panels/ManagePanel.vue';
import SettingsPanel from './panels/SettingsPanel.vue';

// Import Dockview styles
import 'dockview-core/dist/styles/dockview.css';

// Import app styles
import './styles/main.scss';

const app = createApp(App);
const pinia = createPinia();

// Register panel components globally for dockview-vue
// These are used in the main area (Dockview)
app.component('welcome', WelcomePanel);
app.component('prd-overview', PrdOverviewPanel);
app.component('detail', DetailPanel);
app.component('stats', StatsPanel);
app.component('meta', MetaPanel);
app.component('gantt', GanttPanel);
app.component('dag', DagPanel);
app.component('agent-detail', AgentDetailPanel);
app.component('logs', LogsPanel);
app.component('manage', ManagePanel);
app.component('settings-panel', SettingsPanel);

app.use(pinia);
app.mount('#app');
