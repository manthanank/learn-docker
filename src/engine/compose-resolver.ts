/**
 * Docker Compose V2/V3 Spec Parser, DAG Dependency Resolver & Network Topology Builder.
 * Implements Kahn's topological sort algorithm, cycle detection, and service boot sequencing.
 */

import * as YAML from "yaml";

export interface ComposeService {
  name: string;
  image?: string;
  build?: string | { context: string; dockerfile?: string };
  command?: string | string[];
  ports?: string[];
  environment?: Record<string, string> | string[];
  depends_on?: string[] | Record<string, { condition: string }>;
  networks?: string[];
  volumes?: string[];
  restart?: string;
}

export interface ComposeSpec {
  version?: string;
  services: Record<string, ComposeService>;
  networks?: Record<string, { driver?: string; internal?: boolean }>;
  volumes?: Record<string, { driver?: string }>;
}

export interface ComposeDAGNode {
  name: string;
  service: ComposeService;
  dependencies: string[];
  dependents: string[];
  inDegree: number;
  level: number;
}

export interface ComposeResolutionResult {
  isValid: boolean;
  services: string[];
  startupOrder: string[][]; // Batches of services that can boot concurrently in levels
  shutdownOrder: string[];
  hasCycle: boolean;
  cycleNodes?: string[];
  networkMap: Record<string, string[]>;
  volumeMap: Record<string, string[]>;
  errors: string[];
}

export function parseAndResolveCompose(yamlContent: string): ComposeResolutionResult {
  let doc: unknown;
  try {
    doc = YAML.parse(yamlContent);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      isValid: false,
      services: [],
      startupOrder: [],
      shutdownOrder: [],
      hasCycle: false,
      networkMap: {},
      volumeMap: {},
      errors: [`YAML Syntax Error: ${errorMsg}`]
    };
  }

  if (!doc || typeof doc !== "object" || !("services" in doc)) {
    return {
      isValid: false,
      services: [],
      startupOrder: [],
      shutdownOrder: [],
      hasCycle: false,
      networkMap: {},
      volumeMap: {},
      errors: ["Missing top-level 'services' key in Docker Compose specification."]
    };
  }

  const spec = doc as ComposeSpec;
  const serviceNames = Object.keys(spec.services || {});

  if (serviceNames.length === 0) {
    return {
      isValid: false,
      services: [],
      startupOrder: [],
      shutdownOrder: [],
      hasCycle: false,
      networkMap: {},
      volumeMap: {},
      errors: ["No services defined in compose file."]
    };
  }

  // Build DAG nodes
  const nodes = new Map<string, ComposeDAGNode>();
  for (const name of serviceNames) {
    nodes.set(name, {
      name,
      service: spec.services[name],
      dependencies: [],
      dependents: [],
      inDegree: 0,
      level: 0
    });
  }

  const errors: string[] = [];

  // Populate dependencies
  for (const [name, svc] of Object.entries(spec.services)) {
    const node = nodes.get(name)!;
    const rawDeps = svc.depends_on;

    let depsList: string[] = [];
    if (Array.isArray(rawDeps)) {
      depsList = rawDeps;
    } else if (rawDeps && typeof rawDeps === "object") {
      depsList = Object.keys(rawDeps);
    }

    for (const dep of depsList) {
      if (!nodes.has(dep)) {
        errors.push(`Service '${name}' depends on undefined service '${dep}'.`);
        continue;
      }
      node.dependencies.push(dep);
      nodes.get(dep)!.dependents.push(name);
    }
  }

  // Kahn's Algorithm for Topological Sort & Cycle Detection
  const inDegreeMap = new Map<string, number>();
  for (const [name, node] of nodes.entries()) {
    inDegreeMap.set(name, node.dependencies.length);
  }

  const queue: string[] = [];
  for (const [name, inDeg] of inDegreeMap.entries()) {
    if (inDeg === 0) {
      queue.push(name);
    }
  }

  const sorted: string[] = [];
  const levelMap = new Map<string, number>();
  for (const s of queue) {
    levelMap.set(s, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    const currentLevel = levelMap.get(current) || 0;

    const node = nodes.get(current)!;
    for (const dependent of node.dependents) {
      const currentInDeg = inDegreeMap.get(dependent)! - 1;
      inDegreeMap.set(dependent, currentInDeg);

      const existingLevel = levelMap.get(dependent) || 0;
      levelMap.set(dependent, Math.max(existingLevel, currentLevel + 1));

      if (currentInDeg === 0) {
        queue.push(dependent);
      }
    }
  }

  const hasCycle = sorted.length < serviceNames.length;
  let cycleNodes: string[] | undefined;
  if (hasCycle) {
    cycleNodes = serviceNames.filter((s) => (inDegreeMap.get(s) || 0) > 0);
    errors.push(`Cyclic dependency detected among services: ${cycleNodes.join(", ")}`);
  }

  // Group into concurrent boot levels
  const startupBatches: string[][] = [];
  if (!hasCycle) {
    const maxLevel = Math.max(0, ...Array.from(levelMap.values()));
    for (let lvl = 0; lvl <= maxLevel; lvl++) {
      const batch = Array.from(levelMap.entries())
        .filter(([, l]) => l === lvl)
        .map(([name]) => name);
      if (batch.length > 0) {
        startupBatches.push(batch);
      }
    }
  }

  // Build network and volume mapping
  const networkMap: Record<string, string[]> = {};
  const volumeMap: Record<string, string[]> = {};

  for (const [sName, svc] of Object.entries(spec.services)) {
    const nets = Array.isArray(svc.networks) ? svc.networks : ["default"];
    for (const n of nets) {
      if (!networkMap[n]) networkMap[n] = [];
      networkMap[n].push(sName);
    }

    const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
    for (const v of vols) {
      const volName = v.split(":")[0];
      if (!volumeMap[volName]) volumeMap[volName] = [];
      volumeMap[volName].push(sName);
    }
  }

  return {
    isValid: errors.length === 0,
    services: serviceNames,
    startupOrder: startupBatches,
    shutdownOrder: [...sorted].reverse(),
    hasCycle,
    cycleNodes,
    networkMap,
    volumeMap,
    errors
  };
}
