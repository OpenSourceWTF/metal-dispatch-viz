import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const SCENE_COLORS = Object.freeze({
  background: 0x050608,
  graphite: 0x20262d,
  graphiteBright: 0x3d4650,
  measured: 0x56e5ff,
  derived: 0xffb45e,
  speculation: 0x9c83ff,
  inactive: 0x12171c,
});

const FAMILY_COLORS = Object.freeze({
  attention: 0x54e7ff,
  projection: 0x65f3c5,
  normalization: 0x8fb4ff,
  routing: 0xc28aff,
  activation: 0xffd16c,
  "embedding-output": 0xff8c73,
  "transfer-binding": 0xffb45e,
  other: 0x9ba8b4,
});

function addBox(group, dimensions, position, material) {
  const geometry = new THREE.BoxGeometry(...dimensions);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function ribbon(points, color) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(...point)),
  );
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.2,
  });
  return new THREE.Line(geometry, material);
}

function disposeScene(scene) {
  scene.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material?.dispose?.();
  });
}

export function ObservatoryScene({
  model,
  frameIndex = 0,
  reducedMotion = false,
}) {
  const mountRef = useRef(null);
  const activityRef = useRef(null);
  const frameRef = useRef(null);
  const modelRef = useRef(model);
  const reducedMotionRef = useRef(reducedMotion);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    frameRef.current = model?.frames?.[frameIndex] ?? null;
  }, [frameIndex, model]);

  useEffect(() => {
    modelRef.current = model;
    if (!activityRef.current) return;
    const scale = model?.model?.normalizedScale ?? 0.6;
    activityRef.current.modelVolume.scale.setScalar(scale);
    const width = model?.speculation?.configuredWidth ?? 0;
    activityRef.current.speculation.forEach((line, index) => {
      line.visible = index < width;
    });
  }, [model]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer;
    let animationFrame = null;
    let resizeObserver = null;
    let visible = !globalThis.document?.hidden;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "WebGL unavailable");
      return undefined;
    }

    renderer.setClearColor(SCENE_COLORS.background, 0);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "observatory-canvas";
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      "Abstract trace-driven view of unified memory, CPU command encoding, GPU kernels, and model geometry",
    );
    mount.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(SCENE_COLORS.background, 0.035);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 8.7, 17);
    camera.lookAt(0, -0.4, 0);

    scene.add(new THREE.AmbientLight(0x8aa3b7, 0.65));
    const keyLight = new THREE.DirectionalLight(0xb9ecff, 2.2);
    keyLight.position.set(-6, 10, 8);
    scene.add(keyLight);
    const violetLight = new THREE.PointLight(
      SCENE_COLORS.speculation,
      14,
      18,
    );
    violetLight.position.set(4, 3, -2);
    scene.add(violetLight);

    const unifiedMaterial = new THREE.MeshStandardMaterial({
      color: SCENE_COLORS.graphite,
      emissive: 0x091117,
      metalness: 0.8,
      roughness: 0.38,
      transparent: true,
      opacity: 0.84,
    });
    const unifiedMemory = new THREE.Mesh(
      new THREE.BoxGeometry(17.5, 0.34, 9.5),
      unifiedMaterial,
    );
    unifiedMemory.position.y = -2.1;
    scene.add(unifiedMemory);

    const grid = new THREE.GridHelper(
      17,
      34,
      SCENE_COLORS.graphiteBright,
      SCENE_COLORS.inactive,
    );
    grid.position.y = -1.91;
    grid.scale.z = 0.54;
    scene.add(grid);

    const ssdMaterial = new THREE.MeshStandardMaterial({
      color: 0x252b31,
      emissive: 0x1b1108,
      metalness: 0.92,
      roughness: 0.28,
    });
    const ssd = addBox(
      scene,
      [2.7, 0.9, 4.3],
      [-7.1, -1.2, 0.8],
      ssdMaterial,
    );

    const cpuGroup = new THREE.Group();
    const cpuMaterial = new THREE.MeshStandardMaterial({
      color: 0x26343d,
      emissive: 0x07171d,
      metalness: 0.75,
      roughness: 0.32,
    });
    for (let index = 0; index < 16; index += 1) {
      addBox(
        cpuGroup,
        [0.42, 0.34, 0.42],
        [
          -4.2 + (index % 4) * 0.55,
          -1.48 + Math.floor(index / 8) * 0.42,
          -1.5 + (Math.floor(index / 4) % 2) * 0.58,
        ],
        cpuMaterial,
      );
    }
    scene.add(cpuGroup);

    const gpuGroup = new THREE.Group();
    const kernelMaterial = new THREE.MeshStandardMaterial({
      color: SCENE_COLORS.measured,
      emissive: SCENE_COLORS.measured,
      emissiveIntensity: 0.28,
      metalness: 0.55,
      roughness: 0.24,
    });
    const kernelNodes = [];
    for (let index = 0; index < 24; index += 1) {
      const mesh = addBox(
        gpuGroup,
        [0.34, 0.34 + (index % 3) * 0.08, 0.34],
        [
          4.1 + (index % 6) * 0.5,
          -1.48 + Math.floor(index / 12) * 0.48,
          -1.75 + (Math.floor(index / 6) % 2) * 0.65,
        ],
        kernelMaterial.clone(),
      );
      kernelNodes.push(mesh);
    }
    scene.add(gpuGroup);

    const modelVolume = new THREE.Group();
    const modelMaterial = new THREE.MeshStandardMaterial({
      color: 0x273039,
      emissive: 0x07151a,
      emissiveIntensity: 0.7,
      metalness: 0.68,
      roughness: 0.38,
      transparent: true,
      opacity: 0.78,
    });
    for (let layer = 0; layer < 7; layer += 1) {
      for (let column = 0; column < 9; column += 1) {
        addBox(
          modelVolume,
          [0.27, 0.27, 0.27],
          [
            -1.25 + column * 0.32,
            -1.45 + layer * 0.32,
            -0.15 + Math.sin(column * 1.3 + layer) * 0.5,
          ],
          modelMaterial,
        );
      }
    }
    scene.add(modelVolume);

    const particlePositions = new Float32Array(96 * 3);
    for (let index = 0; index < 96; index += 1) {
      const phase = index / 96;
      particlePositions[index * 3] = -0.2 + phase * 6;
      particlePositions[index * 3 + 1] =
        -0.4 + Math.sin(phase * Math.PI * 8) * 0.8;
      particlePositions[index * 3 + 2] =
        -0.4 + Math.cos(phase * Math.PI * 6) * 1.5;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePositions, 3),
    );
    const particleMaterial = new THREE.PointsMaterial({
      color: SCENE_COLORS.measured,
      size: 0.065,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const cpuRibbon = ribbon(
      [
        [-3.4, -1.25, 0.2],
        [-2.7, 0.2, 0.8],
        [-0.5, -0.7, 0.1],
      ],
      SCENE_COLORS.derived,
    );
    const gpuRibbon = ribbon(
      [
        [0.3, -0.5, 0.1],
        [2.2, 1.1, -0.5],
        [4.8, -0.7, -0.2],
      ],
      SCENE_COLORS.measured,
    );
    scene.add(cpuRibbon, gpuRibbon);

    const speculation = [];
    for (let index = 0; index < 8; index += 1) {
      const line = ribbon(
        [
          [2.1, -0.4, -0.2],
          [3.2, 0.4 + index * 0.2, -1.1 + index * 0.3],
          [5.5, -0.45, -1.4 + index * 0.4],
        ],
        SCENE_COLORS.speculation,
      );
      line.material.opacity = 0.32;
      line.visible = false;
      speculation.push(line);
      scene.add(line);
    }

    activityRef.current = {
      cpuGroup,
      cpuRibbon,
      gpuGroup,
      gpuRibbon,
      kernelNodes,
      modelVolume,
      particleMaterial,
      particles,
      speculation,
      ssd,
      unifiedMaterial,
    };
    const scale = modelRef.current?.model?.normalizedScale ?? 0.6;
    modelVolume.scale.setScalar(scale);
    const speculationWidth =
      modelRef.current?.speculation?.configuredWidth ?? 0;
    speculation.forEach((line, index) => {
      line.visible = index < speculationWidth;
    });

    const resize = () => {
      const width = Math.max(1, mount.clientWidth || 960);
      const height = Math.max(1, mount.clientHeight || 640);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
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
    };
    globalThis.document?.addEventListener("visibilitychange", onVisibility);

    const startedAt = performance.now();
    const render = (now) => {
      animationFrame = globalThis.requestAnimationFrame(render);
      if (!visible) return;
      const activity = activityRef.current;
      const frame = frameRef.current;
      const time = (now - startedAt) / 1_000;
      const motion = reducedMotionRef.current ? 0 : time;
      const mathIntensity = frame?.mathIntensity ?? 0.2;
      const bindingIntensity = frame?.bindingIntensity ?? 0.15;
      const familyColor =
        FAMILY_COLORS[frame?.family] ?? FAMILY_COLORS.other;

      activity.kernelNodes.forEach((node, index) => {
        const active = index % 8 === (frame?.index ?? 0) % 8;
        node.material.color.setHex(active ? familyColor : SCENE_COLORS.graphite);
        node.material.emissive.setHex(
          active ? familyColor : SCENE_COLORS.inactive,
        );
        node.material.emissiveIntensity = active
          ? 0.55 + mathIntensity * 1.3
          : 0.12;
        node.scale.y = active ? 1.35 + mathIntensity * 0.7 : 1;
      });
      activity.particleMaterial.opacity = 0.22 + mathIntensity * 0.72;
      activity.particleMaterial.size = 0.035 + mathIntensity * 0.08;
      activity.particles.rotation.y = motion * 0.18;
      activity.particles.position.x =
        reducedMotionRef.current ? 0 : Math.sin(time * 1.8) * 0.22;
      activity.cpuRibbon.material.opacity = 0.1 + bindingIntensity * 0.62;
      activity.gpuRibbon.material.opacity = 0.18 + bindingIntensity * 0.75;
      activity.unifiedMaterial.emissiveIntensity =
        0.2 + bindingIntensity * 0.75;
      activity.modelVolume.rotation.y = reducedMotionRef.current
        ? -0.08
        : -0.08 + Math.sin(time * 0.22) * 0.07;
      camera.position.x = reducedMotionRef.current
        ? 0
        : Math.sin(time * 0.12) * 0.35;
      camera.lookAt(0, -0.4, 0);
      renderer.render(scene, camera);
    };
    animationFrame = globalThis.requestAnimationFrame(render);

    return () => {
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
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  if (failure) {
    return (
      <div className="observatory-scene-fallback" role="img">
        <span>WebGL scene unavailable</span>
        <small>{failure}</small>
      </div>
    );
  }

  return <div ref={mountRef} className="observatory-scene" />;
}
