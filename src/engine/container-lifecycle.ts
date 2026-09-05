/**
 * Container Lifecycle State Machine Simulator.
 * Models states (created, running, paused, restarting, exited, dead), signals, restart policies, and healthchecks.
 */

export type ContainerState =
  | "created"
  | "running"
  | "paused"
  | "restarting"
  | "exited"
  | "dead";

export type RestartPolicy = "no" | "always" | "on-failure" | "unless-stopped";
export type HealthStatus = "starting" | "healthy" | "unhealthy" | "none";

export interface LifecycleTransition {
  timestamp: number;
  fromState: ContainerState;
  toState: ContainerState;
  trigger: string;
  exitCode?: number;
  reason?: string;
}

export class ContainerLifecycleStateMachine {
  public containerId: string;
  public image: string;
  public currentState: ContainerState = "created";
  public exitCode: number | null = null;
  public restartPolicy: RestartPolicy;
  public restartCount = 0;
  public healthStatus: HealthStatus;
  public history: LifecycleTransition[] = [];

  constructor(
    containerId = "c_node_app",
    image = "manthanank/learn-docker:latest",
    restartPolicy: RestartPolicy = "unless-stopped",
    hasHealthcheck = true
  ) {
    this.containerId = containerId;
    this.image = image;
    this.restartPolicy = restartPolicy;
    this.healthStatus = hasHealthcheck ? "starting" : "none";

    this.recordTransition("created", "container initialized (docker create)");
  }

  public start(): boolean {
    if (this.currentState !== "created" && this.currentState !== "exited") {
      return false;
    }
    this.transitionTo("running", "docker start / run");
    if (this.healthStatus === "starting") {
      // Simulate successful initial health check
      this.healthStatus = "healthy";
    }
    return true;
  }

  public pause(): boolean {
    if (this.currentState !== "running") return false;
    this.transitionTo("paused", "docker pause (SIGSTOP)");
    return true;
  }

  public unpause(): boolean {
    if (this.currentState !== "paused") return false;
    this.transitionTo("running", "docker unpause (SIGCONT)");
    return true;
  }

  public stop(timeoutMs = 10000): boolean {
    if (this.currentState !== "running" && this.currentState !== "paused") return false;
    // Sends SIGTERM first, waits timeout, sends SIGKILL if ungraceful
    this.exitCode = 0;
    this.transitionTo("exited", `docker stop (SIGTERM graceful, exit 0, timeout ${timeoutMs}ms)`, 0);
    return true;
  }

  public kill(signal = "SIGKILL"): boolean {
    if (this.currentState !== "running" && this.currentState !== "paused") return false;
    const code = signal === "SIGKILL" ? 137 : 143;
    this.exitCode = code;
    this.transitionTo("exited", `docker kill (${signal}, forced)`, code);

    // Evaluate restart policy
    this.evaluateRestart();
    return true;
  }

  public fail(exitCode = 1, reason = "Unhandled process exception"): void {
    if (this.currentState !== "running") return;
    this.exitCode = exitCode;
    this.transitionTo("exited", `process crashed: ${reason}`, exitCode);
    this.evaluateRestart();
  }

  public failHealthcheck(): void {
    if (this.currentState === "running") {
      this.healthStatus = "unhealthy";
      this.recordTransition(this.currentState, "healthcheck probe failed (3/3 consecutive failures)");
    }
  }

  private evaluateRestart(): void {
    let shouldRestart = false;

    if (this.restartPolicy === "always") {
      shouldRestart = true;
    } else if (this.restartPolicy === "unless-stopped" && this.currentState !== "dead") {
      shouldRestart = true;
    } else if (this.restartPolicy === "on-failure" && this.exitCode !== 0) {
      shouldRestart = true;
    }

    if (shouldRestart && this.restartCount < 5) {
      this.restartCount++;
      this.transitionTo("restarting", `restarting container according to policy '${this.restartPolicy}' (attempt #${this.restartCount})`);
      // Transition back to running
      this.transitionTo("running", "container restarted successfully");
    }
  }

  private transitionTo(toState: ContainerState, trigger: string, exitCode?: number): void {
    const fromState = this.currentState;
    this.currentState = toState;
    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    }
    this.recordTransition(fromState, trigger, exitCode);
  }

  private recordTransition(fromState: ContainerState, trigger: string, exitCode?: number): void {
    this.history.push({
      timestamp: Date.now(),
      fromState,
      toState: this.currentState,
      trigger,
      exitCode,
      reason: trigger
    });
  }

  public getSnapshot(): {
    containerId: string;
    image: string;
    state: ContainerState;
    exitCode: number | null;
    restartPolicy: RestartPolicy;
    restartCount: number;
    healthStatus: HealthStatus;
    history: LifecycleTransition[];
  } {
    return {
      containerId: this.containerId,
      image: this.image,
      state: this.currentState,
      exitCode: this.exitCode,
      restartPolicy: this.restartPolicy,
      restartCount: this.restartCount,
      healthStatus: this.healthStatus,
      history: this.history
    };
  }
}
