import express, { Request, Response } from "express";
import path from "path";
import { parseDockerfile } from "./engine/dockerfile-parser";
import { lintDockerfile } from "./engine/dockerfile-linter";
import { OverlayFSSimulator } from "./engine/overlayfs-simulator";
import { ContainerIsolationSimulator } from "./engine/isolation-simulator";
import { parseAndResolveCompose } from "./engine/compose-resolver";
import { ContainerLifecycleStateMachine } from "./engine/container-lifecycle";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "../public")));

// Health endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "learn-docker",
    version: "1.3.0",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Dockerfile Parser Endpoint
app.post("/api/dockerfile/parse", (req: Request, res: Response) => {
  try {
    const { dockerfile } = req.body;
    if (typeof dockerfile !== "string") {
      res.status(400).json({ error: "Missing or invalid 'dockerfile' string in request body." });
      return;
    }
    const ast = parseDockerfile(dockerfile);
    res.json({ success: true, ast });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Dockerfile Linter Endpoint
app.post("/api/dockerfile/lint", (req: Request, res: Response) => {
  try {
    const { dockerfile } = req.body;
    if (typeof dockerfile !== "string") {
      res.status(400).json({ error: "Missing or invalid 'dockerfile' string in request body." });
      return;
    }
    const ast = parseDockerfile(dockerfile);
    const report = lintDockerfile(ast);
    res.json({ success: true, report, stagesCount: ast.stages.length, instructionsCount: ast.instructions.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// OverlayFS Simulator Endpoint
app.post("/api/overlayfs/simulate", (req: Request, res: Response) => {
  try {
    const sim = new OverlayFSSimulator("demo_container");

    // Initialize realistic base layers
    sim.addLowerLayer("Base Image (alpine:3.17)", "FROM alpine:3.17", {
      "/bin/sh": "#!/bin/sh binary",
      "/etc/os-release": "NAME=Alpine Linux\nVERSION_ID=3.17",
      "/etc/hosts": "127.0.0.1 localhost"
    });

    sim.addLowerLayer("Dependencies Layer", "RUN apk add --no-cache nodejs", {
      "/usr/bin/node": "#!/usr/bin/node binary v18.14",
      "/usr/lib/libnode.so": "shared library blob"
    });

    sim.addLowerLayer("Application Code Layer", "COPY package.json index.js ./", {
      "/app/package.json": '{"name":"demo","dependencies":{}}',
      "/app/index.js": "console.log('Production server');"
    });

    const actions = req.body.actions as Array<{ op: string; path: string; content?: string }> | undefined;
    const actionResults = [];

    if (Array.isArray(actions)) {
      for (const act of actions) {
        if (act.op === "write" && act.path) {
          actionResults.push(sim.writeFile(act.path, act.content || "custom payload"));
        } else if (act.op === "delete" && act.path) {
          actionResults.push(sim.deleteFile(act.path));
        }
      }
    } else {
      // Default demo operations
      actionResults.push(sim.writeFile("/app/index.js", "console.log('Mutated in UpperDir (CoW)');"));
      actionResults.push(sim.writeFile("/tmp/runtime.lock", "lock-data"));
      actionResults.push(sim.deleteFile("/etc/hosts"));
    }

    const state = sim.inspectState();
    res.json({ success: true, actionResults, state });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Linux Isolation (Namespaces & Cgroups) Endpoint
app.post("/api/isolation/simulate", (req: Request, res: Response) => {
  try {
    const sim = new ContainerIsolationSimulator("c_prod_01", "docker-worker-node");

    // Optional user interactions
    const { action, name, bytes, cpuPercent } = req.body || {};
    let result = null;

    if (action === "spawn") {
      result = sim.spawnProcess(name || "worker-thread", 1, bytes || 15 * 1024 * 1024, cpuPercent || 15.0);
    } else if (action === "allocate_mem") {
      result = sim.allocateMemory(1, bytes || 100 * 1024 * 1024);
    } else if (action === "burst_cpu") {
      result = sim.simulateCpuBurst(cpuPercent || 150.0);
    }

    const snapshot = sim.getIsolationSnapshot();
    res.json({ success: true, actionResult: result, snapshot });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Docker Compose Resolver Endpoint
app.post("/api/compose/resolve", (req: Request, res: Response) => {
  try {
    const { yaml } = req.body;
    if (typeof yaml !== "string") {
      res.status(400).json({ error: "Missing or invalid 'yaml' string in request body." });
      return;
    }
    const result = parseAndResolveCompose(yaml);
    res.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Container Lifecycle State Machine Endpoint
app.post("/api/container/lifecycle", (req: Request, res: Response) => {
  try {
    const { action, signal, restartPolicy } = req.body || {};
    const fsm = new ContainerLifecycleStateMachine("c_api_service", "node:22-alpine", restartPolicy || "unless-stopped");

    if (action === "start") fsm.start();
    else if (action === "pause") { fsm.start(); fsm.pause(); }
    else if (action === "stop") { fsm.start(); fsm.stop(); }
    else if (action === "kill") { fsm.start(); fsm.kill(signal || "SIGKILL"); }
    else if (action === "fail") { fsm.start(); fsm.fail(1, "Out of memory or panic"); }
    else if (action === "unhealthy") { fsm.start(); fsm.failHealthcheck(); }
    else { fsm.start(); }

    res.json({ success: true, snapshot: fsm.getSnapshot() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[learn-docker] Interactive server listening at http://localhost:${PORT}`);
    console.log(`[learn-docker] Dashboard UI active at http://localhost:${PORT}/index.html`);
  });
}
