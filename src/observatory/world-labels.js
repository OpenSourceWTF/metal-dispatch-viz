function safeText(value, fallback = "—") {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : fallback;
}

function fitFont(context, text, width, preferred, minimum) {
  let size = preferred;
  while (size > minimum) {
    context.font = `600 ${size}px "Arial Narrow", "Helvetica Neue", sans-serif`;
    if (context.measureText(text).width <= width) break;
    size -= 2;
  }
  return size;
}

export function createWorldLabel(
  THREE,
  {
    text = "—",
    color = "#dffbff",
    accent = "#68e7ff",
    width = 1024,
    height = 144,
    worldWidth = 4.6,
    opacity = 0.92,
  } = {},
) {
  const canvas = globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("World labels require a browser canvas.");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("World labels require a 2D canvas context.");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldWidth * (height / width), 1);
  sprite.renderOrder = 10;

  let currentText = null;
  let currentColor = null;
  let currentAccent = null;
  const update = (
    nextText,
    { color: nextColor = color, accent: nextAccent = accent } = {},
  ) => {
    const value = safeText(nextText);
    if (
      value === currentText &&
      nextColor === currentColor &&
      nextAccent === currentAccent
    ) {
      return;
    }
    currentText = value;
    currentColor = nextColor;
    currentAccent = nextAccent;
    context.clearRect(0, 0, width, height);

    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(2, 8, 15, 0)");
    gradient.addColorStop(0.14, "rgba(2, 8, 15, 0.72)");
    gradient.addColorStop(0.86, "rgba(2, 8, 15, 0.72)");
    gradient.addColorStop(1, "rgba(2, 8, 15, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 18, width, height - 36);
    context.fillStyle = nextAccent;
    context.fillRect(width * 0.14, height - 21, width * 0.72, 2);

    const fontSize = fitFont(
      context,
      value,
      width * 0.68,
      Math.round(height * 0.34),
      24,
    );
    context.font = `600 ${fontSize}px "Arial Narrow", "Helvetica Neue", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.letterSpacing = "4px";
    context.shadowColor = nextAccent;
    context.shadowBlur = 14;
    context.fillStyle = nextColor;
    context.fillText(value.toUpperCase(), width / 2, height / 2);
    context.shadowBlur = 0;
    texture.needsUpdate = true;
  };

  update(text);
  return {
    sprite,
    update,
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}
