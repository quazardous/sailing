# Sandbox Runtime (srt) Setup Guide

Sailing supports running agents in a sandboxed environment using [Anthropic's sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime). This provides OS-level isolation for filesystem and network access.

## Why Sandbox?

When agents run autonomously, they have access to your filesystem and network. Sandbox mode:

- **Restricts filesystem access**: Agents can only write to allowed directories
- **Filters network requests**: Only whitelisted domains are accessible
- **Protects sensitive files**: Blocks access to `.ssh`, `.gnupg`, `.aws`, etc.

## Prerequisites

### Linux (Fedora/RHEL)

```bash
sudo dnf install ripgrep bubblewrap socat
```

### Linux (Debian/Ubuntu)

```bash
sudo apt install ripgrep bubblewrap socat
```

### macOS

```bash
brew install ripgrep
```

> Note: macOS uses native `sandbox-exec` instead of bubblewrap.

## Installation

### 1. Install sandbox-runtime

```bash
npm install -g @anthropic-ai/sandbox-runtime
```

Verify installation:

```bash
srt --version
```

### 2. Check with Rudder

```bash
rudder sandbox:check
```

Expected output when ready:

```
Sandbox Runtime Status
==================================================

srt installed:    ✓ Yes
srt version:      0.0.23

Platform:         linux

Dependencies:
  ✓ ripgrep (rg)
  ✓ bubblewrap (bwrap)
  ✓ socat (socat)

Config path:      ~/.sailing/havens/<hash>/srt-settings.json
Config exists:    ✓ Yes

✓ Sandbox ready
```

## Configuration

### 1. Initialize default config

```bash
rudder sandbox:init
```

This creates `~/.sailing/havens/<project-hash>/srt-settings.json` with sensible defaults.

### 2. View current config

```bash
rudder sandbox:show
```

### 3. Config structure

```json
{
  "network": {
    "allowedDomains": [
      "api.anthropic.com",
      "*.anthropic.com",
      "sentry.io",
      "statsig.anthropic.com",
      "github.com",
      "*.github.com",
      "registry.npmjs.org"
    ],
    "deniedDomains": []
  },
  "filesystem": {
    "allowWrite": [
      "~/.claude",
      "~/.claude.json",
      "~/.npm/_logs",
      "/tmp"
    ],
    "denyWrite": [],
    "denyRead": [
      "~/.ssh",
      "~/.gnupg",
      "~/.aws"
    ]
  }
}
```

### 4. Custom config location

Override in `.sailing/paths.yaml`:

```yaml
paths:
  # Global config (shared across projects)
  srtConfig: ~/.srt-settings.json

  # Or per-project (in repo)
  srtConfig: .sailing/srt-settings.json
```

## Network Configuration

### Allowed Domains

Add domains your project needs:

```json
{
  "network": {
    "allowedDomains": [
      "api.anthropic.com",
      "*.anthropic.com",
      "your-api.example.com",
      "*.your-cdn.com"
    ]
  }
}
```

### How it works

1. srt starts internal HTTP/HTTPS and SOCKS5 proxies
2. Sets `HTTP_PROXY`/`HTTPS_PROXY` environment variables
3. All network traffic routes through these proxies
4. Requests to non-allowed domains are blocked

### Testing network rules

```bash
# Should work (allowed domain)
rudder sandbox:run --debug "fetch https://api.anthropic.com"

# Should fail (blocked domain)
rudder sandbox:run --debug "fetch https://evil.com"
```

## Filesystem Configuration

### Allow Write

Directories where agents can write:

```json
{
  "filesystem": {
    "allowWrite": [
      ".",                    // Current project
      "~/.claude",            // Claude config
      "/tmp"                  // Temp files
    ]
  }
}
```

### Deny Read

Sensitive files to block completely:

```json
{
  "filesystem": {
    "denyRead": [
      "~/.ssh",
      "~/.gnupg",
      "~/.aws",
      "~/.config/gcloud"
    ]
  }
}
```

## Using with Rudder

### Enable sandbox mode

```bash
rudder config set agent.sandbox true
```

### Agent spawn with sandbox

When `agent.sandbox: true`, `rudder agent:spawn` will:

1. Generate agent-specific `srt-settings.json` in agent directory
2. Add worktree path to `allowWrite`
3. Wrap Claude with `srt --settings <path> claude ...`

### Manual testing

```bash
# Test with sandbox
rudder sandbox:run "hello world"

# Test with debug output
rudder sandbox:run --debug "hello"

# Test without sandbox (bypass)
rudder sandbox:run --no-sandbox "hello"

# Specify working directory
rudder sandbox:run --workdir /path/to/project "hello"

# Pipe prompt
echo "explain this code" | rudder sandbox:run
```

## Troubleshooting

### "Sandbox dependencies not available"

Install missing dependencies:

```bash
# Linux
sudo dnf install ripgrep bubblewrap socat

# macOS
brew install ripgrep
```

### "EROFS: read-only file system"

Claude needs write access to certain paths. Add to `allowWrite`:

```json
{
  "filesystem": {
    "allowWrite": [
      "~/.claude",
      "~/.claude.json",
      "/tmp"
    ]
  }
}
```

### "Connection blocked to domain.com"

Add the domain to `allowedDomains`:

```json
{
  "network": {
    "allowedDomains": [
      "domain.com",
      "*.domain.com"
    ]
  }
}
```

### Debug mode

Enable verbose logging:

```bash
# Via rudder
rudder sandbox:run --debug "test"

# Direct srt
SRT_DEBUG=1 srt --settings ~/.sailing/havens/.../srt-settings.json claude -p "test"
```

### Check agent logs

```bash
cat ~/.sailing/havens/<hash>/agents/<task-id>/run.log
```

The log shows:
- Command executed
- Sandbox status
- SRT config path used

## Security Notes

1. **srt is experimental**: Review the [sandbox-runtime repo](https://github.com/anthropic-experimental/sandbox-runtime) for limitations
2. **Environment variables**: Some tools ignore `HTTP_PROXY` - srt may not catch all traffic
3. **Local processes**: srt doesn't sandbox child processes spawned by Claude
4. **Always review**: Sandbox is defense-in-depth, not a replacement for code review

## External MCP Architecture

When sandbox is enabled for agents, the MCP server runs **outside** the sandbox to provide haven write access. The agent connects via a socat TCP bridge:

```
Agent (sandboxed) → socat → TCP:127.0.0.1:PORT → MCP Server (unsandboxed) → rudder
```

This allows strict sandbox restrictions (worktree-only writes) while still enabling rudder operations.

See [MCP Server Documentation](mcp.md) for details.

## References

- [sandbox-runtime GitHub](https://github.com/anthropic-experimental/sandbox-runtime)
- [Claude Code Sandboxing Docs](https://docs.anthropic.com/en/docs/claude-code/sandboxing)
- [Rudder MCP Server](mcp.md)
