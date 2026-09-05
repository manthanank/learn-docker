/**
 * Enterprise Dockerfile AST Linter & Security Scanner.
 * Implements CIS Docker Benchmark rules and BuildKit best practices.
 */

import { DockerfileAST, DockerInstructionNode } from "./dockerfile-parser";

export type LintSeverity = "error" | "warning" | "info";
export type LintCategory = "security" | "performance" | "reliability";

export interface LintIssue {
  id: string;
  category: LintCategory;
  severity: LintSeverity;
  message: string;
  line: number;
  instruction?: string;
  recommendation: string;
}

export interface LintReport {
  isValid: boolean;
  score: number; // 0 - 100
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

export function lintDockerfile(ast: DockerfileAST): LintReport {
  const issues: LintIssue[] = [];

  if (ast.stages.length === 0) {
    return {
      isValid: false,
      score: 0,
      issues: [
        {
          id: "DOCKER-ERR-000",
          category: "reliability",
          severity: "error",
          message: "Dockerfile contains no valid stages or FROM instruction.",
          line: 1,
          recommendation: "Define a base stage using FROM <image>:<tag>."
        }
      ],
      summary: { errors: 1, warnings: 0, infos: 0 }
    };
  }

  const finalStage = ast.stages[ast.stages.length - 1];

  // Rule 1: DOCKER-SEC-001 - Non-root USER in final stage (CIS Benchmark 4.1)
  let userInstruction: DockerInstructionNode | undefined;
  for (const inst of finalStage.instructions) {
    if (inst.type === "USER") {
      userInstruction = inst;
    }
  }

  if (!userInstruction) {
    issues.push({
      id: "DOCKER-SEC-001",
      category: "security",
      severity: "error",
      message: "Container runs as root by default. No USER instruction defined in production stage.",
      line: finalStage.instructions[finalStage.instructions.length - 1]?.lineNumber || 1,
      recommendation: "Create a dedicated non-root user and switch to it using 'USER <username>'."
    });
  } else if (userInstruction.args[0] === "root" || userInstruction.args[0] === "0") {
    issues.push({
      id: "DOCKER-SEC-001",
      category: "security",
      severity: "error",
      message: "Container explicitly declares execution as 'root'.",
      line: userInstruction.lineNumber,
      instruction: userInstruction.raw,
      recommendation: "Use an unprivileged user to mitigate container breakout risks."
    });
  }

  // Rule 2: DOCKER-SEC-002 - Unpinned base image tag
  for (const stage of ast.stages) {
    if (stage.baseTag === "latest" || !stage.baseTag) {
      const fromInst = ast.instructions.find(
        (i) => i.type === "FROM" && i.stageIndex === stage.index
      );
      issues.push({
        id: "DOCKER-SEC-002",
        category: "security",
        severity: "warning",
        message: `Stage '${stage.name || stage.index}' uses unpinned tag ':latest' for image '${stage.baseImage}'.`,
        line: fromInst?.lineNumber || 1,
        instruction: fromInst?.raw,
        recommendation: "Pin base image to an immutable digest (sha256:...) or specific SemVer tag."
      });
    }
  }

  // Rule 3: DOCKER-SEC-003 - Hardcoded secrets in ENV / ARG
  const secretPattern = /(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|AUTH_KEY|CREDENTIAL)/i;
  for (const inst of ast.instructions) {
    if (inst.type === "ENV" || inst.type === "ARG") {
      if (secretPattern.test(inst.rawArgs)) {
        issues.push({
          id: "DOCKER-SEC-003",
          category: "security",
          severity: "error",
          message: `Potential hardcoded credential or secret detected in ${inst.type}: '${inst.rawArgs.slice(0, 30)}...'.`,
          line: inst.lineNumber,
          instruction: inst.raw,
          recommendation: "Do not bake secrets into images. Use BuildKit secret mounts (RUN --mount=type=secret) or runtime environment injection."
        });
      }
    }
  }

  // Rule 4: DOCKER-SEC-004 - ADD instead of COPY
  for (const inst of ast.instructions) {
    if (inst.type === "ADD") {
      const isTarball = inst.args.some((a) => /\.(tar|gz|bz2|xz)$/i.test(a));
      if (!isTarball) {
        issues.push({
          id: "DOCKER-SEC-004",
          category: "security",
          severity: "warning",
          message: "Use of 'ADD' for local files without archive decompression.",
          line: inst.lineNumber,
          instruction: inst.raw,
          recommendation: "Use 'COPY' instead of 'ADD' for files and directories unless extracting local tarballs."
        });
      }
    }
  }

  // Rule 5: DOCKER-SEC-005 - Missing HEALTHCHECK in final stage
  const hasHealthcheck = finalStage.instructions.some((i) => i.type === "HEALTHCHECK");
  if (!hasHealthcheck) {
    issues.push({
      id: "DOCKER-SEC-005",
      category: "reliability",
      severity: "info",
      message: "No HEALTHCHECK instruction defined in final production stage.",
      line: finalStage.instructions[finalStage.instructions.length - 1]?.lineNumber || 1,
      recommendation: "Add a HEALTHCHECK instruction to allow container orchestrators to detect deadlocks and unresponsive processes."
    });
  }

  // Rule 6: DOCKER-PERF-001 - Package manager cache bloat & unchained apt-get
  for (const inst of ast.instructions) {
    if (inst.type === "RUN") {
      const raw = inst.rawArgs;
      if (raw.includes("apt-get update") && !raw.includes("rm -rf /var/lib/apt/lists/*")) {
        issues.push({
          id: "DOCKER-PERF-001",
          category: "performance",
          severity: "warning",
          message: "'apt-get' execution does not clean up cache in the same layer.",
          line: inst.lineNumber,
          instruction: inst.raw,
          recommendation: "Chain 'rm -rf /var/lib/apt/lists/*' in the same RUN instruction to prevent image bloat."
        });
      }
    }
  }

  // Rule 7: DOCKER-PERF-002 - Suboptimal cache ordering
  for (const stage of ast.stages) {
    let copiedAll = false;
    let copyAllLine = 0;
    for (const inst of stage.instructions) {
      if (inst.type === "COPY" && (inst.args.includes(".") || inst.rawArgs.startsWith(". ."))) {
        copiedAll = true;
        copyAllLine = inst.lineNumber;
      }
      if (
        copiedAll &&
        inst.type === "RUN" &&
        /(npm install|npm ci|yarn install|pip install|cargo build|bundle install)/i.test(inst.rawArgs)
      ) {
        issues.push({
          id: "DOCKER-PERF-002",
          category: "performance",
          severity: "warning",
          message: `Heavy dependency install ('${inst.args[0] || "install"}') occurs after copying entire context ('COPY . .').`,
          line: inst.lineNumber,
          instruction: inst.raw,
          recommendation: "Copy only dependency manifests (e.g. package.json, requirements.txt) before dependency installation, then copy application code."
        });
      }
    }
  }

  // Rule 8: DOCKER-REL-001 - Shell form vs Exec form in CMD/ENTRYPOINT
  for (const inst of ast.instructions) {
    if (inst.type === "CMD" || inst.type === "ENTRYPOINT") {
      const isExecForm = inst.rawArgs.trim().startsWith("[") && inst.rawArgs.trim().endsWith("]");
      if (!isExecForm) {
        issues.push({
          id: "DOCKER-REL-001",
          category: "reliability",
          severity: "warning",
          message: `${inst.type} uses shell form instead of JSON exec form.`,
          line: inst.lineNumber,
          instruction: inst.raw,
          recommendation: `Use JSON exec form: ${inst.type} ["executable", "param1", "param2"] to ensure signals (SIGTERM) are delivered directly to the process.`
        });
      }
    }
  }

  // Calculate score (100 - (errors * 25 + warnings * 10 + infos * 3))
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  const deductions = errors * 25 + warnings * 10 + infos * 3;
  const score = Math.max(0, 100 - deductions);

  return {
    isValid: errors === 0,
    score,
    issues,
    summary: { errors, warnings, infos }
  };
}
