import { constants } from "node:fs";
import {
  lstat,
  open,
  opendir,
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

const TRACE_EXTENSIONS = new Set([".jsonl", ".ndjson"]);
const SHOWCASE_PREFIX = "traces/showcase/";
const LOCAL_ASSET_EXTENSIONS = new Set([".js", ".css"]);
const VITE_DATASET_WORKER =
  /^assets\/dataset-worker-[A-Za-z0-9_-]{8,}\.js$/;
const VITE_INDEX_BUNDLE =
  /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;

function resolvedPath(value, label) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty filesystem path.`);
  }
  return path.resolve(value);
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sameMetadata(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function isSupportedTracePath(relativePath) {
  return TRACE_EXTENSIONS.has(
    path.posix.extname(relativePath).toLowerCase(),
  );
}

function assertSafeTracePath(value, label) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value
      .split("/")
      .some(
        (segment) =>
          segment === "" || segment === "." || segment === "..",
      ) ||
    !isSupportedTracePath(value)
  ) {
    throw new TypeError(
      `${label} must be a safe relative POSIX trace path.`,
    );
  }
}

async function readRegularFile(
  filePath,
  label,
  {
    afterOpen,
    expectedStats,
    manifest = false,
    retainContents = false,
  } = {},
) {
  let before;
  try {
    before = await lstat(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        manifest
          ? `${label} must be a regular non-symlink file.`
          : `${label} must be a regular file.`,
      );
    }
    throw error;
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(
      manifest
        ? `${label} must be a regular non-symlink file.`
        : `${label} must be a regular file.`,
    );
  }
  if (expectedStats !== undefined && !sameMetadata(expectedStats, before)) {
    throw new Error(`${label} changed after artifact enumeration.`);
  }

  const noFollow =
    typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollow);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameMetadata(before, opened)) {
      throw new Error(`${label} changed while it was being verified.`);
    }
    await afterOpen?.();
    let contents;
    if (retainContents) {
      contents = await handle.readFile("utf8");
    } else {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      while (
        (await handle.read(buffer, 0, buffer.length, null)).bytesRead > 0
      ) {
        // Consume the complete file without retaining its contents.
      }
    }
    const openedAfterRead = await handle.stat({ bigint: true });
    if (!openedAfterRead.isFile() || !sameMetadata(opened, openedAfterRead)) {
      throw new Error(`${label} changed while it was being verified.`);
    }
    const pathAfterRead = await lstat(filePath, { bigint: true });
    if (
      pathAfterRead.isSymbolicLink() ||
      !pathAfterRead.isFile() ||
      !sameMetadata(openedAfterRead, pathAfterRead)
    ) {
      throw new Error(`${label} changed while it was being verified.`);
    }
    return contents;
  } catch (error) {
    if (error?.message?.startsWith(label)) throw error;
    throw new Error(`${label} could not be opened without following links.`, {
      cause: error,
    });
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseJsonObject(source, label) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`${label} must contain valid JSON: ${error.message}`);
  }
  if (!plainObject(parsed)) {
    throw new TypeError(`${label} must contain a JSON object.`);
  }
  return parsed;
}

async function assertClientRoot(clientRoot) {
  let stats;
  try {
    stats = await lstat(clientRoot);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "client root must be a regular non-symlink directory.",
      );
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      "client root must be a regular non-symlink directory.",
    );
  }
}

async function collectArtifactFiles(clientRoot) {
  const directories = new Map();
  const files = [];

  async function visit(
    directoryPath,
    relativeDirectory = "",
    capturedStats,
  ) {
    const directoryStats =
      capturedStats ?? (await lstat(directoryPath, { bigint: true }));
    if (
      directoryStats.isSymbolicLink() ||
      !directoryStats.isDirectory()
    ) {
      throw new Error(
        `Pages artifact directory ${relativeDirectory || "."} must be a regular non-symlink directory.`,
      );
    }
    directories.set(relativeDirectory, directoryStats);
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const candidate = path.join(
        clientRoot,
        ...relativePath.split("/"),
      );
      const stats = await lstat(candidate, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Pages artifact must not contain symbolic links: ${relativePath}`,
        );
      }
      if (stats.isDirectory()) {
        await visit(candidate, relativePath, stats);
      } else if (stats.isFile()) {
        files.push(Object.freeze({ relativePath, stats }));
      } else {
        throw new Error(
          `Pages artifact entries must be regular files or directories: ${relativePath}`,
        );
      }
    }
  }

  await visit(clientRoot);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  return Object.freeze({ directories, files });
}

async function assertArtifactAncestors(
  clientRoot,
  relativePath,
  directorySnapshots,
) {
  const segments = relativePath.split("/");
  for (let depth = 0; depth < segments.length; depth += 1) {
    const relativeDirectory = segments.slice(0, depth).join("/");
    const displayName = relativeDirectory || "client root";
    const directoryPath =
      relativeDirectory === ""
        ? clientRoot
        : path.join(clientRoot, ...relativeDirectory.split("/"));
    let current;
    try {
      current = await lstat(directoryPath, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `artifact directory ${displayName} changed after artifact enumeration.`,
        );
      }
      throw error;
    }
    if (current.isSymbolicLink() || !current.isDirectory()) {
      throw new Error(
        `artifact directory ${displayName} must remain a regular non-symlink directory.`,
      );
    }
    const captured = directorySnapshots.get(relativeDirectory);
    if (captured === undefined || !sameMetadata(captured, current)) {
      throw new Error(
        `artifact directory ${displayName} changed after artifact enumeration.`,
      );
    }
  }
}

function assertSameMembers(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
    );
  }
}

function localAssetPath(reference) {
  const trimmed = reference.trim();
  if (trimmed === "" || trimmed.startsWith("//")) return null;

  let url;
  try {
    url = new URL(trimmed, "https://pages-artifact.invalid/index.html");
  } catch {
    return null;
  }
  if (url.origin !== "https://pages-artifact.invalid") return null;

  const rawPath = trimmed.split(/[?#]/, 1)[0];
  let decodedRaw;
  let decodedPath;
  try {
    decodedRaw = decodeURIComponent(rawPath);
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new TypeError(
      `index.html contains an invalid local asset reference: ${reference}`,
    );
  }
  if (
    decodedRaw.includes("\\") ||
    decodedRaw.includes("\0") ||
    decodedRaw.split("/").some((segment) => segment === "..")
  ) {
    throw new TypeError(
      `index.html contains an unsafe local asset reference: ${reference}`,
    );
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  if (
    relativePath === "" ||
    relativePath
      .split("/")
      .some(
        (segment) =>
          segment === "" || segment === "." || segment === "..",
      )
  ) {
    throw new TypeError(
      `index.html contains an unsafe local asset reference: ${reference}`,
    );
  }
  return relativePath;
}

async function verifyIndexAssets(indexSource, artifactFiles) {
  const localAssets = new Set();
  let hasModuleJavaScript = false;
  let hasStylesheet = false;
  const uncommentedIndex = indexSource.replace(
    /<!--[\s\S]*?(?:-->|$)/g,
    "",
  );
  for (const tag of uncommentedIndex.matchAll(
    /<([A-Za-z][A-Za-z0-9:-]*)\b[^>]*>/g,
  )) {
    const tagName = tag[1].toLowerCase();
    const attributes = new Map();
    for (const attribute of tag[0].matchAll(
      /\s([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
    )) {
      attributes.set(
        attribute[1].toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
      );
    }
    for (const attributeName of ["src", "href"]) {
      if (!attributes.has(attributeName)) continue;
      const reference = attributes.get(attributeName);
      const rootRelative =
        reference.trim().startsWith("/") &&
        !reference.trim().startsWith("//");
      const relativePath = localAssetPath(reference);
      if (
        relativePath !== null &&
        LOCAL_ASSET_EXTENSIONS.has(
          path.posix.extname(relativePath).toLowerCase(),
        )
      ) {
        if (rootRelative) {
          throw new Error(
            `local bundle reference must be relative for project Pages: ${reference}`,
          );
        }
        if (!VITE_INDEX_BUNDLE.test(relativePath)) {
          throw new Error(
            `index-referenced local bundle must use a Vite-hashed filename with at least eight safe hash characters: ${relativePath}`,
          );
        }
        localAssets.add(relativePath);
        const extension = path.posix.extname(relativePath).toLowerCase();
        if (
          tagName === "script" &&
          attributeName === "src" &&
          extension === ".js" &&
          attributes.get("type")?.toLowerCase() === "module"
        ) {
          hasModuleJavaScript = true;
        }
        if (
          tagName === "link" &&
          attributeName === "href" &&
          extension === ".css" &&
          attributes
            .get("rel")
            ?.toLowerCase()
            .split(/\s+/)
            .includes("stylesheet")
        ) {
          hasStylesheet = true;
        }
      }
    }
  }
  if (!hasModuleJavaScript) {
    throw new Error(
      "index.html must reference at least one hashed local module JavaScript bundle.",
    );
  }
  if (!hasStylesheet) {
    throw new Error(
      "index.html must reference at least one hashed local stylesheet bundle.",
    );
  }
  for (const relativePath of localAssets) {
    if (!artifactFiles.has(relativePath)) {
      throw new Error(
        `index-referenced asset ${relativePath} must be a regular file.`,
      );
    }
  }
}

export async function verifyPagesArtifact({
  clientRoot = "dist/client",
  hooks = {},
  manifestPath = "traces/showcase/traces.json",
} = {}) {
  const resolvedClient = resolvedPath(clientRoot, "clientRoot");
  const resolvedManifest = resolvedPath(manifestPath, "manifestPath");
  await assertClientRoot(resolvedClient);

  const artifactSnapshot = await collectArtifactFiles(resolvedClient);
  await hooks.afterArtifactEnumeration?.();
  const artifactEntries = artifactSnapshot.files;
  const artifactPaths = artifactEntries.map(({ relativePath }) => relativePath);
  const artifactFiles = new Set(artifactPaths);
  for (const required of ["index.html", "hosted-traces.json"]) {
    if (!artifactFiles.has(required)) {
      throw new Error(`${required} must be a regular file.`);
    }
  }
  const workerCandidates = artifactPaths.filter((relativePath) =>
    /^assets\/dataset-worker.*\.js$/.test(relativePath),
  );
  if (
    workerCandidates.length === 0 ||
    workerCandidates.some(
      (relativePath) => !VITE_DATASET_WORKER.test(relativePath),
    )
  ) {
    throw new Error(
      "Pages artifact requires at least one bundled Vite-hashed assets/dataset-worker-*.js regular file with at least eight safe hash characters, and every dataset worker must match that shape.",
    );
  }

  const artifactSources = new Map();
  for (const entry of artifactEntries) {
    const filePath = path.join(
      resolvedClient,
      ...entry.relativePath.split("/"),
    );
    await assertArtifactAncestors(
      resolvedClient,
      entry.relativePath,
      artifactSnapshot.directories,
    );
    let source;
    try {
      source = await readRegularFile(filePath, entry.relativePath, {
        expectedStats: entry.stats,
        retainContents:
          entry.relativePath === "index.html" ||
          entry.relativePath === "hosted-traces.json",
        afterOpen: () =>
          hooks.afterArtifactFileOpen?.({
            filePath,
            relativePath: entry.relativePath,
          }),
      });
    } finally {
      await assertArtifactAncestors(
        resolvedClient,
        entry.relativePath,
        artifactSnapshot.directories,
      );
    }
    if (source !== undefined) {
      artifactSources.set(entry.relativePath, source);
    }
  }

  const indexSource = artifactSources.get("index.html");
  await verifyIndexAssets(indexSource, artifactFiles);

  const manifest = parseJsonObject(
    await readRegularFile(
      resolvedManifest,
      "source manifest",
      { manifest: true, retainContents: true },
    ),
    "source manifest",
  );
  const registry = parseJsonObject(
    artifactSources.get("hosted-traces.json"),
    "hosted registry",
  );
  if (
    manifest.schema_version !== 1 ||
    !plainObject(manifest.traces)
  ) {
    throw new TypeError(
      "source manifest must contain schema_version 1 and a traces object.",
    );
  }
  if (!Array.isArray(registry.traces)) {
    throw new TypeError("hosted registry traces must be an array.");
  }
  if (
    registry.schemaVersion !== manifest.schema_version ||
    registry.rootLabel !== manifest.root_label
  ) {
    throw new Error(
      "hosted registry metadata does not match the source manifest.",
    );
  }

  const expected = Object.entries(manifest.traces)
    .map(([relativePath, metadata]) => {
      assertSafeTracePath(relativePath, "manifest trace path");
      if (!plainObject(metadata)) {
        throw new TypeError(
          `manifest trace metadata must be an object: ${relativePath}`,
        );
      }
      return relativePath;
    })
    .sort();
  const registered = registry.traces
    .map((trace, index) => {
      if (!plainObject(trace)) {
        throw new TypeError(`hosted registry trace ${index} must be an object.`);
      }
      assertSafeTracePath(
        trace.relativePath,
        `registry trace ${index} relativePath`,
      );
      return trace.relativePath;
    })
    .sort();
  assertSameMembers(
    registered,
    expected,
    "hosted registry does not exactly match the source manifest",
  );

  const emitted = [];
  for (const relativePath of artifactPaths) {
    if (relativePath.startsWith(SHOWCASE_PREFIX)) {
      const showcasePath = relativePath.slice(SHOWCASE_PREFIX.length);
      if (!isSupportedTracePath(showcasePath)) {
        throw new Error(
          `traces/showcase must contain only registered trace files: ${showcasePath}`,
        );
      }
      emitted.push(showcasePath);
    } else if (isSupportedTracePath(relativePath)) {
      throw new Error(
        `supported trace files must only appear under traces/showcase: ${relativePath}`,
      );
    }
  }
  emitted.sort();
  assertSameMembers(
    emitted,
    expected,
    "emitted trace files do not exactly match the source manifest",
  );

  return Object.freeze({ traceCount: expected.length });
}

function isMainModule() {
  return (
    typeof process.argv[1] === "string" &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  const result = await verifyPagesArtifact({
    clientRoot: process.argv[2] ?? "dist/client",
    manifestPath:
      process.argv[3] ?? "traces/showcase/traces.json",
  });
  console.log(
    `Verified Pages artifact with ${result.traceCount} traces.`,
  );
}
