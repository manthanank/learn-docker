/**
 * OverlayFS (Overlay2) Union Filesystem & Copy-on-Write (CoW) Simulator.
 * Models LowerDir, UpperDir, WorkDir, MergedDir, Whiteout files (.wh.*), and Layer Caching.
 */

import * as crypto from "crypto";

export interface VirtualFile {
  path: string;
  content: string;
  sizeBytes: number;
  isWhiteout: boolean;
  isOpaqueDir?: boolean;
  layerId: string;
  modifiedAt: number;
}

export interface OverlayLayer {
  id: string;
  name: string;
  type: "lower" | "upper" | "work";
  instruction?: string;
  cacheKey: string;
  cacheHit?: boolean;
  files: Map<string, VirtualFile>;
}

export interface CoWOperationResult {
  operation: "read" | "create" | "modify" | "delete";
  path: string;
  sourceLayerId?: string;
  targetLayerId: string;
  copiedUp: boolean;
  isWhiteout: boolean;
  mergedContent?: string;
}

export class OverlayFSSimulator {
  private lowerLayers: OverlayLayer[] = [];
  private upperLayer: OverlayLayer;
  private workDir: OverlayLayer;

  constructor(containerId = "c_default") {
    this.upperLayer = {
      id: `upper_${containerId}`,
      name: "Container Read-Write Layer (UpperDir)",
      type: "upper",
      cacheKey: "rw-runtime",
      files: new Map()
    };
    this.workDir = {
      id: `work_${containerId}`,
      name: "OverlayFS Atomic Staging (WorkDir)",
      type: "work",
      cacheKey: "workdir-scratch",
      files: new Map()
    };
  }

  /**
   * Add a read-only image layer (LowerDir).
   * Layers are stacked bottom-up: index 0 is base, index N-1 is highest lower layer.
   */
  public addLowerLayer(
    name: string,
    instruction: string,
    initialFiles: Record<string, string>,
    parentCacheKey = "root"
  ): OverlayLayer {
    const layerId = `layer_${crypto.randomBytes(4).toString("hex")}`;
    const fileHashes = Object.entries(initialFiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${crypto.createHash("sha256").update(v).digest("hex")}`)
      .join("|");

    const cacheKey = crypto
      .createHash("sha256")
      .update(`${parentCacheKey}:${instruction}:${fileHashes}`)
      .digest("hex")
      .slice(0, 16);

    const filesMap = new Map<string, VirtualFile>();
    for (const [filePath, content] of Object.entries(initialFiles)) {
      const normalized = this.normalizePath(filePath);
      filesMap.set(normalized, {
        path: normalized,
        content,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
        isWhiteout: false,
        layerId,
        modifiedAt: Date.now()
      });
    }

    const layer: OverlayLayer = {
      id: layerId,
      name,
      type: "lower",
      instruction,
      cacheKey,
      cacheHit: false,
      files: filesMap
    };

    this.lowerLayers.push(layer);
    return layer;
  }

  /**
   * Read file from the Merged filesystem view.
   * Traversal order: UpperDir -> Top LowerDir -> ... -> Base LowerDir.
   */
  public readFile(path: string): VirtualFile | null {
    const normalized = this.normalizePath(path);

    // 1. Check UpperDir
    const upperFile = this.upperLayer.files.get(normalized);
    if (upperFile) {
      if (upperFile.isWhiteout) return null; // File marked deleted
      return upperFile;
    }

    // Check if whiteout file exists in UpperDir (.wh.<filename>)
    const whiteoutPath = this.getWhiteoutPath(normalized);
    if (this.upperLayer.files.has(whiteoutPath)) {
      return null;
    }

    // 2. Traverse LowerLayers from top (latest) to bottom (base)
    for (let i = this.lowerLayers.length - 1; i >= 0; i--) {
      const layer = this.lowerLayers[i];
      const lowerFile = layer.files.get(normalized);
      if (lowerFile) {
        if (lowerFile.isWhiteout) return null;
        return lowerFile;
      }
      if (layer.files.has(whiteoutPath)) {
        return null;
      }
    }

    return null;
  }

  /**
   * Write file to container filesystem.
   * Demonstrates Copy-on-Write (CoW): if file exists in a lower layer, it is copied up to UpperDir.
   */
  public writeFile(path: string, content: string): CoWOperationResult {
    const normalized = this.normalizePath(path);
    const existing = this.readFile(normalized);

    // Clean any prior whiteout in upper layer
    const whiteoutPath = this.getWhiteoutPath(normalized);
    this.upperLayer.files.delete(whiteoutPath);

    const copiedUp = existing !== null && existing.layerId !== this.upperLayer.id;
    const sourceLayerId = existing?.layerId;

    const file: VirtualFile = {
      path: normalized,
      content,
      sizeBytes: Buffer.byteLength(content, "utf-8"),
      isWhiteout: false,
      layerId: this.upperLayer.id,
      modifiedAt: Date.now()
    };

    this.upperLayer.files.set(normalized, file);

    return {
      operation: existing ? "modify" : "create",
      path: normalized,
      sourceLayerId,
      targetLayerId: this.upperLayer.id,
      copiedUp,
      isWhiteout: false,
      mergedContent: content
    };
  }

  /**
   * Delete file from container.
   * If file only exists in UpperDir, it is simply removed.
   * If file exists in any LowerDir, a whiteout marker (.wh.<filename>) is created in UpperDir.
   */
  public deleteFile(path: string): CoWOperationResult {
    const normalized = this.normalizePath(path);
    const existingInLower = this.existsInLower(normalized);

    // Remove direct file in upper if present
    this.upperLayer.files.delete(normalized);

    let isWhiteout = false;
    if (existingInLower) {
      const whiteoutPath = this.getWhiteoutPath(normalized);
      this.upperLayer.files.set(whiteoutPath, {
        path: whiteoutPath,
        content: "",
        sizeBytes: 0,
        isWhiteout: true,
        layerId: this.upperLayer.id,
        modifiedAt: Date.now()
      });
      isWhiteout = true;
    }

    return {
      operation: "delete",
      path: normalized,
      targetLayerId: this.upperLayer.id,
      copiedUp: false,
      isWhiteout
    };
  }

  /**
   * Generate complete MergedDir view of the filesystem.
   */
  public getMergedFilesystem(): Map<string, VirtualFile> {
    const merged = new Map<string, VirtualFile>();

    // Apply from base lower layer up to top lower layer
    for (const layer of this.lowerLayers) {
      for (const [p, file] of layer.files.entries()) {
        if (file.isWhiteout) {
          merged.delete(this.fromWhiteoutPath(p));
        } else {
          merged.set(p, file);
        }
      }
    }

    // Apply Upper layer
    for (const [p, file] of this.upperLayer.files.entries()) {
      if (file.isWhiteout) {
        merged.delete(this.fromWhiteoutPath(p));
      } else {
        merged.set(p, file);
      }
    }

    return merged;
  }

  /**
   * Inspect complete OverlayFS architecture state.
   */
  public inspectState(): {
    lowerDirs: Array<{ id: string; name: string; instruction?: string; files: VirtualFile[] }>;
    upperDir: { id: string; name: string; files: VirtualFile[] };
    workDir: { id: string; name: string };
    mergedFiles: VirtualFile[];
    totalLayers: number;
  } {
    return {
      lowerDirs: this.lowerLayers.map((l) => ({
        id: l.id,
        name: l.name,
        instruction: l.instruction,
        files: Array.from(l.files.values())
      })),
      upperDir: {
        id: this.upperLayer.id,
        name: this.upperLayer.name,
        files: Array.from(this.upperLayer.files.values())
      },
      workDir: {
        id: this.workDir.id,
        name: this.workDir.name
      },
      mergedFiles: Array.from(this.getMergedFilesystem().values()),
      totalLayers: this.lowerLayers.length + 1
    };
  }

  private existsInLower(normalizedPath: string): boolean {
    for (const layer of this.lowerLayers) {
      if (layer.files.has(normalizedPath)) return true;
    }
    return false;
  }

  private normalizePath(p: string): string {
    return "/" + p.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  }

  private getWhiteoutPath(p: string): string {
    const parts = p.split("/");
    const filename = parts.pop()!;
    return [...parts, `.wh.${filename}`].join("/");
  }

  private fromWhiteoutPath(whiteoutPath: string): string {
    return whiteoutPath.replace(/\.wh\./, "");
  }
}
