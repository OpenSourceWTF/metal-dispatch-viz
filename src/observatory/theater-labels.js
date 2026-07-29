const LABEL_CANVAS_WIDTH = 1_024;
const LABEL_CANVAS_HEIGHT = 128;

function storyOrFallback(storyFrame) {
  return {
    progress: {
      percent: storyFrame?.progress?.percent ?? 0,
      dispatchLabel: storyFrame?.progress?.dispatchLabel ?? "—",
      bufferLabel: storyFrame?.progress?.bufferLabel ?? "—",
      measuredDurationLabel:
        storyFrame?.progress?.measuredDurationLabel ?? null,
    },
    memory: {
      exactMassLabel: storyFrame?.memory?.exactMassLabel ?? "MASS UNKNOWN",
    },
    active: {
      family: storyFrame?.active?.family ?? "awaiting",
      shapeLabel: storyFrame?.active?.shapeLabel ?? "SHAPE UNAVAILABLE",
    },
    gpu: {
      lanes:
        Array.isArray(storyFrame?.gpu?.lanes)
          ? storyFrame.gpu.lanes
          : [],
      gridLabel: storyFrame?.gpu?.gridLabel ?? "GRID UNAVAILABLE",
      evidence: storyFrame?.gpu?.evidence ?? "unavailable",
    },
    flow: {
      label: storyFrame?.flow?.label ?? "DERIVED BINDING FLOW",
    },
    speculation: {
      label:
        storyFrame?.speculation?.label ?? "SPECULATION NOT DECLARED",
    },
    evidence: {
      level: storyFrame?.evidence?.level ?? "pending",
      statusLabel:
        storyFrame?.evidence?.statusLabel ?? "EVIDENCE PENDING",
    },
  };
}

export function buildTheaterLabels(storyFrame) {
  const story = storyOrFallback(storyFrame);
  return Object.freeze({
    progress:
      `CAPTURED WINDOW ${story.progress.percent}% · ` +
      `DISPATCH ${story.progress.dispatchLabel}`,
    control:
      `CPU COMMAND QUEUE · BUFFER ${story.progress.bufferLabel}` +
      (story.progress.measuredDurationLabel
        ? ` · ${story.progress.measuredDurationLabel.replace(" · ", " ")}`
        : ""),
    memory: `UNIFIED MEMORY · ${story.memory.exactMassLabel}`,
    kernel:
      `${story.active.family.toUpperCase()} · ${story.active.shapeLabel}`,
    gpu:
      story.gpu.evidence === "measured geometry"
        ? `MEASURED GRID · ${story.gpu.lanes.length} REPRESENTATIVE LANES · ${story.gpu.gridLabel}`
        : "GRID UNAVAILABLE · NO PARALLELISM CLAIM",
    flow: story.flow.label,
    speculation: story.speculation.label,
    evidence: story.evidence.statusLabel,
    legend:
      `${story.gpu.evidence === "measured geometry" ? "MEASURED" : "GRID UNAVAILABLE"} · ` +
      "DERIVED · CONFIGURED",
  });
}

export function theaterProgressTransform(ratio) {
  const normalized = Number.isFinite(ratio)
    ? Math.min(1, Math.max(0, ratio))
    : 0;
  return Object.freeze({
    scaleX: normalized,
    positionX: -4.2,
  });
}

export function evidenceAccent(level) {
  if (level === "verified") return "#48e7ff";
  if (level === "warning") return "#ff7d8f";
  return "#8da8b9";
}

export function fitCanvasLabel(context, value, maximum, availableWidth) {
  const text = String(value ?? "");
  let size = maximum;
  do {
    context.font = `700 ${size}px Inter, Arial, sans-serif`;
    if (context.measureText(text).width <= availableWidth) {
      return Object.freeze({ fontSize: size, text });
    }
    size -= 2;
  } while (size > 24);

  const fontSize = 24;
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  let lower = 0;
  let upper = text.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    const candidate = `${text.slice(0, middle).trimEnd()}…`;
    if (context.measureText(candidate).width <= availableWidth) {
      lower = middle;
    } else {
      upper = middle - 1;
    }
  }
  return Object.freeze({
    fontSize,
    text: `${text.slice(0, lower).trimEnd()}…`,
  });
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

  const update = (nextText, nextAccent = accent) => {
    const label = String(nextText ?? "");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = nextAccent;
    context.fillRect(0, 0, 12, canvas.height);
    context.strokeStyle = "rgba(196, 225, 240, 0.42)";
    context.lineWidth = 3;
    context.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
    const fitted = fitCanvasLabel(
      context,
      label,
      46,
      canvas.width - 82,
    );
    context.font = `700 ${fitted.fontSize}px Inter, Arial, sans-serif`;
    context.fillStyle = foreground;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(fitted.text, 48, canvas.height / 2 + 1);
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
