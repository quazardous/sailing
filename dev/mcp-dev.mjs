#!/usr/bin/env node
/**
 * MCP Dev Server — stdio tools for lint/build workflow.
 * Eliminates bash pipe friction during refactoring sessions.
 */
import { execSync } from 'child_process';
import { createInterface } from 'readline';

const PROJECT_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function run(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// -- Tool implementations --

function tscCheck() {
  const { ok, out } = run('npx tsc --noEmit');
  if (ok) return { success: true, errors: 0, output: 'Clean' };
  const lines = out.trim().split('\n').filter(l => l.includes('error TS'));
  return { success: false, errors: lines.length, output: lines.join('\n') };
}

function lintCount(file) {
  const target = file || 'cli/';
  const { out } = run(`npx eslint ${target}`);
  const errors = (out.match(/ error /g) || []).length;
  const warnings = (out.match(/ warning /g) || []).length;
  return { errors, warnings, total: errors + warnings };
}

function lintFile(file, rule) {
  if (!file) return { error: 'file parameter required' };
  const { out } = run(`npx eslint ${file}`);
  let lines = out.split('\n').filter(l => /^\s+\d/.test(l));
  if (rule) lines = lines.filter(l => l.includes(rule));
  return {
    file,
    rule: rule || 'all',
    count: lines.length,
    errors: lines.join('\n')
  };
}

function lintReport(top) {
  const n = top || 15;
  const { out } = run(`npx eslint cli/`);
  const lines = out.split('\n');

  // By rule
  const ruleCounts = {};
  for (const l of lines) {
    const m = l.match(/(@typescript-eslint\/\S+|sonarjs\/\S+)/);
    if (m) ruleCounts[m[1]] = (ruleCounts[m[1]] || 0) + 1;
  }
  const byRule = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]).slice(0, n);

  // By file
  const fileCounts = {};
  let currentFile = '';
  for (const l of lines) {
    if (l.startsWith('/')) currentFile = l.trim();
    else if (l.includes(' error ')) fileCounts[currentFile] = (fileCounts[currentFile] || 0) + 1;
  }
  const byFile = Object.entries(fileCounts).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([f, c]) => [c, f.replace(PROJECT_ROOT + '/', '')]);

  // Any sources
  const anyCounts = {};
  currentFile = '';
  for (const l of lines) {
    if (l.startsWith('/')) currentFile = l.trim();
    else if (l.includes('no-explicit-any')) anyCounts[currentFile] = (anyCounts[currentFile] || 0) + 1;
  }
  const anySources = Object.entries(anyCounts).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([f, c]) => [c, f.replace(PROJECT_ROOT + '/', '')]);

  const totalErrors = (out.match(/ error /g) || []).length;
  const totalWarnings = (out.match(/ warning /g) || []).length;

  return { totalErrors, totalWarnings, byRule, byFile, anySources };
}

function lintRuleBreakdown(file) {
  if (!file) return { error: 'file parameter required' };
  const { out } = run(`npx eslint ${file}`);
  const ruleCounts = {};
  for (const l of out.split('\n')) {
    const m = l.match(/(@typescript-eslint\/\S+|sonarjs\/\S+)/);
    if (m) ruleCounts[m[1]] = (ruleCounts[m[1]] || 0) + 1;
  }
  return {
    file,
    rules: Object.entries(ruleCounts).sort((a, b) => b[1] - a[1])
  };
}

function depsReport(top) {
  const n = top || 20;
  const { ok, out } = run('npx madge --extensions ts cli/ --json');
  if (!ok) return { error: 'madge failed', output: out.slice(0, 500) };

  const deps = JSON.parse(out);

  // Count how many files import each file (reverse deps)
  const importedBy = {};
  for (const [file, imports] of Object.entries(deps)) {
    for (const imp of imports) {
      importedBy[imp] = (importedBy[imp] || 0) + 1;
    }
  }
  const mostImported = Object.entries(importedBy).sort((a, b) => b[1] - a[1]).slice(0, n);

  // Cross with lint errors
  const { out: lintOut } = run('npx eslint cli/');
  const fileCounts = {};
  let currentFile = '';
  for (const l of lintOut.split('\n')) {
    if (l.startsWith('/')) currentFile = l.trim();
    else if (l.includes(' error ')) fileCounts[currentFile] = (fileCounts[currentFile] || 0) + 1;
  }

  // Build combined report: deps × lint score
  const combined = mostImported.map(([file, depCount]) => {
    const fullPath = Object.keys(fileCounts).find(f => f.endsWith('/' + file));
    const lintErrors = fullPath ? fileCounts[fullPath] : 0;
    return { file, importedBy: depCount, lintErrors, impact: depCount * (lintErrors + 1) };
  }).sort((a, b) => b.impact - a.impact);

  return {
    totalFiles: Object.keys(deps).length,
    mostImported: mostImported.map(([f, c]) => [c, f]),
    prioritized: combined.filter(c => c.lintErrors > 0).slice(0, n)
  };
}

function lintErrors(exclude, include) {
  let raw;
  try {
    raw = execSync('npx eslint cli/ -f json', { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    raw = e.stdout || '';
  }
  let data;
  try { data = JSON.parse(raw); } catch { return { error: 'eslint json parse failed', raw: raw.slice(0, 200) }; }
  const excludeRules = exclude ? exclude.split(',').map(s => s.trim()) : [];
  const includeRules = include ? include.split(',').map(s => s.trim()) : [];
  const results = [];
  for (const f of data) {
    for (const m of f.messages) {
      if (!m.ruleId) continue;
      if (excludeRules.length && excludeRules.some(r => m.ruleId.includes(r))) continue;
      if (includeRules.length && !includeRules.some(r => m.ruleId.includes(r))) continue;
      results.push({
        file: f.filePath.replace(PROJECT_ROOT + '/', ''),
        line: m.line,
        rule: m.ruleId,
        severity: m.severity === 2 ? 'error' : 'warn',
        message: m.message
      });
    }
  }
  // Summary by rule
  const byRule = {};
  for (const r of results) byRule[r.rule] = (byRule[r.rule] || 0) + 1;
  const summary = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
  return { total: results.length, summary, errors: results };
}

// -- MCP stdio protocol --

const TOOLS = {
  tsc_check: {
    description: 'Run TypeScript compiler check (tsc --noEmit)',
    inputSchema: { type: 'object', properties: {} }
  },
  lint_count: {
    description: 'Count lint errors/warnings. Optional file param (default: cli/)',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'File or dir to lint (default: cli/)' } } }
  },
  lint_file: {
    description: 'Lint a specific file, optionally filter by rule name',
    inputSchema: { type: 'object', properties: {
      file: { type: 'string', description: 'File to lint' },
      rule: { type: 'string', description: 'Filter by rule (e.g. no-explicit-any)' }
    }, required: ['file'] }
  },
  lint_report: {
    description: 'Full lint report: errors by rule, by file, and explicit-any sources',
    inputSchema: { type: 'object', properties: { top: { type: 'number', description: 'Limit results (default: 15)' } } }
  },
  lint_rule_breakdown: {
    description: 'Show error count per rule for a specific file',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'File to analyze' } }, required: ['file'] }
  },
  lint_errors: {
    description: 'List all lint errors with file:line, rule, message. Filter by include/exclude rule patterns.',
    inputSchema: { type: 'object', properties: {
      exclude: { type: 'string', description: 'Comma-separated rules to exclude (e.g. "cognitive-complexity,slow-regex")' },
      include: { type: 'string', description: 'Comma-separated rules to include (e.g. "no-alphabetical-sort,deprecation")' }
    } }
  },
  deps_report: {
    description: 'Dependency analysis: most imported files, cross-referenced with lint errors. Prioritizes high-impact refactor targets.',
    inputSchema: { type: 'object', properties: { top: { type: 'number', description: 'Limit results (default: 20)' } } }
  }
};

function handleRequest(req) {
  const { method, params, id } = req;

  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'sailing-dev', version: '1.0.0' }
    }};
  }

  if (method === 'notifications/initialized') return null;

  if (method === 'tools/list') {
    const tools = Object.entries(TOOLS).map(([name, def]) => ({ name, ...def }));
    return { jsonrpc: '2.0', id, result: { tools } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    let result;
    switch (name) {
      case 'tsc_check': result = tscCheck(); break;
      case 'lint_count': result = lintCount(args?.file); break;
      case 'lint_file': result = lintFile(args?.file, args?.rule); break;
      case 'lint_report': result = lintReport(args?.top); break;
      case 'lint_rule_breakdown': result = lintRuleBreakdown(args?.file); break;
      case 'lint_errors': result = lintErrors(args?.exclude, args?.include); break;
      case 'deps_report': result = depsReport(args?.top); break;
      default: return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true } };
    }
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

// stdio transport
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  try {
    const req = JSON.parse(line);
    const res = handleRequest(req);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  } catch (e) {
    process.stderr.write(`Parse error: ${e.message}\n`);
  }
});
