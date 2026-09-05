/**
 * Dockerfile Lexer, AST Parser, and Multi-Stage Target Extractor.
 */

export type DockerInstructionType =
  | "FROM"
  | "RUN"
  | "COPY"
  | "ADD"
  | "ENV"
  | "ARG"
  | "EXPOSE"
  | "ENTRYPOINT"
  | "CMD"
  | "WORKDIR"
  | "USER"
  | "VOLUME"
  | "HEALTHCHECK"
  | "LABEL"
  | "STOPSIGNAL"
  | "SHELL"
  | "ONBUILD"
  | "MAINTAINER";

export interface DockerInstructionNode {
  type: DockerInstructionType;
  raw: string;
  lineNumber: number;
  flags: Record<string, string>;
  args: string[];
  rawArgs: string;
  stageName?: string;
  stageIndex: number;
}

export interface DockerBuildStage {
  name?: string;
  index: number;
  baseImage: string;
  baseTag: string;
  baseDigest?: string;
  platform?: string;
  instructions: DockerInstructionNode[];
}

export interface DockerfileAST {
  instructions: DockerInstructionNode[];
  stages: DockerBuildStage[];
  globalArgs: Record<string, string>;
  comments: Array<{ line: number; text: string }>;
  linesCount: number;
}

/**
 * Tokenize and parse raw Dockerfile text into a structured AST.
 */
export function parseDockerfile(content: string): DockerfileAST {
  const rawLines = content.split(/\r?\n/);
  const instructions: DockerInstructionNode[] = [];
  const comments: Array<{ line: number; text: string }> = [];
  const globalArgs: Record<string, string> = {};

  let currentLineNumber = 0;
  let accumulatedRaw = "";
  let accumulatedStartLine = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();
    currentLineNumber = i + 1;

    if (trimmed.startsWith("#")) {
      comments.push({ line: currentLineNumber, text: trimmed.slice(1).trim() });
      continue;
    }

    if (!trimmed) {
      continue;
    }

    // Line continuation with backslash or backtick
    if (trimmed.endsWith("\\")) {
      if (!accumulatedRaw) {
        accumulatedStartLine = currentLineNumber;
      }
      accumulatedRaw += trimmed.slice(0, -1).trim() + " ";
      continue;
    } else {
      if (accumulatedRaw) {
        accumulatedRaw += trimmed;
        const parsed = parseSingleInstruction(accumulatedRaw, accumulatedStartLine);
        if (parsed) instructions.push(parsed);
        accumulatedRaw = "";
        accumulatedStartLine = 0;
      } else {
        const parsed = parseSingleInstruction(trimmed, currentLineNumber);
        if (parsed) instructions.push(parsed);
      }
    }
  }

  // Stages segmentation
  const stages: DockerBuildStage[] = [];
  let currentStage: DockerBuildStage | null = null;
  let stageIdx = 0;

  for (const inst of instructions) {
    if (inst.type === "FROM") {
      const fromDetails = parseFromInstruction(inst.rawArgs);
      currentStage = {
        index: stageIdx++,
        name: fromDetails.alias,
        baseImage: fromDetails.image,
        baseTag: fromDetails.tag,
        baseDigest: fromDetails.digest,
        platform: inst.flags["platform"],
        instructions: []
      };
      stages.push(currentStage);
      inst.stageIndex = currentStage.index;
      inst.stageName = currentStage.name;
    } else {
      if (!currentStage) {
        // Global scope instructions prior to first FROM (e.g. ARG)
        if (inst.type === "ARG") {
          const [key, val] = inst.rawArgs.split("=");
          globalArgs[key.trim()] = val ? val.trim() : "";
        }
        inst.stageIndex = -1;
      } else {
        inst.stageIndex = currentStage.index;
        inst.stageName = currentStage.name;
        currentStage.instructions.push(inst);
      }
    }
  }

  return {
    instructions,
    stages,
    globalArgs,
    comments,
    linesCount: rawLines.length
  };
}

function parseSingleInstruction(line: string, lineNumber: number): DockerInstructionNode | null {
  const match = line.match(/^([A-Za-z]+)\s*(.*)$/);
  if (!match) return null;

  const type = match[1].toUpperCase() as DockerInstructionType;
  const rawRest = match[2].trim();

  // Extract flags (e.g., --chown=appuser:appgroup, --from=builder, --platform=linux/amd64)
  const flags: Record<string, string> = {};
  let remaining = rawRest;

  while (remaining.startsWith("--")) {
    const flagMatch = remaining.match(/^--([a-zA-Z0-9_-]+)(?:=([^\s]+))?\s*(.*)$/);
    if (!flagMatch) break;
    const [, key, val, rest] = flagMatch;
    flags[key] = val !== undefined ? val : "true";
    remaining = rest.trim();
  }

  // Parse arguments into array (handles JSON array format and whitespace separated)
  const args = parseArgs(remaining);

  return {
    type,
    raw: line,
    lineNumber,
    flags,
    args,
    rawArgs: remaining,
    stageIndex: 0
  };
}

function parseArgs(argsString: string): string[] {
  const trimmed = argsString.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x));
      }
    } catch {
      // Fallback if not strict JSON
    }
  }

  // Regex tokenizer handling quotes
  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  return matches ? matches.map((m) => m.replace(/^["']|["']$/g, "")) : [];
}

export function parseFromInstruction(args: string): {
  image: string;
  tag: string;
  digest?: string;
  alias?: string;
} {
  // FROM [--platform=...] image[:tag][@digest] [AS alias]
  let text = args.trim();
  let alias: string | undefined;

  const asMatch = text.match(/\s+[Aa][Ss]\s+([A-Za-z0-9_.-]+)$/);
  if (asMatch) {
    alias = asMatch[1];
    text = text.slice(0, asMatch.index).trim();
  }

  let digest: string | undefined;
  if (text.includes("@")) {
    const parts = text.split("@");
    text = parts[0];
    digest = parts[1];
  }

  let image = text;
  let tag = "latest";

  if (text.includes(":")) {
    const parts = text.split(":");
    image = parts[0];
    tag = parts[1];
  }

  return { image, tag, digest, alias };
}
