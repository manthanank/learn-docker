# CLAUDE.md - Guidelines for learn-docker

## Project Overview
`learn-docker` is an enterprise-grade architectural curriculum, container internals simulator, Dockerfile AST parser & linter, OverlayFS & Linux isolation lab, and interactive web dashboard.

## Core Commands
- `npm test`: Run complete Vitest test suite.
- `npm run dev`: Start Express API server & dashboard in hot-reload mode via `tsx`.
- `npm run build`: Compile TypeScript codebase into `dist/`.
- `npm run lint`: Run Dockerfile linter on repository root Dockerfile.
- `node dist/cli.js --help`: Run CLI tool.

## Architectural Guidelines
1. **Zero External Daemon Dependency for Testing**: The simulation engines (`dockerfile-parser`, `dockerfile-linter`, `overlayfs-simulator`, `isolation-simulator`, `compose-resolver`) must operate completely offline with mock/pure TypeScript abstractions.
2. **Type Safety**: Strictly typed TypeScript with zero `any` usage. All external inputs (e.g. YAML, Dockerfile strings) must be validated with Zod schemas or typed AST nodes.
3. **Security Standards**: Linter rules must adhere to CIS Docker Benchmarks (non-root users, unpinned base images, healthcheck definitions, secret leakage in ENV).
4. **Documentation Integrity**: Maintain rich explanations, mermaid diagrams, and practical examples across all guides.
