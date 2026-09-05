import { describe, it, expect } from "vitest";
import { ContainerLifecycleStateMachine } from "../src/engine/container-lifecycle";

describe("Container Lifecycle State Machine", () => {
  it("should transition through created -> running -> paused -> running -> exited", () => {
    const fsm = new ContainerLifecycleStateMachine("c_test", "node:22", "no");
    expect(fsm.currentState).toBe("created");

    expect(fsm.start()).toBe(true);
    expect(fsm.currentState).toBe("running");

    expect(fsm.pause()).toBe(true);
    expect(fsm.currentState).toBe("paused");

    expect(fsm.unpause()).toBe(true);
    expect(fsm.currentState).toBe("running");

    expect(fsm.stop()).toBe(true);
    expect(fsm.currentState).toBe("exited");
    expect(fsm.exitCode).toBe(0);
  });

  it("should handle restart policy on failure", () => {
    const fsm = new ContainerLifecycleStateMachine("c_restart", "node:22", "on-failure");
    fsm.start();

    // Process crashes with exit code 1
    fsm.fail(1, "Segment fault");
    expect(fsm.restartCount).toBe(1);
    expect(fsm.currentState).toBe("running");
  });

  it("should record transitions in audit history", () => {
    const fsm = new ContainerLifecycleStateMachine("c_audit", "node:22");
    fsm.start();
    fsm.kill("SIGKILL");

    const snap = fsm.getSnapshot();
    expect(snap.history.length).toBeGreaterThanOrEqual(3);
    expect(snap.exitCode).toBe(137);
  });
});
