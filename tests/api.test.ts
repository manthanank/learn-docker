import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Server } from "http";
import { AddressInfo } from "net";
import { app } from "../src/server";

describe("Express API Integration Endpoints", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("GET /health should return 200 and health payload", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.service).toBe("learn-docker");
  });

  it("POST /api/dockerfile/lint should analyze a Dockerfile and return a report", async () => {
    const res = await fetch(`${baseUrl}/api/dockerfile/lint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dockerfile: `FROM alpine:3.18\nRUN echo hello\nUSER 1001\nHEALTHCHECK CMD true\nCMD ["echo", "hi"]`
      })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.report.isValid).toBe(true);
  });

  it("POST /api/overlayfs/simulate should return layer stack and CoW results", async () => {
    const res = await fetch(`${baseUrl}/api/overlayfs/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actions: [{ op: "write", path: "/test.txt", content: "hello world" }]
      })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.state.totalLayers).toBeGreaterThanOrEqual(2);
  });

  it("POST /api/compose/resolve should resolve a compose spec", async () => {
    const res = await fetch(`${baseUrl}/api/compose/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yaml: "services:\n  app:\n    image: node:22-alpine\n"
      })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.result.services).toEqual(["app"]);
  });

  it("POST /api/isolation/simulate should return namespaces and cgroups status", async () => {
    const res = await fetch(`${baseUrl}/api/isolation/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "burst_cpu", cpuPercent: 80 })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.snapshot.namespaces.pid.count).toBeGreaterThanOrEqual(1);
  });
});
