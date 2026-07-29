export function shouldAnimateObservatory({
  active = true,
  reducedMotion = false,
  visible = true,
} = {}) {
  return active && visible && !reducedMotion;
}

export function observatoryFrameStride({
  frameCount,
  frameDelayMs,
  galleryDurationMs,
} = {}) {
  if (
    !Number.isFinite(frameCount) ||
    frameCount <= 1 ||
    !Number.isFinite(frameDelayMs) ||
    frameDelayMs <= 0 ||
    !Number.isFinite(galleryDurationMs) ||
    galleryDurationMs <= 0
  ) {
    return 1;
  }
  const framesPerGallery = Math.max(
    1,
    Math.floor(galleryDurationMs / frameDelayMs),
  );
  return Math.max(1, Math.ceil(frameCount / framesPerGallery));
}

export function observatoryPixelRatio({
  devicePixelRatio = 1,
  width,
  height,
} = {}) {
  const safeDeviceRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const portrait = safeHeight > safeWidth;
  const maximumWidth = portrait ? 1_080 : 1_920;
  const maximumHeight = portrait ? 1_920 : 1_200;
  return Math.min(
    safeDeviceRatio,
    2,
    maximumWidth / safeWidth,
    maximumHeight / safeHeight,
  );
}

export function nextObservatoryFrameIndex({
  current,
  frameCount,
  stride = 1,
} = {}) {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) return 0;
  const safeCurrent = Number.isSafeInteger(current)
    ? Math.min(frameCount - 1, Math.max(0, current))
    : 0;
  const safeStride =
    Number.isSafeInteger(stride) && stride > 0 ? stride : 1;
  return Math.min(frameCount - 1, safeCurrent + safeStride);
}

export function frameIndexFromProgress({
  frameCount,
  progress,
} = {}) {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 1) return 0;
  const bounded = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  return Math.min(frameCount - 1, Math.round(bounded * (frameCount - 1)));
}

export function playbackFrameFromElapsed({
  initialIndex = 0,
  frameCount,
  elapsedMs = 0,
  durationMs,
} = {}) {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) return 0;
  const terminalIndex = frameCount - 1;
  const safeInitial = Number.isSafeInteger(initialIndex)
    ? Math.min(terminalIndex, Math.max(0, initialIndex))
    : 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return safeInitial;
  }
  const ratio = Number.isFinite(elapsedMs)
    ? Math.min(1, Math.max(0, elapsedMs / durationMs))
    : 0;
  return Math.min(
    terminalIndex,
    safeInitial +
      Math.round((terminalIndex - safeInitial) * ratio),
  );
}
