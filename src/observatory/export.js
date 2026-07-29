const RECORDING_MIME_TYPES = Object.freeze([
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1.4D401F",
]);
const EXPORT_EXTENSIONS = new Set(["png", "mp4"]);
const X_VIDEO_WIDTH = 1_280;
const X_VIDEO_HEIGHT = 720;
const X_VIDEO_FRAME_RATE = 30;
const X_VIDEO_BIT_RATE = 8_000_000;

function exportTimestamp(now) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError("Export time must be a valid Date.");
  }
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}

function safeLabel(value) {
  const label =
    typeof value === "string"
      ? value
          .normalize("NFKD")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80)
      : "";
  return label || "trace";
}

function defaultCreateObjectUrl(blob) {
  if (typeof globalThis.URL?.createObjectURL !== "function") {
    throw new Error("This browser cannot create local export URLs.");
  }
  return globalThis.URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url) {
  globalThis.URL?.revokeObjectURL?.(url);
}

function defaultRecordingCanvasFactory({
  documentObject,
  height,
  width,
}) {
  if (typeof documentObject?.createElement !== "function") {
    throw new Error("A browser canvas is required for MP4 recording.");
  }
  const recordingCanvas = documentObject.createElement("canvas");
  recordingCanvas.width = width;
  recordingCanvas.height = height;
  return recordingCanvas;
}

function drawLetterboxedFrame(sourceCanvas, recordingCanvas, context) {
  const sourceWidth = Number(sourceCanvas?.width);
  const sourceHeight = Number(sourceCanvas?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error("The Observatory canvas has no drawable frame.");
  }
  const scale = Math.min(
    recordingCanvas.width / sourceWidth,
    recordingCanvas.height / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (recordingCanvas.width - width) / 2;
  const y = (recordingCanvas.height - height) / 2;
  context.fillStyle = "#050608";
  context.fillRect(0, 0, recordingCanvas.width, recordingCanvas.height);
  context.drawImage(sourceCanvas, x, y, width, height);
}

function downloadBlob(
  blob,
  filename,
  {
    documentObject = globalThis.document,
    createObjectURL = defaultCreateObjectUrl,
    revokeObjectURL = defaultRevokeObjectUrl,
  } = {},
) {
  if (!documentObject?.body || typeof documentObject.createElement !== "function") {
    throw new Error("A browser document is required to download exports.");
  }
  const url = createObjectURL(blob);
  const anchor = documentObject.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  try {
    documentObject.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    revokeObjectURL(url);
  }
  return Object.freeze({ blob, filename });
}

export function selectRecordingMimeType(
  MediaRecorderClass = globalThis.MediaRecorder,
) {
  if (typeof MediaRecorderClass?.isTypeSupported !== "function") return null;
  for (const mimeType of RECORDING_MIME_TYPES) {
    try {
      if (MediaRecorderClass.isTypeSupported(mimeType)) return mimeType;
    } catch {
      return null;
    }
  }
  return null;
}

export function observatoryExportFilename(
  label,
  extension,
  now = new Date(),
) {
  const normalizedExtension =
    typeof extension === "string"
      ? extension.toLowerCase().replace(/^\.+/, "")
      : "";
  if (!EXPORT_EXTENSIONS.has(normalizedExtension)) {
    throw new TypeError("Observatory exports must use PNG or MP4.");
  }
  return `silicon-observatory-${safeLabel(label)}-${exportTimestamp(now)}.${normalizedExtension}`;
}

export function downloadCanvasPng(
  canvas,
  {
    label = "trace",
    now = new Date(),
    documentObject = globalThis.document,
    createObjectURL = defaultCreateObjectUrl,
    revokeObjectURL = defaultRevokeObjectUrl,
  } = {},
) {
  if (typeof canvas?.toBlob !== "function") {
    return Promise.reject(
      new Error("This canvas cannot produce a PNG snapshot."),
    );
  }
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!(blob instanceof Blob) || blob.size === 0) {
          reject(new Error("The canvas returned an empty PNG snapshot."));
          return;
        }
        try {
          resolve(
            downloadBlob(
              blob,
              observatoryExportFilename(label, "png", now),
              { createObjectURL, documentObject, revokeObjectURL },
            ),
          );
        } catch (error) {
          reject(error);
        }
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

export function createCanvasRecorder(
  canvas,
  {
    label = "trace",
    now = () => new Date(),
    MediaRecorderClass = globalThis.MediaRecorder,
    onError,
    documentObject = globalThis.document,
    recordingCanvasFactory = defaultRecordingCanvasFactory,
    requestAnimationFrameImpl = globalThis.requestAnimationFrame,
    cancelAnimationFrameImpl = globalThis.cancelAnimationFrame,
    createObjectURL = defaultCreateObjectUrl,
    revokeObjectURL = defaultRevokeObjectUrl,
  } = {},
) {
  const mimeType = selectRecordingMimeType(MediaRecorderClass);
  const supported =
    typeof MediaRecorderClass === "function" &&
    typeof recordingCanvasFactory === "function" &&
    mimeType !== null;
  let recorder = null;
  let stream = null;
  let recordingCanvas = null;
  let recordingContext = null;
  let mirrorAnimationFrame = null;
  let chunks = [];
  let destroyed = false;
  let stopPromise = null;
  let stopResolve = null;
  let stopReject = null;

  const stopTracks = () => {
    for (const track of stream?.getTracks?.() ?? []) track.stop?.();
    stream = null;
  };

  const stopMirror = () => {
    if (
      mirrorAnimationFrame !== null &&
      typeof cancelAnimationFrameImpl === "function"
    ) {
      cancelAnimationFrameImpl(mirrorAnimationFrame);
    }
    mirrorAnimationFrame = null;
  };

  const reset = () => {
    stopMirror();
    stopTracks();
    recorder = null;
    recordingCanvas = null;
    recordingContext = null;
    chunks = [];
  };

  const drawFrame = () => {
    drawLetterboxedFrame(canvas, recordingCanvas, recordingContext);
  };

  const mirrorFrame = () => {
    mirrorAnimationFrame = null;
    if (!api.recording) return;
    drawFrame();
    if (typeof requestAnimationFrameImpl === "function") {
      mirrorAnimationFrame = requestAnimationFrameImpl(mirrorFrame);
    }
  };

  const api = {
    supported,
    get recording() {
      return recorder?.state === "recording";
    },
    start() {
      if (!supported) {
        throw new Error(
          "H.264 MP4 recording is not supported in this browser.",
        );
      }
      if (destroyed) {
        throw new Error("This recorder has been destroyed.");
      }
      if (api.recording) {
        throw new Error("The Observatory is already recording.");
      }

      try {
        recordingCanvas = recordingCanvasFactory({
          documentObject,
          height: X_VIDEO_HEIGHT,
          width: X_VIDEO_WIDTH,
        });
        recordingCanvas.width = X_VIDEO_WIDTH;
        recordingCanvas.height = X_VIDEO_HEIGHT;
        recordingContext = recordingCanvas.getContext?.("2d", {
          alpha: false,
        });
        if (
          !recordingContext ||
          typeof recordingCanvas.captureStream !== "function"
        ) {
          throw new Error("This browser cannot prepare an MP4 export canvas.");
        }
        drawFrame();
        stream = recordingCanvas.captureStream(X_VIDEO_FRAME_RATE);
        recorder = new MediaRecorderClass(stream, {
          mimeType,
          videoBitsPerSecond: X_VIDEO_BIT_RATE,
        });
        chunks = [];
        recorder.addEventListener("dataavailable", (event) => {
          if (event?.data instanceof Blob && event.data.size > 0) {
            chunks.push(event.data);
          }
        });
        recorder.addEventListener("error", (event) => {
          const error =
            event?.error instanceof Error
              ? event.error
              : new Error("The browser stopped recording unexpectedly.");
          stopReject?.(error);
          stopResolve = null;
          stopReject = null;
          stopPromise = null;
          reset();
          if (typeof onError === "function") {
            try {
              onError(error);
            } catch {
              // A UI notification must not keep media resources alive.
            }
          }
        });
        recorder.addEventListener("stop", () => {
          try {
            if (destroyed) {
              stopResolve?.(null);
            } else {
              const blob = new Blob(chunks, { type: mimeType });
              if (blob.size === 0) {
                throw new Error(
                  "The browser returned an empty MP4 recording.",
                );
              }
              const currentTime = typeof now === "function" ? now() : now;
              const currentLabel =
                typeof label === "function" ? label() : label;
              stopResolve?.(
                downloadBlob(
                  blob,
                  observatoryExportFilename(
                    currentLabel,
                    "mp4",
                    currentTime,
                  ),
                  { createObjectURL, documentObject, revokeObjectURL },
                ),
              );
            }
          } catch (error) {
            stopReject?.(error);
          } finally {
            stopResolve = null;
            stopReject = null;
            stopPromise = null;
            reset();
          }
        });
        recorder.start();
        if (typeof requestAnimationFrameImpl === "function") {
          mirrorAnimationFrame = requestAnimationFrameImpl(mirrorFrame);
        }
      } catch (error) {
        reset();
        throw error;
      }
    },
    stop() {
      if (stopPromise) return stopPromise;
      if (!api.recording) {
        return Promise.reject(
          new Error("The Observatory is not recording."),
        );
      }
      stopPromise = new Promise((resolve, reject) => {
        stopResolve = resolve;
        stopReject = reject;
      });
      const pendingStop = stopPromise;
      try {
        recorder.stop();
      } catch (error) {
        stopReject(error);
        stopResolve = null;
        stopReject = null;
        stopPromise = null;
        reset();
        return Promise.reject(error);
      }
      return pendingStop;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (api.recording) {
        void api.stop().catch(() => {});
      } else {
        reset();
      }
    },
  };
  return Object.freeze(api);
}
