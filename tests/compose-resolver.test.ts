import { describe, it, expect } from "vitest";
import { parseAndResolveCompose } from "../src/engine/compose-resolver";

describe("Docker Compose Resolver & Topological Sorter", () => {
  it("should resolve valid DAG dependency order and concurrent boot batches", () => {
    const composeYaml = `
version: '3.8'
services:
  web:
    image: nginx
    depends_on:
      - api
  api:
    image: node:22-alpine
    depends_on:
      - db
      - redis
  db:
    image: postgres:16-alpine
  redis:
    image: redis:7-alpine
`;
    const result = parseAndResolveCompose(composeYaml);
    expect(result.isValid).toBe(true);
    expect(result.hasCycle).toBe(false);
    expect(result.services.length).toBe(4);

    // Level 0: db, redis
    // Level 1: api
    // Level 2: web
    expect(result.startupOrder.length).toBe(3);
    expect(result.startupOrder[0].sort()).toEqual(["db", "redis"].sort());
    expect(result.startupOrder[1]).toEqual(["api"]);
    expect(result.startupOrder[2]).toEqual(["web"]);

    // Shutdown is reverse
    expect(result.shutdownOrder[0]).toBe("web");
  });

  it("should detect cyclical dependencies and report offending services", () => {
    const cycleYaml = `
version: '3.8'
services:
  service-a:
    image: alpine
    depends_on:
      - service-b
  service-b:
    image: alpine
    depends_on:
      - service-c
  service-c:
    image: alpine
    depends_on:
      - service-a
`;
    const result = parseAndResolveCompose(cycleYaml);
    expect(result.isValid).toBe(false);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodes?.length).toBe(3);
    expect(result.errors.some((e) => e.includes("Cyclic dependency detected"))).toBe(true);
  });

  it("should handle missing or invalid compose specs gracefully", () => {
    const invalidYaml = `foo: bar: [invalid yaml`;
    const result = parseAndResolveCompose(invalidYaml);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
