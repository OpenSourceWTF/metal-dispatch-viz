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
  return Math.min(
    safeDeviceRatio,
    2,
    1_920 / safeWidth,
    1_200 / safeHeight,
  );
}
