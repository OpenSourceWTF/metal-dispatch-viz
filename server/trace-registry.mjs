import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open as openFile,
  opendir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

const TRACE_EXTENSIONS = new Set([".jsonl", ".ndjson"]);
const MANIFEST_NAME = "traces.json";
const MANIFEST_MAX_BYTES = 1024 * 1024;
const READ_ONLY_NOFOLLOW =
  typeof constants.O_NOFOLLOW === "number"
    ? constants.O_RDONLY | constants.O_NOFOLLOW
    : undefined;

const WARNINGS = Object.freeze({
  manifestAccess: `Ignored ${MANIFEST_NAME}: it could not be opened safely.`,
  manifestIdentity: `Ignored ${MANIFEST_NAME}: its file identity changed.`,
  manifestMalformed: `Ignored malformed ${MANIFEST_NAME}.`,
  manifestNotRegular: `Ignored ${MANIFEST_NAME}: it must be a regular file.`,
  manifestOversized: `Ignored ${MANIFEST_NAME}: file exceeds the 1 MiB limit.`,
  manifestSchema: `Ignored ${MANIFEST_NAME}: "schema_version" must equal 1.`,
  manifestShape: `Ignored malformed ${MANIFEST_NAME}: "traces" must be an object.`,
  metadataShape: `Ignored invalid trace metadata in ${MANIFEST_NAME}.`,
  nestedDirectory: "Skipped an unreadable trace subdirectory.",
});

export class TraceRegistryError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "TraceRegistryError";
    this.code = code;
  }
}

function emptyManifest(warnings = []) {
  return { rootLabel: undefined, traces: {}, warnings };
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function rootUnavailable() {
  return new TraceRegistryError(
    "Trace root is unavailable or is not a directory.",
    { code: "TRACE_ROOT_UNAVAILABLE" },
  );
}

async function openNoFollow(targetPath) {
  if (READ_ONLY_NOFOLLOW === undefined) {
    const error = new Error("no-follow open is unavailable");
    error.code = "ENOTSUP";
    throw error;
  }
  return openFile(targetPath, READ_ONLY_NOFOLLOW);
}

async function resolveTraceRoot(root) {
  try {
    if (typeof root !== "string" || root.trim() === "") {
      throw new TypeError("invalid root");
    }

    const configuredRoot = path.resolve(root);
    const rootRealPath = await realpath(configuredRoot);
    const rootStats = await stat(rootRealPath, { bigint: true });
    if (!rootStats.isDirectory()) {
      throw new TypeError("not a directory");
    }

    return {
      realPath: rootRealPath,
      device: rootStats.dev,
      inode: rootStats.ino,
    };
  } catch {
    throw rootUnavailable();
  }
}

async function inspectTraceFile(rootRealPath, candidatePath, relativePath) {
  let fileHandle;

  try {
    fileHandle = await openNoFollow(candidatePath);
    const handleStats = await fileHandle.stat({ bigint: true });
    if (!handleStats.isFile()) {
      return undefined;
    }

    const candidateRealPath = await realpath(candidatePath);
    if (
      candidateRealPath !== path.resolve(candidatePath) ||
      !isContained(rootRealPath, candidateRealPath)
    ) {
      return undefined;
    }

    const pathStats = await stat(candidateRealPath, { bigint: true });
    if (!pathStats.isFile() || !sameIdentity(handleStats, pathStats)) {
      return undefined;
    }

    const extension = path.extname(relativePath).toLowerCase();
    return {
      id: stableTraceId(relativePath),
      relativePath,
      name: path.posix.basename(relativePath),
      size: Number(handleStats.size),
      modifiedTime: handleStats.mtime.toISOString(),
      extension,
      realPath: candidateRealPath,
      device: handleStats.dev,
      inode: handleStats.ino,
    };
  } catch {
    return undefined;
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

async function discoverFromResolvedRoot(rootRealPath, hooks = {}) {
  const traces = [];
  const warnings = [];

  async function visit(
    directoryRealPath,
    relativeDirectory = "",
    rootDirectory = false,
  ) {
    try {
      await hooks.beforeDirectory?.(relativeDirectory);
      const directory = await opendir(directoryRealPath);

      for await (const directoryEntry of directory) {
        if (directoryEntry.name.startsWith(".")) {
          continue;
        }

        const candidatePath = path.join(directoryRealPath, directoryEntry.name);
        let candidateStats;
        try {
          candidateStats = await lstat(candidatePath);
        } catch {
          continue;
        }

        if (candidateStats.isSymbolicLink()) {
          continue;
        }

        const relativePath = normalizeRelativePath(
          path.join(relativeDirectory, directoryEntry.name),
        );

        if (candidateStats.isDirectory()) {
          let candidateRealPath;
          try {
            candidateRealPath = await realpath(candidatePath);
          } catch {
            warnings.push(WARNINGS.nestedDirectory);
            continue;
          }

          if (
            candidateRealPath !== path.resolve(candidatePath) ||
            !isContained(rootRealPath, candidateRealPath)
          ) {
            continue;
          }

          await visit(candidateRealPath, relativePath);
          continue;
        }

        const extension = path.extname(directoryEntry.name).toLowerCase();
        if (!candidateStats.isFile() || !TRACE_EXTENSIONS.has(extension)) {
          continue;
        }

        const trace = await inspectTraceFile(
          rootRealPath,
          candidatePath,
          relativePath,
        );
        if (trace) {
          traces.push(trace);
        }
      }
    } catch {
      if (rootDirectory) {
        throw rootUnavailable();
      }
      warnings.push(WARNINGS.nestedDirectory);
    }
  }

  await visit(rootRealPath, "", true);
  traces.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
  return { traces, warnings };
}

async function readOpenedText(fileHandle, byteLength) {
  const buffer = Buffer.alloc(byteLength);
  let bytesRead = 0;

  while (bytesRead < buffer.length) {
    const result = await fileHandle.read(
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      bytesRead,
    );
    if (result.bytesRead === 0) {
      break;
    }
    bytesRead += result.bytesRead;
  }

  return buffer.subarray(0, bytesRead).toString("utf8");
}

function parseManifest(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return emptyManifest([WARNINGS.manifestMalformed]);
  }

  if (!plainObject(parsed)) {
    return emptyManifest([WARNINGS.manifestMalformed]);
  }
  if (parsed.schema_version !== 1) {
    return emptyManifest([WARNINGS.manifestSchema]);
  }
  if (!plainObject(parsed.traces)) {
    return emptyManifest([WARNINGS.manifestShape]);
  }

  const warnings = [];
  const entries = [];
  for (const [relativePath, metadata] of Object.entries(parsed.traces)) {
    if (!plainObject(metadata)) {
      warnings.push(WARNINGS.metadataShape);
      continue;
    }
    entries.push([relativePath, metadata]);
  }

  return {
    rootLabel:
      typeof parsed.root_label === "string" && parsed.root_label.trim()
        ? parsed.root_label.trim()
        : undefined,
    traces: Object.fromEntries(entries),
    warnings,
  };
}

async function readManifestFromResolvedRoot(rootRealPath, hooks = {}) {
  const manifestPath = path.join(rootRealPath, MANIFEST_NAME);
  let fileHandle;

  try {
    await hooks.beforeManifestOpen?.();
  } catch {
    return emptyManifest([WARNINGS.manifestAccess]);
  }

  try {
    fileHandle = await openNoFollow(manifestPath);
  } catch (error) {
    return error?.code === "ENOENT"
      ? emptyManifest()
      : emptyManifest([WARNINGS.manifestAccess]);
  }

  try {
    const handleStats = await fileHandle.stat({ bigint: true });
    if (!handleStats.isFile()) {
      return emptyManifest([WARNINGS.manifestNotRegular]);
    }
    if (handleStats.size > BigInt(MANIFEST_MAX_BYTES)) {
      return emptyManifest([WARNINGS.manifestOversized]);
    }

    const manifestRealPath = await realpath(manifestPath);
    if (
      manifestRealPath !== path.resolve(manifestPath) ||
      !isContained(rootRealPath, manifestRealPath)
    ) {
      return emptyManifest([WARNINGS.manifestIdentity]);
    }

    const pathStats = await stat(manifestRealPath, { bigint: true });
    if (!pathStats.isFile() || !sameIdentity(handleStats, pathStats)) {
      return emptyManifest([WARNINGS.manifestIdentity]);
    }

    await hooks.afterManifestOpen?.({ fileHandle });
    const source = await readOpenedText(fileHandle, Number(handleStats.size));
    return parseManifest(source);
  } catch {
    return emptyManifest([WARNINGS.manifestAccess]);
  } finally {
    await fileHandle.close().catch(() => {});
  }
}

/**
 * Read the optional root-level metadata overlay.
 *
 * Metadata is keyed by normalized, root-relative POSIX path:
 * `{ "traces": { "nested/model.jsonl": { "label": "Model" } } }`.
 * It can enrich discovered records, but never creates or redirects files.
 */
export async function readManifest(root, { hooks = {} } = {}) {
  const rootInfo = await resolveTraceRoot(root);
  return readManifestFromResolvedRoot(rootInfo.realPath, hooks);
}

export async function discoverTraceFiles(root, { hooks = {} } = {}) {
  const rootInfo = await resolveTraceRoot(root);
  return (await discoverFromResolvedRoot(rootInfo.realPath, hooks)).traces;
}

export function stableTraceId(relativePath) {
  return createHash("sha256")
    .update(normalizeRelativePath(relativePath))
    .digest("hex")
    .slice(0, 24);
}

export function isContained(rootRealPath, candidateRealPath) {
  const relativePath = path.relative(rootRealPath, candidateRealPath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function publicTrace(entry, fileStats) {
  const {
    realPath: _realPath,
    rootRealPath: _rootRealPath,
    device: _device,
    inode: _inode,
    ...trace
  } = entry;

  if (fileStats) {
    trace.size = Number(fileStats.size);
    trace.modifiedTime = fileStats.mtime.toISOString();
  }
  return trace;
}

export class TraceRegistry {
  constructor(root, { hooks = {} } = {}) {
    if (typeof root !== "string" || root.trim() === "") {
      throw new TypeError("Trace root must be a non-empty filesystem path.");
    }

    this.root = path.resolve(root);
    this.rootRealPath = undefined;
    this.rootDevice = undefined;
    this.rootInode = undefined;
    this.entries = new Map();
    this.hooks = hooks;
    this.refreshGeneration = 0;
    this.committedRefreshGeneration = 0;
  }

  async refresh() {
    const generation = ++this.refreshGeneration;
    const rootInfo = await resolveTraceRoot(this.root);
    const [discovery, manifest] = await Promise.all([
      discoverFromResolvedRoot(rootInfo.realPath, this.hooks),
      readManifestFromResolvedRoot(rootInfo.realPath, this.hooks),
    ]);
    const entries = new Map();
    const traces = [];

    for (const discoveredEntry of discovery.traces) {
      const metadata = Object.hasOwn(
        manifest.traces,
        discoveredEntry.relativePath,
      )
        ? manifest.traces[discoveredEntry.relativePath]
        : undefined;
      const {
        realPath: _manifestRealPath,
        rootRealPath: _manifestRootRealPath,
        device: _manifestDevice,
        inode: _manifestInode,
        id: _manifestId,
        relativePath: _manifestRelativePath,
        name: _manifestName,
        size: _manifestSize,
        modifiedTime: _manifestModifiedTime,
        extension: _manifestExtension,
        ...displayMetadata
      } = plainObject(metadata) ? metadata : {};

      const {
        realPath,
        device,
        inode,
        id,
        relativePath,
        name,
        size,
        modifiedTime,
        extension,
      } = discoveredEntry;
      const publicEntry = {
        ...displayMetadata,
        id,
        relativePath,
        name,
        size,
        modifiedTime,
        extension,
      };
      const privateEntry = {
        ...publicEntry,
        realPath,
        rootRealPath: rootInfo.realPath,
        device,
        inode,
      };

      if (entries.has(id)) {
        throw new TraceRegistryError(
          "A trace ID collision prevented registry refresh.",
          { code: "TRACE_ID_COLLISION" },
        );
      }

      entries.set(id, privateEntry);
      traces.push(publicEntry);
    }

    const payload = {
      schemaVersion: 1,
      rootLabel: manifest.rootLabel ?? path.basename(rootInfo.realPath),
      traces,
      warnings: [...discovery.warnings, ...manifest.warnings],
    };
    await this.hooks.beforeRefreshCommit?.({ generation, payload });

    if (generation > this.committedRefreshGeneration) {
      this.rootRealPath = rootInfo.realPath;
      this.rootDevice = rootInfo.device;
      this.rootInode = rootInfo.inode;
      this.entries = entries;
      this.committedRefreshGeneration = generation;
    }

    return payload;
  }

  get(id) {
    return typeof id === "string" ? this.entries.get(id) : undefined;
  }

  /**
   * Open and validate a registered trace atomically.
   *
   * On success, ownership of `fileHandle` transfers to the caller. Stream from
   * that handle (for example, `fileHandle.createReadStream()`) and close it;
   * never reopen `trace.relativePath` or the private registry path.
   */
  async open(id) {
    const entry = this.get(id);
    if (!entry || !this.rootRealPath) {
      return undefined;
    }

    let fileHandle;
    let transferred = false;
    try {
      const currentRootRealPath = await realpath(this.root);
      if (currentRootRealPath !== this.rootRealPath) {
        return undefined;
      }

      const currentRootStats = await stat(currentRootRealPath, { bigint: true });
      if (
        !currentRootStats.isDirectory() ||
        currentRootStats.dev !== this.rootDevice ||
        currentRootStats.ino !== this.rootInode
      ) {
        return undefined;
      }

      const candidatePath = path.resolve(
        currentRootRealPath,
        ...entry.relativePath.split("/"),
      );
      if (!isContained(currentRootRealPath, candidatePath)) {
        return undefined;
      }

      fileHandle = await openNoFollow(candidatePath);
      const handleStats = await fileHandle.stat({ bigint: true });
      await this.hooks.afterTraceOpen?.({
        fileHandle,
        relativePath: entry.relativePath,
      });

      if (
        !handleStats.isFile() ||
        handleStats.dev !== entry.device ||
        handleStats.ino !== entry.inode
      ) {
        return undefined;
      }

      const candidateRealPath = await realpath(candidatePath);
      if (
        candidateRealPath !== path.resolve(candidatePath) ||
        candidateRealPath !== entry.realPath ||
        !isContained(currentRootRealPath, candidateRealPath)
      ) {
        return undefined;
      }

      const pathStats = await stat(candidateRealPath, { bigint: true });
      if (!pathStats.isFile() || !sameIdentity(handleStats, pathStats)) {
        return undefined;
      }

      transferred = true;
      return {
        fileHandle,
        trace: publicTrace(entry, handleStats),
      };
    } catch {
      return undefined;
    } finally {
      if (fileHandle && !transferred) {
        await fileHandle.close().catch(() => {});
      }
    }
  }
}
