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

function createLabels(scene, presentation) {
  const labels = {
    model: createWorldLabel(THREE, {
      text: presentation.inscriptions.model,
      worldWidth: 5.8,
      accent: "#68e7ff",
    }),
    layer: createWorldLabel(THREE, {
      text: presentation.inscriptions.layer,
      worldWidth: 4.8,
      accent: "#e9fbff",
    }),
    kernel: createWorldLabel(THREE, {
      text: presentation.inscriptions.kernel,
      worldWidth: 5.9,
      accent: "#ffb45d",
    }),
    simulated: createWorldLabel(THREE, {
      text: presentation.inscriptions.simulated,
      worldWidth: 1.05,
      width: 384,
      height: 112,
      accent: "#a974ff",
      opacity: 0.68,
    }),
  };
  labels.model.sprite.position.set(-3.7, 5.65, 0.2);
  labels.layer.sprite.position.set(4.0, 0, 0.5);
  labels.kernel.sprite.position.set(0, -1.52, 3.35);
  labels.simulated.sprite.position.set(3.65, 5.65, 0.2);
  for (const label of Object.values(labels)) scene.add(label.sprite);
  return labels;
}

function applyLabels(labels, presentation, bodyHeight) {
  labels.model.update(presentation.inscriptions.model);
  labels.layer.update(presentation.inscriptions.layer, {
    accent:
      presentation.activation.layerType === "full_attention"
        ? "#e9fbff"
        : "#68e7ff",
  });
  labels.kernel.update(presentation.inscriptions.kernel, {
    accent:
      presentation.kernel.family === "projection"
        ? "#ffb45d"
        : "#68e7ff",
  });
  labels.simulated.update(presentation.inscriptions.simulated);
  const layerCount = presentation.architecture.layerCount;
  const ratio =
    presentation.activation.layerIndex === null || layerCount <= 1
      ? 0.5
      : presentation.activation.layerIndex / (layerCount - 1);
  labels.layer.sprite.position.y = (ratio - 0.5) * bodyHeight;
}

export function ObservatoryScene({
  model,
  presentation: suppliedPresentation,
  frameIndex = 0,
  reducedMotion = false,
  animated = true,
  onCanvasReady,
  onCommand,
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
  const renderRequestRef = useRef(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    commandRef.current = onCommand;
  }, [onCommand]);

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
        activity.statue.parts.bodyHeight,
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
    renderer.toneMappingExposure = 1.12;
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
    camera.position.set(11.8, 4.8, 15.5);
    camera.lookAt(0, 0, 0);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.88,
      0.72,
      0.14,
    );
    composer.addPass(bloom);

    scene.add(new THREE.HemisphereLight(0xa9eaff, 0x06101c, 1.8));
    const key = new THREE.DirectionalLight(0xc8f5ff, 3.4);
    key.position.set(4, 9, 10);
    scene.add(key);
    const rim = new THREE.PointLight(
      STATUE_PALETTE.amber,
      22,
      24,
      1.7,
    );
    rim.position.set(6, -3, 7);
    scene.add(rim);
    const memoryLight = new THREE.PointLight(
      STATUE_PALETTE.cyan,
      18,
      22,
      1.6,
    );
    memoryLight.position.set(-6, 3, 4);
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
      statue.parts.bodyHeight,
    );
    const instruments = createInstruments();
    scene.add(instruments.group);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let retractTimer = null;
    let hovered = null;
    const showInstruments = () => {
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
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    let animationFrame = null;
    let visible = !globalThis.document?.hidden;
    const startedAt = performance.now();
    const render = (now = performance.now()) => {
      animationFrame = null;
      if (!visible) return;
      const time = Math.max(0, (now - startedAt) / 1_000);
      const currentStatue = activityRef.current?.statue ?? statue;
      animateStatueGeometry(currentStatue, time, {
        reducedMotion: reducedMotionRef.current,
      });
      const cameraMotion = reducedMotionRef.current ? 0 : time;
      camera.position.x =
        11.8 + Math.sin(cameraMotion * 0.085) * 1.25;
      camera.position.z =
        15.5 + Math.cos(cameraMotion * 0.085) * 0.8;
      camera.position.y =
        4.8 + Math.sin(cameraMotion * 0.052) * 0.45;
      camera.lookAt(0, 0, 0);
      backdrop.rotation.y = cameraMotion * 0.006;
      instruments.group.children.forEach((instrument, index) => {
        if (!instrument.userData.action) return;
        instrument.rotation.y = cameraMotion * 0.45 + index * 0.22;
      });
      composer.render();

      if (
        shouldAnimateObservatory({
          active:
            animatedRef.current || instruments.group.visible,
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
    renderRequestRef.current();

    return () => {
      activityRef.current = null;
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
      for (const label of Object.values(labels)) label.dispose();
      disposeScene(scene);
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      onCanvasReady?.(null);
    };
  }, [onCanvasReady]);

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
