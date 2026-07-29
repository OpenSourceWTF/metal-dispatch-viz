import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import {
  observatoryPixelRatio,
  shouldAnimateObservatory,
} from "./scene-timing.js";
import { buildStoryFrame, MAX_GPU_LANES, MAX_MEMORY_BLOCKS } from "./story-frame.js";
import {
  buildTheaterLabels,
  createTextPlate,
} from "./theater-labels.js";

const THEATER_COLORS = Object.freeze({
  background: 0x0b1219,
  floor: 0x142431,
  floorLine: 0x29495b,
  memory: 0x48e7ff,
  memoryInactive: 0x245468,
  math: 0xffbd69,
  mathInactive: 0x5b4c39,
  lane: 0xf4f9fc,
  laneInactive: 0x425665,
  speculation: 0xc7a8ff,
  control: 0x8da8b9,
});

const STAGE = Object.freeze({
  memory: Object.freeze({ x: -5.8, y: -0.5 }),
  kernel: Object.freeze({ x: -0.15, y: -0.55 }),
  gpu: Object.freeze({ x: 5.35, y: -0.55 }),
  worldWidth: 20,
  minimumWorldHeight: 10,
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function addBox(group, dimensions, position, material) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...dimensions),
    material,
  );
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function addTube(scene, points, color, opacity = 0.72) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(...point)),
  );
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.7,
    metalness: 0.15,
    roughness: 0.3,
    transparent: true,
    opacity,
  });
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, 0.045, 8, false),
    material,
  );
  scene.add(mesh);
  return { curve, material, mesh };
}

function addDashedLine(scene, points, color) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(...point)),
    ),
    new THREE.LineDashedMaterial({
      color,
      dashSize: 0.18,
      gapSize: 0.11,
      transparent: true,
      opacity: 0.84,
    }),
  );
  line.computeLineDistances();
  scene.add(line);
  return line;
}

function createMathParticles() {
  const count = 72;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const column = index % 9;
    const row = Math.floor(index / 9);
    positions[index * 3] = -1.1 + column * 0.275;
    positions[index * 3 + 1] = -0.85 + row * 0.24;
    positions[index * 3 + 2] =
      0.62 + ((index * 7) % 5) * 0.045;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  const material = new THREE.PointsMaterial({
    color: THEATER_COLORS.math,
    size: 0.095,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.position.set(STAGE.kernel.x, STAGE.kernel.y, 0);
  return { material, points };
}

function createLabelSet(scene, storyFrame) {
  const labels = buildTheaterLabels(storyFrame);
  const definitions = {
    progress: {
      text: labels.progress,
      position: [0, 3.7, 1.1],
      width: 8.7,
      accent: "#48e7ff",
    },
    memory: {
      text: labels.memory,
      position: [STAGE.memory.x, -2.95, 1.1],
      width: 4.5,
      accent: "#48e7ff",
    },
    kernel: {
      text: labels.kernel,
      position: [STAGE.kernel.x, -2.95, 1.1],
      width: 4.5,
      accent: "#ffbd69",
    },
    gpu: {
      text: labels.gpu,
      position: [STAGE.gpu.x, -2.95, 1.1],
      width: 5.2,
      accent: "#f4f9fc",
    },
    flow: {
      text: labels.flow,
      position: [-3.05, 1.05, 1.1],
      width: 3.8,
      accent: "#48e7ff",
    },
    speculation: {
      text: labels.speculation,
      position: [3.05, 1.55, 1.1],
      width: 4.5,
      accent: "#c7a8ff",
    },
    legend: {
      text: labels.legend,
      position: [0, -4.05, 1.1],
      width: 8.3,
      accent: "#f4f9fc",
    },
  };
  const plates = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const plate = createTextPlate(THREE, definition);
    plate.sprite.position.set(...definition.position);
    plates[name] = plate;
    scene.add(plate.sprite);
  }
  return plates;
}

function setMaterialState(
  material,
  { color, emissive, emissiveIntensity },
) {
  material.color.setHex(color);
  material.emissive.setHex(emissive);
  material.emissiveIntensity = emissiveIntensity;
}

function applyStoryFrame(activity, storyFrame) {
  const story = storyFrame ?? buildStoryFrame();
  const labels = buildTheaterLabels(story);
  const activeMemory = new Set(story.memory.activeIndices);
  const activeLanes = new Set(story.gpu.activeIndices);

  activity.memoryBlocks.forEach((block, index) => {
    block.visible = index < story.memory.blocks.length;
    const active = activeMemory.has(index);
    setMaterialState(block.material, {
      color: active
        ? THEATER_COLORS.memory
        : THEATER_COLORS.memoryInactive,
      emissive: active
        ? THEATER_COLORS.memory
        : THEATER_COLORS.memoryInactive,
      emissiveIntensity: active ? 1.45 : 0.36,
    });
    block.scale.z = active ? 1.45 : 1;
  });

  activity.laneNodes.forEach((lane, index) => {
    lane.visible = index < story.gpu.lanes.length;
    lane.userData.active = activeLanes.has(index);
    setMaterialState(lane.material, {
      color: lane.userData.active
        ? THEATER_COLORS.lane
        : THEATER_COLORS.laneInactive,
      emissive: lane.userData.active
        ? THEATER_COLORS.math
        : THEATER_COLORS.laneInactive,
      emissiveIntensity: lane.userData.active ? 1.15 : 0.28,
    });
    lane.scale.z = lane.userData.active ? 1.5 : 1;
  });

  const commandPosition = story.progress.bufferLabel === "—"
    ? story.index
    : Number.parseInt(story.progress.bufferLabel, 10) - 1;
  activity.controlNodes.forEach((node, index) => {
    const active = index === Math.abs(commandPosition) % activity.controlNodes.length;
    setMaterialState(node.material, {
      color: active ? THEATER_COLORS.memory : THEATER_COLORS.control,
      emissive: active ? THEATER_COLORS.memory : THEATER_COLORS.control,
      emissiveIntensity: active ? 1.2 : 0.25,
    });
  });

  activity.kernelCore.scale.x =
    0.82 + clamp(story.active.mathIntensity) * 0.18;
  activity.kernelCore.scale.y =
    0.88 + clamp(story.active.mathIntensity) * 0.12;
  activity.kernelCore.material.emissiveIntensity =
    0.9 + story.active.mathIntensity * 0.85;
  activity.kernelTiles.forEach((tile, index) => {
    const active = index <= Math.round(story.active.mathIntensity * 7);
    tile.material.emissiveIntensity = active ? 1.25 : 0.28;
    tile.material.opacity = active ? 0.96 : 0.55;
  });

  activity.mathParticles.visible = story.active.family !== "awaiting";
  activity.mathParticleMaterial.opacity =
    0.28 + story.active.mathIntensity * 0.7;
  activity.flowPaths.forEach(({ material }) => {
    material.opacity = story.flow.active
      ? 0.34 + story.flow.intensity * 0.62
      : 0.12;
  });
  activity.flowPulses.forEach((pulse) => {
    pulse.mesh.visible = story.flow.active;
  });
  activity.speculationLines.forEach((line, index) => {
    line.visible =
      story.speculation.visible &&
      index < Math.min(4, story.speculation.width ?? 0);
  });
  activity.labels.speculation.sprite.visible = story.speculation.visible;

  activity.progressFill.scale.x = Math.max(0.001, story.progress.ratio);
  activity.progressFill.position.x =
    -4.2 + (4.2 * story.progress.ratio);

  for (const [name, plate] of Object.entries(activity.labels)) {
    plate.update(labels[name]);
  }
  activity.story = story;
  activity.canvas.setAttribute(
    "aria-label",
    `${labels.progress}. ${labels.memory}. ${labels.kernel}. ${labels.gpu}.`,
  );
}

function disposeScene(scene) {
  scene.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      material?.map?.dispose?.();
      material?.dispose?.();
    }
  });
}

export function ObservatoryScene({
  model,
  storyFrame,
  frameIndex = 0,
  reducedMotion = false,
  animated = true,
  onCanvasReady,
}) {
  const mountRef = useRef(null);
  const activityRef = useRef(null);
  const storyRef = useRef(
    storyFrame ?? buildStoryFrame(model, frameIndex),
  );
  const reducedMotionRef = useRef(reducedMotion);
  const animatedRef = useRef(animated);
  const renderRequestRef = useRef(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    const nextStory = storyFrame ?? buildStoryFrame(model, frameIndex);
    storyRef.current = nextStory;
    if (activityRef.current) applyStoryFrame(activityRef.current, nextStory);
    renderRequestRef.current?.();
  }, [frameIndex, model, storyFrame]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    renderRequestRef.current?.();
  }, [reducedMotion]);

  useEffect(() => {
    animatedRef.current = animated;
    renderRequestRef.current?.();
  }, [animated]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer;
    let animationFrame = null;
    let resizeObserver = null;
    let visible = !globalThis.document?.hidden;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: false,
        antialias: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "WebGL unavailable",
      );
      return undefined;
    }

    renderer.setClearColor(THEATER_COLORS.background, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "observatory-canvas";
    renderer.domElement.setAttribute("role", "img");
    mount.append(renderer.domElement);
    onCanvasReady?.(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(THEATER_COLORS.background);
    const camera = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 100);
    camera.position.set(0, 6.3, 18);
    camera.lookAt(0, -0.65, 0);

    scene.add(new THREE.HemisphereLight(0xd9f3ff, 0x1b2730, 2.25));
    const keyLight = new THREE.DirectionalLight(0xe8f8ff, 4.2);
    keyLight.position.set(-4, 8, 12);
    scene.add(keyLight);
    const mathLight = new THREE.PointLight(
      THEATER_COLORS.math,
      32,
      11,
      1.7,
    );
    mathLight.position.set(STAGE.kernel.x, 1.2, 4);
    scene.add(mathLight);
    const memoryLight = new THREE.PointLight(
      THEATER_COLORS.memory,
      24,
      10,
      1.8,
    );
    memoryLight.position.set(STAGE.memory.x, 0, 4);
    scene.add(memoryLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(19, 8),
      new THREE.MeshStandardMaterial({
        color: THEATER_COLORS.floor,
        emissive: 0x0b1821,
        emissiveIntensity: 0.5,
        metalness: 0.4,
        roughness: 0.72,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -2.45, -0.2);
    scene.add(floor);
    const floorGrid = new THREE.GridHelper(
      19,
      38,
      THEATER_COLORS.floorLine,
      0x1c3340,
    );
    floorGrid.position.y = -2.42;
    scene.add(floorGrid);

    const memoryGroup = new THREE.Group();
    const memoryBlocks = [];
    for (let index = 0; index < MAX_MEMORY_BLOCKS; index += 1) {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const material = new THREE.MeshStandardMaterial({
        color: THEATER_COLORS.memoryInactive,
        emissive: THEATER_COLORS.memoryInactive,
        emissiveIntensity: 0.36,
        metalness: 0.48,
        roughness: 0.32,
      });
      const block = addBox(
        memoryGroup,
        [0.66, 0.47, 0.52],
        [
          STAGE.memory.x - 1.15 + column * 0.78,
          STAGE.memory.y - 1.38 + row * 0.53,
          0,
        ],
        material,
      );
      memoryBlocks.push(block);
    }
    scene.add(memoryGroup);

    const kernelFrame = addBox(
      scene,
      [3.4, 2.75, 0.34],
      [STAGE.kernel.x, STAGE.kernel.y, -0.18],
      new THREE.MeshStandardMaterial({
        color: 0x453824,
        emissive: 0x2b1f11,
        emissiveIntensity: 0.8,
        metalness: 0.7,
        roughness: 0.26,
      }),
    );
    const kernelCore = addBox(
      scene,
      [2.92, 2.28, 0.72],
      [STAGE.kernel.x, STAGE.kernel.y, 0.22],
      new THREE.MeshStandardMaterial({
        color: THEATER_COLORS.math,
        emissive: THEATER_COLORS.math,
        emissiveIntensity: 1.2,
        metalness: 0.34,
        roughness: 0.24,
      }),
    );
    const kernelTiles = [];
    for (let index = 0; index < 8; index += 1) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffdca3,
        emissive: THEATER_COLORS.math,
        emissiveIntensity: 0.35,
        metalness: 0.2,
        roughness: 0.38,
        transparent: true,
        opacity: 0.6,
      });
      const tile = addBox(
        scene,
        [0.52, 0.72, 0.16],
        [
          STAGE.kernel.x - 1.02 + (index % 4) * 0.68,
          STAGE.kernel.y - 0.48 + Math.floor(index / 4) * 0.98,
          0.66,
        ],
        material,
      );
      kernelTiles.push(tile);
    }

    const laneGroup = new THREE.Group();
    const laneNodes = [];
    for (let index = 0; index < MAX_GPU_LANES; index += 1) {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const material = new THREE.MeshStandardMaterial({
        color: THEATER_COLORS.laneInactive,
        emissive: THEATER_COLORS.laneInactive,
        emissiveIntensity: 0.28,
        metalness: 0.55,
        roughness: 0.25,
      });
      const lane = addBox(
        laneGroup,
        [0.62, 0.55, 0.56],
        [
          STAGE.gpu.x - 1.17 + column * 0.78,
          STAGE.gpu.y - 1.05 + row * 0.72,
          0,
        ],
        material,
      );
      laneNodes.push(lane);
    }
    scene.add(laneGroup);

    const controlNodes = [];
    for (let index = 0; index < 5; index += 1) {
      const material = new THREE.MeshStandardMaterial({
        color: THEATER_COLORS.control,
        emissive: THEATER_COLORS.control,
        emissiveIntensity: 0.25,
        metalness: 0.3,
        roughness: 0.4,
      });
      controlNodes.push(
        addBox(
          scene,
          [0.7, 0.22, 0.28],
          [-1.75 + index * 0.82, 2.05, 0],
          material,
        ),
      );
    }

    const flowPaths = [
      addTube(
        scene,
        [
          [-3.95, -0.4, 0.5],
          [-2.85, 0.25, 0.65],
          [-1.85, -0.2, 0.65],
        ],
        THEATER_COLORS.memory,
      ),
      addTube(
        scene,
        [
          [1.62, -0.2, 0.62],
          [2.7, 0.25, 0.65],
          [3.82, -0.35, 0.55],
        ],
        THEATER_COLORS.math,
      ),
      addTube(
        scene,
        [
          [4.25, -2.05, 0.15],
          [0.2, -3.18, 0.12],
          [-4.35, -2.1, 0.12],
        ],
        THEATER_COLORS.memory,
        0.42,
      ),
    ];

    const flowPulses = flowPaths.map(({ curve }, index) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 14, 14),
        new THREE.MeshBasicMaterial({
          color:
            index === 1 ? THEATER_COLORS.math : THEATER_COLORS.memory,
        }),
      );
      mesh.visible = false;
      scene.add(mesh);
      return { curve, mesh, offset: index * 0.27 };
    });

    const speculationLines = [];
    for (let index = 0; index < 4; index += 1) {
      speculationLines.push(
        addDashedLine(
          scene,
          [
            [1.45, 0.62 + index * 0.16, 0.75],
            [2.5, 1.12 + index * 0.12, 0.78],
            [4.0, 0.78 + index * 0.13, 0.72],
          ],
          THEATER_COLORS.speculation,
        ),
      );
    }

    const { material: mathParticleMaterial, points: mathParticles } =
      createMathParticles();
    scene.add(mathParticles);

    const progressTrack = addBox(
      scene,
      [8.4, 0.09, 0.08],
      [0, 3.2, 0.3],
      new THREE.MeshBasicMaterial({ color: 0x2e4756 }),
    );
    const progressFill = addBox(
      scene,
      [8.4, 0.13, 0.12],
      [-4.2, 3.2, 0.42],
      new THREE.MeshBasicMaterial({ color: THEATER_COLORS.memory }),
    );
    progressFill.geometry.translate(4.2, 0, 0);

    const labels = createLabelSet(scene, storyRef.current);
    const activity = {
      canvas: renderer.domElement,
      controlNodes,
      flowPaths,
      flowPulses,
      kernelCore,
      kernelFrame,
      kernelTiles,
      labels,
      laneNodes,
      mathParticleMaterial,
      mathParticles,
      memoryBlocks,
      progressFill,
      progressTrack,
      speculationLines,
      story: storyRef.current,
    };
    activityRef.current = activity;
    applyStoryFrame(activity, storyRef.current);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth || 960);
      const height = Math.max(1, mount.clientHeight || 640);
      renderer.setPixelRatio(
        observatoryPixelRatio({
          devicePixelRatio: globalThis.devicePixelRatio,
          width,
          height,
        }),
      );
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const worldHeight = Math.max(
        STAGE.minimumWorldHeight,
        STAGE.worldWidth / aspect,
      );
      const worldWidth = Math.max(
        STAGE.worldWidth,
        worldHeight * aspect,
      );
      camera.left = -worldWidth / 2;
      camera.right = worldWidth / 2;
      camera.top = worldHeight / 2;
      camera.bottom = -worldHeight / 2;
      camera.updateProjectionMatrix();
      renderRequestRef.current?.();
    };
    resize();
    if (typeof globalThis.ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
    } else {
      globalThis.addEventListener?.("resize", resize);
    }

    const onVisibility = () => {
      visible = !globalThis.document?.hidden;
      if (visible) renderRequestRef.current?.();
    };
    globalThis.document?.addEventListener("visibilitychange", onVisibility);

    const startedAt = performance.now();
    const render = (now) => {
      animationFrame = null;
      if (!visible) return;
      const current = activityRef.current;
      const story = current?.story ?? storyRef.current;
      const time = (now - startedAt) / 1_000;
      const motion = reducedMotionRef.current ? 0 : time;

      current.flowPulses.forEach((pulse) => {
        if (!pulse.mesh.visible) return;
        const phase = (motion * 0.34 + pulse.offset) % 1;
        pulse.curve.getPointAt(phase, pulse.mesh.position);
      });
      current.mathParticles.rotation.z = motion * 0.22;
      current.mathParticles.rotation.y = motion * 0.16;
      current.kernelCore.material.emissiveIntensity =
        1.05 +
        story.active.mathIntensity * 0.75 +
        (reducedMotionRef.current ? 0 : Math.sin(time * 5) * 0.12);
      current.laneNodes.forEach((lane, index) => {
        if (!lane.visible || !lane.userData.active) return;
        lane.material.emissiveIntensity =
          1.05 +
          (reducedMotionRef.current
            ? 0
            : Math.sin(time * 4.2 + index * 0.4) * 0.18);
      });
      renderer.render(scene, camera);
      if (
        shouldAnimateObservatory({
          active: animatedRef.current,
          reducedMotion: reducedMotionRef.current,
          visible,
        })
      ) {
        requestRender();
      }
    };
    const requestRender = () => {
      if (animationFrame === null) {
        animationFrame = globalThis.requestAnimationFrame(render);
      }
    };
    renderRequestRef.current = requestRender;
    requestRender();

    return () => {
      if (renderRequestRef.current === requestRender) {
        renderRequestRef.current = null;
      }
      if (animationFrame !== null) {
        globalThis.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", resize);
      globalThis.document?.removeEventListener(
        "visibilitychange",
        onVisibility,
      );
      activityRef.current = null;
      onCanvasReady?.(null);
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onCanvasReady]);

  if (failure) {
    const story = storyFrame ?? buildStoryFrame(model, frameIndex);
    return (
      <div className="observatory-scene-fallback" role="img">
        <strong>
          {story.progress.capturedWindowLabel} {story.progress.percent}%
        </strong>
        <span>
          {story.active.family} · {story.active.shapeLabel}
        </span>
        <small>{failure}</small>
      </div>
    );
  }

  return <div ref={mountRef} className="observatory-scene" />;
}
