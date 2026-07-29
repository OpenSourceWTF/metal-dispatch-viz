import assert from "node:assert/strict";
import test from "node:test";

import {
  createCanvasRecorder,
  downloadCanvasPng,
  observatoryExportFilename,
  selectRecordingMimeType,
} from "../src/observatory/export.js";

function downloadHarness() {
  const clicked = [];
  const appended = [];
  const removed = [];
  const documentObject = {
    body: {
      append(node) {
        appended.push(node);
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "a");
      return {
        click() {
          clicked.push({ download: this.download, href: this.href });
        },
        remove() {
          removed.push(this);
        },
      };
    },
  };
  return { appended, clicked, documentObject, removed };
}

function xRecordingSurface(stream, { draws = [] } = {}) {
  return {
    width: 0,
    height: 0,
    getContext(type) {
      assert.equal(type, "2d");
      return {
        fillStyle: "",
        fillRect(...args) {
          draws.push(["fillRect", ...args]);
        },
        drawImage(...args) {
          draws.push(["drawImage", ...args]);
        },
      };
    },
    captureStream(rate) {
      assert.equal(rate, 30);
      assert.equal(this.width, 1280);
      assert.equal(this.height, 720);
      return stream;
    },
  };
}

test("recording MIME selection requires an X-compatible H.264 MP4", () => {
  assert.equal(selectRecordingMimeType({ isTypeSupported: () => false }), null);
  assert.equal(
    selectRecordingMimeType({
      isTypeSupported: (type) =>
        type === "video/mp4;codecs=avc1.42E01E",
    }),
    "video/mp4;codecs=avc1.42E01E",
  );
  assert.equal(
    selectRecordingMimeType({
      isTypeSupported: (type) => type === "video/webm;codecs=vp9",
    }),
    null,
  );
  assert.equal(selectRecordingMimeType(undefined), null);
});

test("export filenames are deterministic, local-safe, and UTC-stamped", () => {
  const now = new Date("2026-07-29T12:34:56.000Z");
  assert.equal(
    observatoryExportFilename("Qwen3.6 27B", "mp4", now),
    "silicon-observatory-qwen3-6-27b-20260729t123456z.mp4",
  );
  assert.equal(
    observatoryExportFilename("../../", ".PNG", now),
    "silicon-observatory-trace-20260729t123456z.png",
  );
  assert.throws(
    () => observatoryExportFilename("Qwen", "webm", now),
    /png or mp4/i,
  );
});

test("PNG snapshots download once and revoke their object URL", async () => {
  const downloads = downloadHarness();
  const created = [];
  const revoked = [];
  const blob = new Blob(["png"], { type: "image/png" });
  const canvas = {
    toBlob(callback, type) {
      assert.equal(type, "image/png");
      callback(blob);
    },
  };

  const result = await downloadCanvasPng(canvas, {
    label: "Qwen3.6 27B",
    now: new Date("2026-07-29T12:34:56.000Z"),
    documentObject: downloads.documentObject,
    createObjectURL(value) {
      created.push(value);
      return "blob:png";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  });

  assert.equal(result.filename, "silicon-observatory-qwen3-6-27b-20260729t123456z.png");
  assert.deepEqual(created, [blob]);
  assert.deepEqual(downloads.clicked, [
    {
      download:
        "silicon-observatory-qwen3-6-27b-20260729t123456z.png",
      href: "blob:png",
    },
  ]);
  assert.equal(downloads.appended.length, 1);
  assert.equal(downloads.removed.length, 1);
  assert.deepEqual(revoked, ["blob:png"]);
});

test("canvas recorder owns one H.264 MP4 lifecycle and releases media resources", async () => {
  const downloads = downloadHarness();
  const created = [];
  const revoked = [];
  const track = { stop: test.mock.fn() };
  const stream = { getTracks: () => [track] };
  const draws = [];
  const canvas = {
    width: 640,
    height: 640,
  };
  const recordingSurface = xRecordingSurface(stream, { draws });

  class FakeMediaRecorder {
    static isTypeSupported(type) {
      return type === "video/mp4;codecs=avc1.42E01E";
    }

    constructor(receivedStream, options) {
      assert.equal(receivedStream, stream);
      assert.deepEqual(options, {
        mimeType: "video/mp4;codecs=avc1.42E01E",
        videoBitsPerSecond: 8_000_000,
      });
      this.state = "inactive";
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      this.listeners.get("dataavailable")?.({
        data: new Blob(["mp4"], { type: "video/mp4" }),
      });
      this.listeners.get("stop")?.();
    }
  }

  const recorder = createCanvasRecorder(canvas, {
    label: "Qwen3.6 35B",
    now: () => new Date("2026-07-29T12:34:56.000Z"),
    MediaRecorderClass: FakeMediaRecorder,
    recordingCanvasFactory({ height, width }) {
      assert.deepEqual({ height, width }, { height: 720, width: 1280 });
      return recordingSurface;
    },
    documentObject: downloads.documentObject,
    createObjectURL(blob) {
      created.push(blob);
      return "blob:mp4";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  });

  assert.equal(recorder.supported, true);
  assert.equal(recorder.recording, false);
  recorder.start();
  assert.equal(recorder.recording, true);
  assert.deepEqual(draws.at(-1), [
    "drawImage",
    canvas,
    280,
    0,
    720,
    720,
  ]);
  assert.throws(() => recorder.start(), /already recording/i);
  const result = await recorder.stop();

  assert.equal(recorder.recording, false);
  assert.equal(
    result.filename,
    "silicon-observatory-qwen3-6-35b-20260729t123456z.mp4",
  );
  assert.equal(created.length, 1);
  assert.deepEqual(downloads.clicked, [
    {
      download:
        "silicon-observatory-qwen3-6-35b-20260729t123456z.mp4",
      href: "blob:mp4",
    },
  ]);
  assert.deepEqual(revoked, ["blob:mp4"]);
  assert.equal(track.stop.mock.callCount(), 1);
  recorder.destroy();
  recorder.destroy();
  assert.equal(track.stop.mock.callCount(), 1);
});

test("failed recording starts release every captured stream before retry", () => {
  const tracks = [];
  const canvas = { width: 640, height: 480 };
  const recordingCanvasFactory = () => {
    const track = { stop: test.mock.fn() };
    tracks.push(track);
    return xRecordingSurface({ getTracks: () => [track] });
  };

  class ThrowingMediaRecorder {
    static isTypeSupported(type) {
      return type === "video/mp4;codecs=avc1.42E01E";
    }

    constructor() {
      throw new Error("Encoder construction failed");
    }
  }

  const recorder = createCanvasRecorder(canvas, {
    MediaRecorderClass: ThrowingMediaRecorder,
    recordingCanvasFactory,
  });
  assert.throws(() => recorder.start(), /Encoder construction failed/i);
  assert.throws(() => recorder.start(), /Encoder construction failed/i);
  assert.equal(tracks.length, 2);
  assert.equal(tracks.every((track) => track.stop.mock.callCount() === 1), true);
  assert.equal(recorder.recording, false);
});

test("a MediaRecorder start exception also releases the captured stream", () => {
  const track = { stop: test.mock.fn() };

  class StartThrowingMediaRecorder {
    static isTypeSupported(type) {
      return type === "video/mp4;codecs=avc1.42E01E";
    }

    constructor() {
      this.state = "inactive";
    }

    addEventListener() {}

    start() {
      throw new Error("Encoder start failed");
    }
  }

  const recorder = createCanvasRecorder(
    { width: 640, height: 480 },
    {
      MediaRecorderClass: StartThrowingMediaRecorder,
      recordingCanvasFactory: () =>
        xRecordingSurface({ getTracks: () => [track] }),
    },
  );

  assert.throws(() => recorder.start(), /Encoder start failed/i);
  assert.equal(track.stop.mock.callCount(), 1);
  assert.equal(recorder.recording, false);
});

test("asynchronous recorder errors reset resources and report immediately", () => {
  const errors = [];
  const track = { stop: test.mock.fn() };
  let mediaRecorder;

  class FailingMediaRecorder {
    static isTypeSupported(type) {
      return type === "video/mp4;codecs=avc1.42E01E";
    }

    constructor() {
      this.state = "inactive";
      this.listeners = new Map();
      mediaRecorder = this;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      this.state = "recording";
    }
  }

  const recorder = createCanvasRecorder(
    { width: 640, height: 480 },
    {
      MediaRecorderClass: FailingMediaRecorder,
      recordingCanvasFactory: () =>
        xRecordingSurface({ getTracks: () => [track] }),
      onError(error) {
        errors.push(error);
      },
    },
  );

  recorder.start();
  mediaRecorder.state = "inactive";
  mediaRecorder.listeners.get("error")?.({
    error: new Error("Encoder crashed"),
  });

  assert.equal(recorder.recording, false);
  assert.equal(track.stop.mock.callCount(), 1);
  assert.deepEqual(errors.map((error) => error.message), ["Encoder crashed"]);
});

test("concurrent stop calls share one pending recording result", async () => {
  const downloads = downloadHarness();
  let mediaRecorder;

  class DeferredStopMediaRecorder {
    static isTypeSupported(type) {
      return type === "video/mp4;codecs=avc1.42E01E";
    }

    constructor() {
      this.state = "inactive";
      this.listeners = new Map();
      mediaRecorder = this;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
    }
  }

  const recorder = createCanvasRecorder(
    { width: 640, height: 480 },
    {
      MediaRecorderClass: DeferredStopMediaRecorder,
      recordingCanvasFactory: () =>
        xRecordingSurface({ getTracks: () => [{ stop() {} }] }),
      documentObject: downloads.documentObject,
      createObjectURL: () => "blob:deferred",
      revokeObjectURL() {},
    },
  );
  recorder.start();
  const first = recorder.stop();
  const second = recorder.stop();
  assert.equal(second, first);

  mediaRecorder.listeners.get("dataavailable")?.({
    data: new Blob(["mp4"], { type: "video/mp4" }),
  });
  mediaRecorder.listeners.get("stop")?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.filename, secondResult.filename);
});

test("unsupported recording stays inert while PNG can remain available", async () => {
  const recorder = createCanvasRecorder(
    { captureStream: undefined },
    { MediaRecorderClass: undefined },
  );
  assert.equal(recorder.supported, false);
  assert.equal(recorder.recording, false);
  assert.throws(() => recorder.start(), /not supported/i);
  await assert.rejects(recorder.stop(), /not recording/i);
  assert.doesNotThrow(() => recorder.destroy());
});
