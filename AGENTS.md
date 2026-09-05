# AGENTS.md - Universal AI Agent Instructions

## Operating Environment
- Platform: Node.js 18+ / TypeScript 5.7+
- Shell: PowerShell / Bash cross-compatible
- Project: `learn-docker`

## Agent Protocols
1. **Zero Assumption of Host Docker Daemon**: Do not write tests or build scripts that mandate a running Docker engine daemon on the host. Always use the built-in pure TypeScript simulators (`src/engine/`).
2. **Quality & Verification**: Never consider a task done without running tests (`npm test`) and verifying clean build outputs (`npm run build`).
3. **Enterprise Standards**: Maintain complete documentation, rich ASCII/Mermaid diagrams, and high pedagogical value.
