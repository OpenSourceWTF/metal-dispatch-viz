import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import {
  animateStatueGeometry,
  applyStatuePresentation,
  createStatueGeometry,
  disposeStatueGeometry,
  STATUE_PALETTE,
} from "./statue-geometry.js";
import {
  observatoryPixelRatio,
  shouldAnimateObservatory,
} from "./scene-timing.js";
import { buildStatueFrame } from "./statue-state.js";
import { createWorldLabel } from "./world-labels.js";

const RETRACT_INSTRUMENTS_MS = 3_200;

function architectureIdentity(presentation) {
  const architecture = presentation?.architecture;
  return [
    architecture?.available,
    architecture?.source,
    architecture?.layerCount,
    architecture?.hiddenSize,
    architecture?.feedForwardKind,
    architecture?.feedForward?.experts,
  ].join(":");
}

function disposeScene(scene) {
  const geometries = new Set();
  const materials = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) {
      if (material) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    material.map?.dispose?.();
    material.dispose();
  }
}

function createBackdrop() {
  const geometry = new THREE.BufferGeometry();
  const count = 480;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cyan = new THREE.Color(STATUE_PALETTE.cyan);
  const blue = new THREE.Color(STATUE_PALETTE.blue);
  for (let index = 0; index < count; index += 1) {
    const longitude = index * 2.399963;
    const latitude = Math.acos(1 - 2 * ((index + 0.5) / count));
    const radius = 19 + (index % 11) * 0.72;
    positions[index * 3] =
      Math.sin(latitude) * Math.cos(longitude) * radius;
    positions[index * 3 + 1] = Math.cos(latitude) * radius;
    positions[index * 3 + 2] =
      Math.sin(latitude) * Math.sin(longitude) * radius;
    const color = index % 9 === 0 ? cyan : blue;
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.035,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const field = new THREE.Points(geometry, material);
  field.name = "DETERMINISTIC_OBSERVATORY_FIELD";
  return field;
}

function instrumentMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.65,
    metalness: 0.75,
    roughness: 0.18,
    transparent: true,
    opacity: 0.8,
  });
}

function createInstruments() {
  const group = new THREE.Group();
  group.name = "DIEGETIC_INSTRUMENTS";
  group.position.set(0, -5.8, 4.4);
  group.rotation.x = -0.2;
  group.visible = false;

  const definitions = [
    ["previous", new THREE.TetrahedronGeometry(0.23, 0)],
    ["toggle", new THREE.OctahedronGeometry(0.24, 0)],
    ["next", new THREE.TetrahedronGeometry(0.23, 0)],
    ["import", new THREE.BoxGeometry(0.33, 0.33, 0.1)],
    ["png", new THREE.TorusGeometry(0.2, 0.035, 6, 32)],
    ["record", new THREE.SphereGeometry(0.19, 16, 12)],
  ];
  const pickables = [];
  definitions.forEach(([action, geometry], index) => {
    const color =
      action === "record"
        ? 0xff5e7a
        : action === "png"
          ? STATUE_PALETTE.amber
          : STATUE_PALETTE.cyan;
    const mesh = new THREE.Mesh(geometry, instrumentMaterial(color));
    mesh.position.x = (index - (definitions.length - 1) / 2) * 0.72;
    mesh.userData.action = action;
    mesh.userData.baseEmissiveIntensity =
      mesh.material.emissiveIntensity;
    if (action === "previous") mesh.rotation.z = Math.PI / 2;
    if (action === "next") mesh.rotation.z = -Math.PI / 2;
    group.add(mesh);
    pickables.push(mesh);
  });

  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(2.35, 0.014, 4, 96, Math.PI),
    instrumentMaterial(STATUE_PALETTE.blue),
  );
  rail.rotation.z = Math.PI;
  rail.position.y = -0.25;
  group.add(rail);
  return { group, pickables };
}

function architectureCaption(presentation) {
  if (!presentation.architecture.available) {
    return "ARCHITECTURE UNAVAILABLE";
  }
  const layerTypes = presentation.architecture.layerTypes;
  const fullAttention = layerTypes.filter(
    (layerType) => layerType === "full_attention",
  ).length;
  const linearAttention = layerTypes.length - fullAttention;
  const feedForward =
    presentation.architecture.feedForwardKind === "moe"
      ? `${presentation.architecture.feedForward.experts} EXPERTS · TOP ${presentation.architecture.feedForward.expertsPerToken}`
      : "DENSE FFN";
  return `${layerTypes.length} LAYERS · ${linearAttention} LINEAR / ${fullAttention} FULL · ${feedForward}`;
}

function compactKernelInscription(value) {
  if (typeof value !== "string" || value.length <= 34) return value;
  return `${value.slice(0, 20)}…${value.slice(-10)}`;
}

function createLabels(scene, presentation) {
  const labels = {
    model: createWorldLabel(THREE, {
      text: presentation.inscriptions.model,
      worldWidth: 3.7,
      accent: "#68e7ff",
    }),
    architecture: createWorldLabel(THREE, {
      text: architectureCaption(presentation),
      worldWidth: 4.2,
      height: 112,
      accent: "#5a83ff",
      opacity: 0.58,
    }),
    layer: createWorldLabel(THREE, {
      text: presentation.inscriptions.layer,
      worldWidth: 3.35,
      accent: "#e9fbff",
    }),
    kernel: createWorldLabel(THREE, {
      text: compactKernelInscription(presentation.inscriptions.kernel),
      worldWidth: 3.55,
      accent: "#ffb45d",
    }),
    kernelFamily: createWorldLabel(THREE, {
      text: `KERNEL · ${presentation.kernel.family}`,
      worldWidth: 2.25,
      width: 720,
      height: 112,
      accent: "#ffb45d",
      opacity: 0.7,
    }),
    memory: createWorldLabel(THREE, {
      text: "UNIFIED MEMORY",
      worldWidth: 1.85,
      width: 720,
      height: 112,
      accent: "#68e7ff",
      opacity: 0.72,
    }),
    cpu: createWorldLabel(THREE, {
      text: "CPU",
      worldWidth: 0.8,
      width: 384,
      height: 112,
      accent: "#e9fbff",
      opacity: 0.7,
    }),
    gpu: createWorldLabel(THREE, {
      text: "GPU",
      worldWidth: 0.8,
      width: 384,
      height: 112,
      accent: "#ffb45d",
      opacity: 0.7,
    }),
    simulated: createWorldLabel(THREE, {
      text: `${presentation.inscriptions.simulated} · LAYER FLOW`,
      worldWidth: 1.7,
      width: 640,
      height: 112,
      accent: "#a974ff",
      opacity: 0.68,
    }),
  };
  labels.model.sprite.position.set(-2.65, 5.25, 0.2);
  labels.architecture.sprite.position.set(-2.65, 4.82, 0.2);
  labels.layer.sprite.position.set(2.85, 0, 0.5);
  labels.kernel.sprite.position.set(2.85, 1.58, 1.25);
  labels.kernelFamily.sprite.position.set(3.35, 3.58, 1.05);
  labels.memory.sprite.position.set(-3.7, -3.55, 0.25);
  labels.cpu.sprite.position.set(-3.7, 3.48, 0.4);
  labels.gpu.sprite.position.set(3.7, -3.55, 0.5);
  labels.simulated.sprite.position.set(2.65, 5.25, 0.2);
  for (const label of Object.values(labels)) scene.add(label.sprite);
  return labels;
}

function applyLabels(labels, presentation, { reducedMotion = false } = {}) {
  const change = reducedMotion ? "update" : "transition";
  labels.model.update(presentation.inscriptions.model);
  labels.layer[change](presentation.inscriptions.layer, {
    accent:
      presentation.activation.layerType === "full_attention"
        ? "#e9fbff"
        : "#68e7ff",
  });
  labels.kernel[change](
    compactKernelInscription(presentation.inscriptions.kernel),
    {
      accent:
        presentation.kernel.family === "projection"
          ? "#ffb45d"
          : "#68e7ff",
    },
  );
  labels.kernelFamily[change](
    `KERNEL · ${presentation.kernel.family}`,
    {
      accent:
        presentation.kernel.family === "projection"
          ? "#ffb45d"
          : "#68e7ff",
    },
  );
  labels.architecture.update(architectureCaption(presentation));
  labels.simulated.update(
    `${presentation.inscriptions.simulated} · LAYER FLOW`,
  );
  labels.layer.sprite.position.y = 0;
}

export function ObservatoryScene({
  model,
  presentation: suppliedPresentation,
  frameIndex = 0,
  reducedMotion = false,
  animated = true,
  onCanvasReady,
  onCaptureController,
  onCommand,
  onScrub,
}) {
  const presentation = useMemo(
    () => suppliedPresentation ?? buildStatueFrame(model, frameIndex),
    [frameIndex, model, suppliedPresentation],
  );
  const identity = architectureIdentity(presentation);
  const mountRef = useRef(null);
  const activityRef = useRef(null);
  const presentationRef = useRef(presentation);
  const animatedRef = useRef(animated);
  const reducedMotionRef = useRef(reducedMotion);
  const commandRef = useRef(onCommand);
  const scrubRef = useRef(onScrub);
  const renderRequestRef = useRef(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    commandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    scrubRef.current = onScrub;
  }, [onScrub]);

  useEffect(() => {
    presentationRef.current = presentation;
    const activity = activityRef.current;
    if (activity) {
      const nextIdentity = architectureIdentity(presentation);
      if (activity.identity !== nextIdentity) {
        activity.scene.remove(activity.statue.root);
        disposeStatueGeometry(activity.statue);
        activity.statue = createStatueGeometry(THREE, presentation);
        activity.scene.add(activity.statue.root);
        activity.identity = nextIdentity;
      }
      applyStatuePresentation(activity.statue, presentation);
      applyLabels(
        activity.labels,
        presentation,
        { reducedMotion: reducedMotionRef.current },
      );
      activity.canvas.setAttribute(
        "aria-label",
        `${presentation.inscriptions.model}. ${presentation.inscriptions.layer}. Kernel ${presentation.inscriptions.kernel}.`,
      );
      renderRequestRef.current?.();
    }
  }, [presentation]);

  useEffect(() => {
    animatedRef.current = animated;
    renderRequestRef.current?.();
  }, [animated]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    renderRequestRef.current?.();
  }, [reducedMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "WebGL unavailable",
      );
      return undefined;
    }

    renderer.setClearColor(0x02050a, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.domElement.className = "observatory-canvas";
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      `${presentationRef.current.inscriptions.model}. ${presentationRef.current.inscriptions.layer}.`,
    );
    const onContextLost = (event) => {
      event.preventDefault();
      setFailure("The Observatory lost its graphics context.");
    };
    renderer.domElement.addEventListener(
      "webglcontextlost",
      onContextLost,
    );
    mount.append(renderer.domElement);
    onCanvasReady?.(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02050a);
    scene.fog = new THREE.FogExp2(0x02050a, 0.026);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    const cameraBase = { x: 9.2, y: 3.4, z: 14.8 };
    camera.position.set(cameraBase.x, cameraBase.y, cameraBase.z);
    camera.lookAt(0, 0, 0);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.4,
      0.36,
      0.32,
    );
    composer.addPass(bloom);

    scene.add(new THREE.HemisphereLight(0xa9eaff, 0x06101c, 1.8));
    const key = new THREE.DirectionalLight(0xc8f5ff, 3.4);
    key.position.set(4, 9, 10);
    scene.add(key);
    const rim = new THREE.PointLight(
      STATUE_PALETTE.amber,
      16,
      24,
      1.7,
    );
    rim.position.set(6, -3, 7);
    scene.add(rim);
    const memoryLight = new THREE.PointLight(
      STATUE_PALETTE.cyan,
      14,
      22,
      1.6,
    );
    memoryLight.position.set(-3.7, -2.65, 4);
    scene.add(memoryLight);

    const backdrop = createBackdrop();
    scene.add(backdrop);
    const statue = createStatueGeometry(
      THREE,
      presentationRef.current,
    );
    scene.add(statue.root);
    const labels = createLabels(scene, presentationRef.current);
    applyLabels(
      labels,
      presentationRef.current,
      { reducedMotion: reducedMotionRef.current },
    );
    const instruments = createInstruments();
    scene.add(instruments.group);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let retractTimer = null;
    let hovered = null;
    const showInstruments = () => {
      if (captureLocked) return;
      instruments.group.visible = true;
      if (retractTimer !== null) clearTimeout(retractTimer);
      retractTimer = setTimeout(() => {
        instruments.group.visible = false;
        renderRequestRef.current?.();
      }, RETRACT_INSTRUMENTS_MS);
      renderRequestRef.current?.();
    };
    const updatePointer = (event) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    };
    const onPointerMove = (event) => {
      showInstruments();
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const next =
        raycaster.intersectObjects(instruments.pickables, false)[0]
          ?.object ?? null;
      if (hovered !== next) {
        if (hovered) {
          hovered.material.emissiveIntensity =
            hovered.userData.baseEmissiveIntensity;
          hovered.scale.setScalar(1);
        }
        hovered = next;
        if (hovered) {
          hovered.material.emissiveIntensity = 2.2;
          hovered.scale.setScalar(1.18);
        }
        renderer.domElement.style.cursor = hovered
          ? "pointer"
          : "crosshair";
      }
    };
    const onPointerDown = (event) => {
      showInstruments();
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const selected =
        raycaster.intersectObjects(instruments.pickables, false)[0]
          ?.object;
      if (selected?.userData?.action) {
        commandRef.current?.(selected.userData.action);
      }
    };
    const onWheel = (event) => {
      if (Math.abs(event.deltaY) < 1) return;
      event.preventDefault();
      scrubRef.current?.(event.deltaY);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("wheel", onWheel, {
      passive: false,
    });

    let animationFrame = null;
    let visible = !globalThis.document?.hidden;
    let captureLocked = false;
    const startedAt = performance.now();
    let previousRenderSeconds = 0;
    const render = (now = performance.now()) => {
      animationFrame = null;
      if (!visible) return;
      const time = Math.max(0, (now - startedAt) / 1_000);
      const renderDelta = Math.min(
        0.1,
        Math.max(0, time - previousRenderSeconds),
      );
      previousRenderSeconds = time;
      const currentStatue = activityRef.current?.statue ?? statue;
      animateStatueGeometry(currentStatue, time, {
        reducedMotion: reducedMotionRef.current,
      });
      const cameraMotion = reducedMotionRef.current ? 0 : time;
      camera.position.x =
        cameraBase.x + Math.sin(cameraMotion * 0.085) * 0.35;
      camera.position.z =
        cameraBase.z + Math.cos(cameraMotion * 0.085) * 0.24;
      camera.position.y =
        cameraBase.y + Math.sin(cameraMotion * 0.052) * 0.16;
      camera.lookAt(0, 0, 0);
      backdrop.rotation.y = cameraMotion * 0.006;
      instruments.group.children.forEach((instrument, index) => {
        if (!instrument.userData.action) return;
        instrument.rotation.y = cameraMotion * 0.45 + index * 0.22;
      });
      let labelsAnimating = false;
      for (const label of Object.values(labels)) {
        labelsAnimating = label.animate(renderDelta) || labelsAnimating;
      }
      composer.render();

      if (
        shouldAnimateObservatory({
          active:
            animatedRef.current ||
            instruments.group.visible ||
            labelsAnimating,
          reducedMotion: reducedMotionRef.current,
          visible,
        })
      ) {
        animationFrame = requestAnimationFrame(render);
      }
    };
    renderRequestRef.current = () => {
      if (animationFrame === null && visible) {
        animationFrame = requestAnimationFrame(render);
      }
    };

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
      composer.setSize(width, height);
      camera.aspect = width / height;
      const portrait = camera.aspect < 0.82;
      cameraBase.x = portrait ? 7.2 : 9.2;
      cameraBase.y = portrait ? 2.4 : 3.4;
      cameraBase.z = portrait ? 18.2 : 14.8;
      camera.fov = portrait ? 50 : 42;
      camera.updateProjectionMatrix();
      renderRequestRef.current?.();
    };
    resize();
    let resizeObserver = null;
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
    globalThis.document?.addEventListener(
      "visibilitychange",
      onVisibility,
    );
    activityRef.current = {
      canvas: renderer.domElement,
      identity: architectureIdentity(presentationRef.current),
      labels,
      scene,
      statue,
    };
    const captureController = {
      prepare() {
        captureLocked = true;
        instruments.group.visible = false;
        composer.render();
      },
      release() {
        captureLocked = false;
      },
    };
    onCaptureController?.(captureController);
    renderRequestRef.current();

    return () => {
      activityRef.current = null;
      onCaptureController?.(null);
      renderRequestRef.current = null;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (retractTimer !== null) clearTimeout(retractTimer);
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", resize);
      globalThis.document?.removeEventListener(
        "visibilitychange",
        onVisibility,
      );
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      renderer.domElement.removeEventListener(
        "pointermove",
        onPointerMove,
      );
      renderer.domElement.removeEventListener(
        "pointerdown",
        onPointerDown,
      );
      renderer.domElement.removeEventListener("wheel", onWheel);
      for (const label of Object.values(labels)) label.dispose();
      disposeScene(scene);
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      onCanvasReady?.(null);
    };
  }, [onCanvasReady, onCaptureController]);

  if (failure) {
    return (
      <div className="observatory-scene-fallback" role="alert">
        <strong>GRAPHICS SIGNAL LOST</strong>
        <span>{failure}</span>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      className="observatory-scene"
      data-architecture={identity}
    />
  );
}
