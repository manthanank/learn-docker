import { describe, it, expect } from "vitest";
import { ContainerIsolationSimulator } from "../src/engine/isolation-simulator";

describe("Container Isolation & Cgroups Simulator", () => {
  it("should initialize PID 1 and separate host PID from container PID", () => {
    const sim = new ContainerIsolationSimulator("c_test", "node-host");
    const snapshot = sim.getIsolationSnapshot();

    expect(snapshot.namespaces.pid.count).toBe(1);
    const pid1 = snapshot.namespaces.pid.tree[0];
    expect(pid1.containerPid).toBe(1);
    expect(pid1.hostPid).toBeGreaterThanOrEqual(14000);
    expect(snapshot.namespaces.uts.hostname).toBe("node-host");
  });

  it("should simulate process tree spawning and child subreaper adoption", () => {
    const sim = new ContainerIsolationSimulator("c_test", "node-host");
    const child = sim.spawnProcess("worker-thread", 1, 10 * 1024 * 1024, 5.0);
    expect(child.containerPid).toBe(2);
    expect(child.ppid).toBe(1);

    // If PID 1 is killed, all processes in PID namespace are reaped
    sim.killProcess(1, 9);
    expect(sim.processes.size).toBe(0);
  });

  it("should enforce Cgroups memory limits and invoke OOM Killer when exceeded", () => {
    const sim = new ContainerIsolationSimulator("c_oom_test", "node-host", {
      memory: {
        maxBytes: 100 * 1024 * 1024, // 100 MB max
        highBytes: 80 * 1024 * 1024,
        swapMaxBytes: 0
      }
    });

    // Allocate 120 MB (exceeds 100 MB limit)
    const res = sim.allocateMemory(1, 120 * 1024 * 1024);
    expect(res.oomKilled).toBe(true);
    expect(res.allocated).toBe(false);
    expect(sim.metrics.memoryOOMKilled).toBe(true);
  });

  it("should calculate CPU CFS throttling correctly", () => {
    const sim = new ContainerIsolationSimulator("c_cpu_test", "node-host", {
      cpu: {
        quotaMicroseconds: 50000, // 0.5 CPU = 50%
        periodMicroseconds: 100000,
        weight: 100
      }
    });

    const burst = sim.simulateCpuBurst(80.0);
    expect(burst.throttled).toBe(true);
    expect(burst.allowedPercent).toBe(50);
    expect(burst.throttledPercent).toBe(30);
  });
});
