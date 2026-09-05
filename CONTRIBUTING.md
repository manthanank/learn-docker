# Contributing to Learn Docker

Thank you for your interest in contributing to `learn-docker`! This project is an enterprise-grade curriculum, container internals simulator, and interactive reference platform.

## Development Workflow

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- Docker (optional for live runtime execution, simulation suite runs 100% offline)

### Setup
```bash
git clone https://github.com/manthanank/learn-docker.git
cd learn-docker
npm install
```

### Local Development & Testing
```bash
# Run unit and integration tests
npm test

# Run tests in watch mode
npm run test:watch

# Start development server
npm run dev

# Build TypeScript to dist/
npm run build

# Run Dockerfile AST linter
npm run lint
```

## Pull Request Guidelines

1. Fork the repository and create a descriptive branch: `git checkout -b feat/overlayfs-enhancements`.
2. Follow standard Conventional Commits (`feat:`, `fix:`, `docs:`, `perf:`, `test:`, `refactor:`).
3. Ensure all tests pass with 100% success rate: `npm test`.
4. Ensure TypeScript compiles without warnings or errors: `npm run build`.
5. Update or add unit tests for any new parser, linter, or simulator functionality.
6. Open a Pull Request referencing the relevant issue and detailing your architectural changes.
