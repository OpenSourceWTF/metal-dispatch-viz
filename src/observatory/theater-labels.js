const LABEL_CANVAS_WIDTH = 1_024;
const LABEL_CANVAS_HEIGHT = 128;

function storyOrFallback(storyFrame) {
  return {
    progress: {
      percent: storyFrame?.progress?.percent ?? 0,
      dispatchLabel: storyFrame?.progress?.dispatchLabel ?? "—",
    },
    memory: {
      exactMassLabel: storyFrame?.memory?.exactMassLabel ?? "MASS UNKNOWN",
    },
    active: {
      family: storyFrame?.active?.family ?? "awaiting",
      shapeLabel: storyFrame?.active?.shapeLabel ?? "1 × 1 × 1",
    },
    gpu: {
      lanes:
        Array.isArray(storyFrame?.gpu?.lanes) &&
        storyFrame.gpu.lanes.length > 0
          ? storyFrame.gpu.lanes
          : Array.from({ length: 4 }),
      gridLabel: storyFrame?.gpu?.gridLabel ?? "GRID 1 × 1 × 1",
    },
    flow: {
      label: storyFrame?.flow?.label ?? "DERIVED BINDING FLOW",
    },
    speculation: {
      label:
        storyFrame?.speculation?.label ?? "SPECULATION NOT DECLARED",
    },
  };
}

export function buildTheaterLabels(storyFrame) {
  const story = storyOrFallback(storyFrame);
  return Object.freeze({
    progress:
      `CAPTURED WINDOW ${story.progress.percent}% · ` +
      `DISPATCH ${story.progress.dispatchLabel}`,
    memory: `UNIFIED MEMORY · ${story.memory.exactMassLabel}`,
    kernel:
      `${story.active.family.toUpperCase()} · ${story.active.shapeLabel}`,
    gpu:
      `${story.gpu.lanes.length} REPRESENTATIVE LANES · ` +
      story.gpu.gridLabel,
    flow: story.flow.label,
    speculation: story.speculation.label,
    legend: "CYAN MEMORY · AMBER MATH · VIOLET CONFIGURED",
  });
}

function fittedFontSize(context, text, maximum, availableWidth) {
  let size = maximum;
  do {
    context.font = `700 ${size}px Inter, Arial, sans-serif`;
    if (context.measureText(text).width <= availableWidth) return size;
    size -= 2;
  } while (size > 24);
  return 24;
}

export function createTextPlate(
  THREE,
  {
    text,
    width = 6,
    height = 0.72,
    foreground = "#f8fcff",
    background = "rgba(8, 17, 24, 0.92)",
    accent = "#48e7ff",
    documentObject = globalThis.document,
  },
) {
  const canvas = documentObject?.createElement?.("canvas");
  if (!canvas) throw new Error("The Observatory requires a label canvas.");
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The Observatory cannot draw stage labels.");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 20;

  const update = (nextText) => {
    const label = String(nextText ?? "");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = accent;
    context.fillRect(0, 0, 12, canvas.height);
    context.strokeStyle = "rgba(196, 225, 240, 0.42)";
    context.lineWidth = 3;
    context.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
    const fontSize = fittedFontSize(
      context,
      label,
      46,
      canvas.width - 82,
    );
    context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
    context.fillStyle = foreground;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(label, 48, canvas.height / 2 + 1);
    texture.needsUpdate = true;
  };

  update(text);
  return Object.freeze({
    sprite,
    update,
    dispose() {
      texture.dispose();
      material.dispose();
    },
  });
}
