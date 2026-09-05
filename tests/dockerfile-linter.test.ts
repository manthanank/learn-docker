import { describe, it, expect } from "vitest";
import { parseDockerfile } from "../src/engine/dockerfile-parser";
import { lintDockerfile } from "../src/engine/dockerfile-linter";

describe("Dockerfile Linter & CIS Security Scanner", () => {
  it("should flag root user and unpinned tags", () => {
    const badDockerfile = `
FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
CMD node index.js
`;
    const ast = parseDockerfile(badDockerfile);
    const report = lintDockerfile(ast);

    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.id === "DOCKER-SEC-001")).toBe(true); // Root user
    expect(report.issues.some((i) => i.id === "DOCKER-SEC-002")).toBe(true); // :latest tag
    expect(report.issues.some((i) => i.id === "DOCKER-REL-001")).toBe(true); // Shell form CMD
  });

  it("should flag exposed secrets in ENV", () => {
    const secretDockerfile = `
FROM node:22-alpine
ENV AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
USER 1001
CMD ["node", "app.js"]
`;
    const ast = parseDockerfile(secretDockerfile);
    const report = lintDockerfile(ast);

    expect(report.issues.some((i) => i.id === "DOCKER-SEC-003")).toBe(true);
    expect(report.isValid).toBe(false);
  });

  it("should flag unchained apt-get and suboptimal cache ordering", () => {
    const inefficientDockerfile = `
FROM ubuntu:22.04
WORKDIR /app
COPY . .
RUN apt-get update
RUN apt-get install -y python3
RUN npm install
USER 1000
CMD ["python3", "main.py"]
`;
    const ast = parseDockerfile(inefficientDockerfile);
    const report = lintDockerfile(ast);

    expect(report.issues.some((i) => i.id === "DOCKER-PERF-001")).toBe(true); // apt-get cache not cleaned
    expect(report.issues.some((i) => i.id === "DOCKER-PERF-002")).toBe(true); // copy . . before npm install
  });

  it("should pass a hardened, production-grade Dockerfile with a high score", () => {
    const secureDockerfile = `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -S -g 1001 appgroup && adduser -S -u 1001 -G appgroup appuser
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
USER appuser
HEALTHCHECK --interval=30s --timeout=5s CMD wget --spider http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
`;
    const ast = parseDockerfile(secureDockerfile);
    const report = lintDockerfile(ast);

    expect(report.isValid).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(report.score).toBeGreaterThanOrEqual(90);
  });
});
