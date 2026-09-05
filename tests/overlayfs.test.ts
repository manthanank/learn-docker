import { describe, it, expect } from "vitest";
import { OverlayFSSimulator } from "../src/engine/overlayfs-simulator";

describe("OverlayFS & Copy-on-Write (CoW) Simulator", () => {
  it("should stack lower layers and provide unified merged reading", () => {
    const sim = new OverlayFSSimulator("test_c1");

    sim.addLowerLayer("Base Layer", "FROM alpine:3.17", {
      "/bin/sh": "binary-sh",
      "/etc/hosts": "127.0.0.1 localhost"
    });

    sim.addLowerLayer("App Layer", "COPY app.js .", {
      "/app/app.js": "console.log('hello');"
    });

    const fileSh = sim.readFile("/bin/sh");
    expect(fileSh).not.toBeNull();
    expect(fileSh?.content).toBe("binary-sh");

    const fileApp = sim.readFile("/app/app.js");
    expect(fileApp).not.toBeNull();
    expect(fileApp?.content).toBe("console.log('hello');");
  });

  it("should perform Copy-on-Write when modifying lower layer file", () => {
    const sim = new OverlayFSSimulator("test_cow");

    const base = sim.addLowerLayer("Base", "FROM base", {
      "/etc/config.json": '{"env":"base"}'
    });

    // Modify file
    const result = sim.writeFile("/etc/config.json", '{"env":"container_modified"}');
    expect(result.copiedUp).toBe(true);
    expect(result.sourceLayerId).toBe(base.id);
    expect(result.targetLayerId.startsWith("upper_")).toBe(true);

    // Merged read returns the modified version
    const active = sim.readFile("/etc/config.json");
    expect(active?.content).toBe('{"env":"container_modified"}');
    expect(active?.layerId.startsWith("upper_")).toBe(true);

    // Base layer remains pristine
    const state = sim.inspectState();
    const baseFile = state.lowerDirs[0].files.find((f) => f.path === "/etc/config.json");
    expect(baseFile?.content).toBe('{"env":"base"}');
  });

  it("should create whiteout file when deleting a file present in lower layer", () => {
    const sim = new OverlayFSSimulator("test_whiteout");

    sim.addLowerLayer("Base", "FROM base", {
      "/etc/unwanted.txt": "delete me"
    });

    expect(sim.readFile("/etc/unwanted.txt")).not.toBeNull();

    const delResult = sim.deleteFile("/etc/unwanted.txt");
    expect(delResult.isWhiteout).toBe(true);

    // Reading the deleted file returns null
    expect(sim.readFile("/etc/unwanted.txt")).toBeNull();

    // Merged filesystem does not contain the file
    const merged = sim.getMergedFilesystem();
    expect(merged.has("/etc/unwanted.txt")).toBe(false);
  });
});
