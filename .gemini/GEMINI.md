# GEMINI.md - Google Gemini Code & Architecture Guidelines

## Architectural Vision
`learn-docker` serves as both an interactive laboratory for container virtualization internals and an authoritative reference for DevOps/SRE engineers.

## Coding Standards
1. **TypeScript Architecture**:
   - Modular engine division under `src/engine/`.
   - Immutable data transformations where possible.
   - Comprehensive error handling with structured diagnostics.
2. **Container Mechanics Simulation**:
   - Accurately model Linux kernel concepts: PID namespaces (tree hierarchy), Mount namespaces, Network isolation (veth and bridge), and Cgroups v2 limits (CFS scheduler quotas, memory limits).
   - Accurately model Overlay2 storage driver semantics: Lower layers (read-only), Upper layer (read-write), WorkDir (temporary atomic operations), and Merged directory.
