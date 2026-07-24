const MAX_FILENAME_LENGTH = 200;
const FILENAME_SEGMENT = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const CONTRIBUTOR_SEGMENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const HUGGING_FACE_SEGMENT =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const CAPTURE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})t(\d{2})-(\d{2})-(\d{2})z$/;
const ARTIFACT = /^(?:raw|window-cb[1-9]\d*)$/;

export const LEGACY_SHOWCASE_FILENAMES = Object.freeze([
  "glm52-q1t-t158-mtp-k3.jsonl",
  "hy3-oq2e-mtp-k2.jsonl",
  "laguna-s21-oq4e-ar.jsonl",
  "qwen36-27b-mtp-k3.jsonl",
  "qwen36-35b-a3b-k1.jsonl",
]);

function hasAmbiguousPunctuation(value) {
  return value.includes("..") || value.includes("--");
}

function validFilenameSegment(value, pattern) {
  return (
    pattern.test(value) &&
    !hasAmbiguousPunctuation(value) &&
    !value.includes("_")
  );
}

function parseCaptureTimestamp(value) {
  const match = CAPTURE_TIMESTAMP.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const milliseconds = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const captureUtc = new Date(milliseconds).toISOString().replace(".000", "");
  const normalized = captureUtc
    .replace("T", "t")
    .replaceAll(":", "-")
    .replace("Z", "z");
  return normalized === value ? captureUtc : null;
}

function parseFilenameShape(filename) {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename.length > MAX_FILENAME_LENGTH ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    return null;
  }

  const extensionMatch = /\.(jsonl|ndjson)$/.exec(filename);
  if (!extensionMatch) return null;
  const extension = `.${extensionMatch[1]}`;
  const withoutExtension = filename.slice(0, -extension.length);
  const artifactSeparator = withoutExtension.lastIndexOf(".");
  if (artifactSeparator < 0) return null;
  const artifact = withoutExtension.slice(artifactSeparator + 1);
  if (!ARTIFACT.test(artifact)) return null;

  const identity = withoutExtension.slice(0, artifactSeparator);
  const fields = identity.split("__");
  if (fields.length !== 3) return null;
  const [repositoryField, contributor, timestamp] = fields;
  const repositoryParts = repositoryField.split("--");
  if (repositoryParts.length !== 2) return null;
  const [ownerSlug, repositorySlug] = repositoryParts;

  if (
    !validFilenameSegment(ownerSlug, FILENAME_SEGMENT) ||
    !validFilenameSegment(repositorySlug, FILENAME_SEGMENT) ||
    !validFilenameSegment(contributor, CONTRIBUTOR_SEGMENT) ||
    contributor.length > 39
  ) {
    return null;
  }

  const captureUtc = parseCaptureTimestamp(timestamp);
  if (!captureUtc) return null;

  return {
    repositorySlug: `${ownerSlug}/${repositorySlug}`,
    contributor,
    captureUtc,
    artifact,
    extension,
  };
}

export function parseRunFilename(filename) {
  return parseFilenameShape(filename);
}

export function validateRunFilename(filename) {
  const errors = [];
  if (typeof filename !== "string" || filename.length === 0) {
    errors.push("Run filename must be a non-empty string.");
    return { valid: false, errors };
  }
  if (filename.length > MAX_FILENAME_LENGTH) {
    errors.push(
      `Run filename must be at most ${MAX_FILENAME_LENGTH} characters.`,
    );
  }
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    errors.push("Run filename must be a basename, not a filesystem path.");
  }
  if (!parseFilenameShape(filename)) {
    errors.push(
      "Expected <hf-owner>--<hf-repo>__<contributor>__<yyyy-mm-ddThh-mm-ssZ>.<raw|window-cbN>.<jsonl|ndjson> using lowercase ASCII slugs.",
    );
  }
  return { valid: errors.length === 0, errors };
}

export function huggingFaceRepoUrl(repositoryId) {
  if (typeof repositoryId !== "string" || repositoryId.length > 193) {
    return null;
  }
  const segments = repositoryId.split("/");
  if (
    segments.length !== 2 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > 96 ||
        !HUGGING_FACE_SEGMENT.test(segment) ||
        hasAmbiguousPunctuation(segment),
    )
  ) {
    return null;
  }
  return `https://huggingface.co/${segments.map(encodeURIComponent).join("/")}`;
}

