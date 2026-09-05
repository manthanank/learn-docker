#!/usr/bin/env node
/**
 * CLI tool for learn-docker: Dockerfile AST linting, OverlayFS simulation, and Compose analysis.
 */

import * as fs from "fs";
import * as path from "path";
import { parseDockerfile } from "./engine/dockerfile-parser";
import { lintDockerfile } from "./engine/dockerfile-linter";
import { OverlayFSSimulator } from "./engine/overlayfs-simulator";
import { parseAndResolveCompose } from "./engine/compose-resolver";
import { app } from "./server";

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Learn Docker Enterprise CLI & Simulator

USAGE:
  learn-docker <command> [options]

COMMANDS:
  lint <path/to/Dockerfile>    Parse and scan Dockerfile for security and best practices
  overlay                      Run an OverlayFS Copy-on-Write (CoW) simulation
  compose <docker-compose.yml> Analyze Compose dependency graph and startup sequence
  serve [--port <number>]      Start the interactive web dashboard and API server
  --help, -h                   Display this help message

EXAMPLES:
  learn-docker lint ./Dockerfile
  learn-docker compose ./docker-compose.yml
  learn-docker overlay
  learn-docker serve --port 3000
`);
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "lint") {
    const targetFile = args[1] || "Dockerfile";
    const fullPath = path.resolve(process.cwd(), targetFile);

    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found at '${fullPath}'`);
      process.exit(1);
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const ast = parseDockerfile(content);
    const report = lintDockerfile(ast);

    console.log(`\n========================================`);
    console.log(`Dockerfile Linter: ${path.basename(fullPath)}`);
    console.log(`Stages Detected: ${ast.stages.length} | Instructions: ${ast.instructions.length}`);
    console.log(`Security & Health Score: ${report.score}/100 ${report.isValid ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`========================================\n`);

    if (report.issues.length === 0) {
      console.log(`✨ No issues found! Clean, production-ready Dockerfile.`);
      process.exit(0);
    }

    for (const issue of report.issues) {
      const icon = issue.severity === "error" ? "❌ [ERROR]" : issue.severity === "warning" ? "⚠️  [WARN]" : "ℹ️  [INFO]";
      console.log(`${icon} Line ${issue.line} (${issue.id})`);
      console.log(`   ${issue.message}`);
      if (issue.instruction) console.log(`   Snippet: ${issue.instruction}`);
      console.log(`   Fix: ${issue.recommendation}\n`);
    }

    process.exit(report.isValid ? 0 : 1);
  }

  if (command === "overlay") {
    console.log("\nSimulating Overlay2 Union Filesystem...\n");
    const sim = new OverlayFSSimulator("cli_demo");

    sim.addLowerLayer("Base Image (alpine:3.17)", "FROM alpine:3.17", {
      "/bin/sh": "sh binary",
      "/etc/hosts": "127.0.0.1 localhost"
    });

    sim.addLowerLayer("Dependencies Layer", "RUN apk add --no-cache curl", {
      "/usr/bin/curl": "curl binary"
    });

    console.log("1. Modifying /etc/hosts in container (Copy-on-Write)...");
    const modResult = sim.writeFile("/etc/hosts", "127.0.0.1 localhost my-custom-domain.local");
    console.log(`   Copied Up: ${modResult.copiedUp} (from ${modResult.sourceLayerId} -> ${modResult.targetLayerId})`);

    console.log("2. Deleting /bin/sh in container (Whiteout file creation)...");
    const delResult = sim.deleteFile("/bin/sh");
    console.log(`   Whiteout Marker Created: ${delResult.isWhiteout}`);

    const state = sim.inspectState();
    console.log(`\nActive Files in MergedDir: ${state.mergedFiles.length}`);
    for (const f of state.mergedFiles) {
      console.log(`   - ${f.path} (from layer: ${f.layerId})`);
    }
    process.exit(0);
  }

  if (command === "compose") {
    const composeFile = args[1] || "docker-compose.yml";
    const fullPath = path.resolve(process.cwd(), composeFile);

    if (!fs.existsSync(fullPath)) {
      console.error(`Error: Compose file not found at '${fullPath}'`);
      process.exit(1);
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const result = parseAndResolveCompose(content);

    console.log(`\n========================================`);
    console.log(`Docker Compose DAG Resolver: ${path.basename(fullPath)}`);
    console.log(`Services: ${result.services.join(", ")}`);
    console.log(`Cycle Detected: ${result.hasCycle ? "YES ⚠️" : "NO ✅"}`);
    console.log(`========================================\n`);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(`❌ ${err}`);
      }
    }

    if (result.startupOrder.length > 0) {
      console.log("Ordered Startup Batches (Concurrency Levels):");
      result.startupOrder.forEach((batch, idx) => {
        console.log(`  Level ${idx + 1}: [ ${batch.join(", ")} ]`);
      });

      console.log(`\nShutdown Order (Reverse Topology):`);
      console.log(`  ${result.shutdownOrder.join(" -> ")}\n`);
    }

    process.exit(result.isValid ? 0 : 1);
  }

  if (command === "serve") {
    const portIdx = args.indexOf("--port");
    const port = portIdx !== -1 && args[portIdx + 1] ? Number(args[portIdx + 1]) : 3000;

    app.listen(port, () => {
      console.log(`[learn-docker] Interactive server active at http://localhost:${port}`);
      console.log(`[learn-docker] Open http://localhost:${port}/index.html in your browser.`);
    });
    return;
  }

  console.error(`Unknown command '${command}'. Use 'learn-docker --help' for usage.`);
  process.exit(1);
}

if (require.main === module) {
  main();
}
