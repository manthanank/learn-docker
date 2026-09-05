/**
 * Linux Container Primitives Simulator: Namespaces & Cgroups v2.
 * Models PID hierarchy, Virtual Ethernet & Bridge NAT, Mount pivot_root, and Cgroups throttling & OOM.
 */

export interface ProcessNode {
  containerPid: number;
  hostPid: number;
  name: string;
  ppid: number;
  cpuUsagePercent: number;
  memoryBytes: number;
  state: "running" | "sleeping" | "zombie" | "stopped";
}

export interface NetworkNamespace {
  vethHost: string;
  vethContainer: string;
  containerIp: string;
  subnet: string;
  gateway: string;
  portMappings: Array<{ hostPort: number; containerPort: number; protocol: "tcp" | "udp" }>;
  routingTable: Array<{ destination: string; gateway: string; iface: string }>;
}

export interface CgroupsV2Config {
  cpu: {
    quotaMicroseconds: number; // e.g. 50000 for 0.5 CPU
    periodMicroseconds: number; // standard CFS period 100000 us
    weight: number; // default 100 (1..10000)
  };
  memory: {
    maxBytes: number; // Hard limit (triggers OOM killer)
    highBytes: number; // Soft throttle limit
    swapMaxBytes: number;
  };
  pids: {
    max: number; // Maximum processes allowed in cgroup
  };
}

export interface CgroupsMetrics {
  cpuThrottledCycles: number;
  cpuTotalUsageUs: number;
  memoryUsageBytes: number;
  memoryOOMKilled: boolean;
  activeProcesses: number;
}

export class ContainerIsolationSimulator {
  public containerId: string;
  public hostname: string;
  public processes: Map<number, ProcessNode> = new Map();
  public network: NetworkNamespace;
  public cgroups: CgroupsV2Config;
  public metrics: CgroupsMetrics;

  private nextHostPid = 14200;
  private nextContainerPid = 1;

  constructor(
    containerId = "c_node_prod",
    hostname = "learn-docker-node",
    cgroupsOverride?: Partial<CgroupsV2Config>
  ) {
    this.containerId = containerId;
    this.hostname = hostname;

    this.network = {
      vethHost: `veth_${containerId.slice(0, 7)}`,
      vethContainer: "eth0",
      containerIp: "172.17.0.2",
      subnet: "172.17.0.0/16",
      gateway: "172.17.0.1 (docker0)",
      portMappings: [{ hostPort: 3000, containerPort: 3000, protocol: "tcp" }],
      routingTable: [
        { destination: "0.0.0.0/0", gateway: "172.17.0.1", iface: "eth0" },
        { destination: "172.17.0.0/16", gateway: "0.0.0.0", iface: "eth0" }
      ]
    };

    this.cgroups = {
      cpu: {
        quotaMicroseconds: cgroupsOverride?.cpu?.quotaMicroseconds ?? 100000, // 1.0 CPU
        periodMicroseconds: 100000,
        weight: 100
      },
      memory: {
        maxBytes: cgroupsOverride?.memory?.maxBytes ?? 512 * 1024 * 1024, // 512 MB
        highBytes: cgroupsOverride?.memory?.highBytes ?? 450 * 1024 * 1024,
        swapMaxBytes: 0
      },
      pids: {
        max: cgroupsOverride?.pids?.max ?? 1024
      }
    };

    this.metrics = {
      cpuThrottledCycles: 0,
      cpuTotalUsageUs: 0,
      memoryUsageBytes: 0,
      memoryOOMKilled: false,
      activeProcesses: 0
    };

    // Spawn PID 1 inside container (Entrypoint process)
    this.spawnProcess("node dist/server.js", 0, 45 * 1024 * 1024, 5.0);
  }

  /**
   * Spawn a new process inside the container's PID namespace.
   */
  public spawnProcess(
    name: string,
    parentPid = 1,
    memoryBytes = 10 * 1024 * 1024,
    cpuPercent = 2.0
  ): ProcessNode {
    if (this.processes.size >= this.cgroups.pids.max) {
      throw new Error(`cgroup pid.max limit exceeded: maximum ${this.cgroups.pids.max} processes.`);
    }

    const cpid = this.nextContainerPid++;
    const hpid = this.nextHostPid++;

    const proc: ProcessNode = {
      containerPid: cpid,
      hostPid: hpid,
      name,
      ppid: parentPid,
      cpuUsagePercent: cpuPercent,
      memoryBytes,
      state: "running"
    };

    this.processes.set(cpid, proc);
    this.recalculateMetrics();

    return proc;
  }

  /**
   * Simulate memory allocation within container cgroup.
   * If total memory exceeds cgroups.memory.maxBytes, triggers kernel OOM Killer.
   */
  public allocateMemory(targetPid: number, additionalBytes: number): {
    allocated: boolean;
    oomKilled: boolean;
    killedPid?: number;
    currentMemoryBytes: number;
    maxBytes: number;
  } {
    const proc = this.processes.get(targetPid);
    if (!proc) {
      throw new Error(`Process with PID ${targetPid} not found.`);
    }

    proc.memoryBytes += additionalBytes;
    this.recalculateMetrics();

    if (this.metrics.memoryUsageBytes > this.cgroups.memory.maxBytes) {
      // OOM Killer invoked! Finds highest memory consumer or target process
      const victim = this.findOOMVictim();
      if (victim) {
        this.killProcess(victim.containerPid, 9); // SIGKILL
        this.metrics.memoryOOMKilled = true;
        return {
          allocated: false,
          oomKilled: true,
          killedPid: victim.containerPid,
          currentMemoryBytes: this.metrics.memoryUsageBytes,
          maxBytes: this.cgroups.memory.maxBytes
        };
      }
    }

    return {
      allocated: true,
      oomKilled: false,
      currentMemoryBytes: this.metrics.memoryUsageBytes,
      maxBytes: this.cgroups.memory.maxBytes
    };
  }

  /**
   * Simulate CPU burst and check for CFS throttling.
   */
  public simulateCpuBurst(requestedPercentage: number): {
    throttled: boolean;
    allowedPercent: number;
    throttledPercent: number;
  } {
    const maxAllowedPercent = (this.cgroups.cpu.quotaMicroseconds / this.cgroups.cpu.periodMicroseconds) * 100;
    if (requestedPercentage > maxAllowedPercent) {
      const throttledDelta = requestedPercentage - maxAllowedPercent;
      this.metrics.cpuThrottledCycles++;
      return {
        throttled: true,
        allowedPercent: maxAllowedPercent,
        throttledPercent: throttledDelta
      };
    }

    return {
      throttled: false,
      allowedPercent: requestedPercentage,
      throttledPercent: 0
    };
  }

  /**
   * Send signal to process in container.
   */
  public killProcess(containerPid: number, signal: number): boolean {
    const proc = this.processes.get(containerPid);
    if (!proc) return false;

    if (signal === 9 || signal === 15) {
      // SIGKILL or SIGTERM
      this.processes.delete(containerPid);

      // If PID 1 dies, the entire container terminates (all children reaped)
      if (containerPid === 1) {
        this.processes.clear();
      } else {
        // Adopt orphaned children to PID 1 (subreaper behavior)
        for (const child of this.processes.values()) {
          if (child.ppid === containerPid) {
            child.ppid = 1;
          }
        }
      }
    }

    this.recalculateMetrics();
    return true;
  }

  private findOOMVictim(): ProcessNode | null {
    let largest: ProcessNode | null = null;
    for (const proc of this.processes.values()) {
      if (!largest || proc.memoryBytes > largest.memoryBytes) {
        largest = proc;
      }
    }
    return largest;
  }

  private recalculateMetrics(): void {
    let totalMem = 0;
    for (const p of this.processes.values()) {
      totalMem += p.memoryBytes;
    }
    this.metrics.memoryUsageBytes = totalMem;
    this.metrics.activeProcesses = this.processes.size;
  }

  public getIsolationSnapshot(): {
    containerId: string;
    hostname: string;
    namespaces: {
      pid: {
        count: number;
        tree: ProcessNode[];
      };
      net: NetworkNamespace;
      mount: {
        rootfs: string;
        isolation: string;
      };
      uts: {
        hostname: string;
      };
    };
    cgroups: {
      config: CgroupsV2Config;
      metrics: CgroupsMetrics;
      effectiveCpuCores: number;
    };
  } {
    return {
      containerId: this.containerId,
      hostname: this.hostname,
      namespaces: {
        pid: {
          count: this.processes.size,
          tree: Array.from(this.processes.values())
        },
        net: this.network,
        mount: {
          rootfs: "/var/lib/docker/overlay2/<layer-id>/merged",
          isolation: "pivot_root isolated private mount namespace"
        },
        uts: {
          hostname: this.hostname
        }
      },
      cgroups: {
        config: this.cgroups,
        metrics: this.metrics,
        effectiveCpuCores: this.cgroups.cpu.quotaMicroseconds / this.cgroups.cpu.periodMicroseconds
      }
    };
  }
}
