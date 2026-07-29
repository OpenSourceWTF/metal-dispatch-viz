import {
  transformerStagesForArchitecture,
} from "./statue-state.js";

const PALETTE = Object.freeze({
  cyan: 0x68e7ff,
  cyanSoft: 0x1b8fa8,
  blue: 0x5a83ff,
  attention: 0x9eb8ff,
  white: 0xe9fbff,
  amber: 0xffb45d,
  amberSoft: 0x9b542c,
  magenta: 0xff5ebc,
  violet: 0xa974ff,
  dark: 0x07111c,
});

const GLYPH_FAMILIES = Object.freeze([
  "attention",
  "projection",
  "normalization",
  "routing",
  "activation",
  "residual",
  "embedding-output",
  "transfer-binding",
  "other",
]);

function luminousMaterial(
  THREE,
  color,
  {
    opacity = 1,
    emissiveIntensity = 1,
    metalness = 0.38,
    roughness = 0.26,
    wireframe = false,
    blending,
  } = {},
) {
  const parameters = {
    color,
    emissive: color,
    emissiveIntensity,
    metalness,
    roughness,
    wireframe,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  };
  if (blending !== undefined) parameters.blending = blending;
  return new THREE.MeshStandardMaterial(parameters);
}

function lineMaterial(THREE, color, opacity = 0.5) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function addMesh(group, geometry, material, position = [0, 0, 0]) {
  const Mesh = group.userData.THREE.Mesh;
  const object = new Mesh(geometry, material);
  object.position.set(...position);
  group.add(object);
  return object;
}

function groupFor(THREE) {
  const group = new THREE.Group();
  group.userData.THREE = THREE;
  return group;
}

function architectureDimensions(presentation) {
  const architecture = presentation.architecture;
  const layerCount = Math.max(1, architecture.layerCount);
  const hiddenSize = Math.max(1, architecture.hiddenSize ?? 1);
  const queryHeads = Math.max(1, architecture.attention?.queryHeads ?? 8);
  const keyValueHeads = Math.max(
    1,
    architecture.attention?.keyValueHeads ?? queryHeads,
  );
  const width = Math.min(2.4, Math.max(1.5, Math.sqrt(hiddenSize) / 30));
  const attentionRatio = Math.min(1, keyValueHeads / queryHeads);
  const layerPitch = 0.9;
  const stages = transformerStagesForArchitecture(architecture);
  return {
    height: architecture.available ? layerCount * layerPitch : 6.4,
    layerPitch,
    stagePitch: layerPitch / stages.length,
    stages,
    width,
    depth: width * (0.72 + attentionRatio * 0.18),
    facets: Math.min(32, Math.max(8, queryHeads)),
  };
}

function stageAppearance(stage, feedForwardKind) {
  if (stage.includes("norm")) {
    return {
      color: PALETTE.cyan,
      opacity: 0.055,
      radius: 0.76,
      tube: 0.008,
    };
  }
  if (stage === "attention") {
    return {
      color: PALETTE.attention,
      opacity: 0.18,
      radius: 1.08,
      tube: 0.015,
    };
  }
  if (stage === "router") {
    return {
      color: PALETTE.magenta,
      opacity: 0.16,
      radius: 0.96,
      tube: 0.014,
    };
  }
  if (stage === "feed-forward") {
    return {
      color:
        feedForwardKind === "moe" ? PALETTE.violet : PALETTE.amber,
      opacity: 0.16,
      radius: feedForwardKind === "moe" ? 1.12 : 1.02,
      tube: 0.015,
    };
  }
  return {
    color: PALETTE.white,
    opacity: 0.05,
    radius: 0.9,
    tube: 0.007,
  };
}

function createStageBands(THREE, presentation, dimensions) {
  const layerCount = presentation.architecture.layerCount;
  const transform = new THREE.Object3D();
  return dimensions.stages.map((stage, stageIndex) => {
    const appearance = stageAppearance(
      stage,
      presentation.architecture.feedForwardKind,
    );
    const mesh = new THREE.InstancedMesh(
      new THREE.TorusGeometry(
        1,
        appearance.tube,
        5,
        Math.max(32, dimensions.facets * 2),
      ),
      luminousMaterial(THREE, appearance.color, {
        opacity: appearance.opacity,
        emissiveIntensity: stage.includes("residual") ? 0.42 : 0.7,
        metalness: 0.2,
        roughness: 0.15,
      }),
      Math.max(1, layerCount),
    );
    mesh.count = layerCount;
    mesh.name = `CONFIGURED_STAGE_${stage.toUpperCase()}`;
    mesh.userData.stage = stage;
    mesh.userData.stageIndex = stageIndex;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
      const stageOrdinal =
        layerIndex * dimensions.stages.length + stageIndex + 0.5;
      const y =
        dimensions.height / 2 - stageOrdinal * dimensions.stagePitch;
      const ratio =
        layerCount <= 1 ? 0.5 : layerIndex / (layerCount - 1);
      const silhouette = 0.92 + Math.sin(ratio * Math.PI) * 0.1;
      transform.position.set(0, y, 0);
      transform.rotation.set(Math.PI / 2, 0, 0);
      transform.scale.set(
        dimensions.width * silhouette * appearance.radius,
        dimensions.depth * silhouette * appearance.radius,
        1,
      );
      transform.updateMatrix();
      mesh.setMatrixAt(layerIndex, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, stage, stageIndex };
  });
}

function createLayerBody(THREE, presentation) {
  const group = groupFor(THREE);
  group.name = "LLM_LAYER_STACK";
  const scrollGroup = groupFor(THREE);
  scrollGroup.name = "SCROLLING_TRANSFORMER_COLUMN";
  group.add(scrollGroup);
  const count = presentation.architecture.layerCount;
  const dimensions = architectureDimensions(presentation);
  const geometry = new THREE.CylinderGeometry(
    1,
    1,
    0.025,
    dimensions.facets,
    1,
  );
  const material = luminousMaterial(THREE, PALETTE.cyan, {
    opacity: 0.018,
    emissiveIntensity: 0.26,
    metalness: 0.58,
    roughness: 0.18,
  });
  const layers = new THREE.InstancedMesh(
    geometry,
    material,
    Math.max(1, count),
  );
  layers.count = count;
  layers.name = "CONFIGURED_TRANSFORMER_LAYERS";
  layers.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const fullAttentionCount =
    presentation.architecture.layerTypes.filter(
      (layerType) => layerType === "full_attention",
    ).length;
  const attentionAccents = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(
      1,
      1,
      0.065,
      dimensions.facets,
      1,
    ),
    luminousMaterial(THREE, PALETTE.attention, {
      opacity: 0.065,
      emissiveIntensity: 0.34,
      metalness: 0.28,
      roughness: 0.16,
    }),
    Math.max(1, fullAttentionCount),
  );
  attentionAccents.count = fullAttentionCount;
  attentionAccents.name = "FULL_ATTENTION_LAYER_ACCENTS";

  const transform = new THREE.Object3D();
  const fullAttention = new THREE.Color(PALETTE.attention);
  const linearAttention = new THREE.Color(PALETTE.cyanSoft);
  const height = dimensions.height;
  let attentionAccentIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const ratio = count <= 1 ? 0.5 : index / (count - 1);
    const y = height / 2 - (index + 0.5) * dimensions.layerPitch;
    const silhouette = 0.92 + Math.sin(ratio * Math.PI) * 0.1;
    const full =
      presentation.architecture.layerTypes[index] === "full_attention";
    transform.position.set(0, y, 0);
    transform.rotation.set(0, 0, 0);
    const attentionScale = full ? 1.12 : 1;
    transform.scale.set(
      dimensions.width * silhouette * attentionScale,
      1,
      dimensions.depth * silhouette * attentionScale,
    );
    transform.updateMatrix();
    layers.setMatrixAt(index, transform.matrix);
    layers.setColorAt(
      index,
      full ? fullAttention : linearAttention,
    );
    if (full) {
      attentionAccents.setMatrixAt(
        attentionAccentIndex,
        transform.matrix,
      );
      attentionAccentIndex += 1;
    }
  }
  layers.instanceMatrix.needsUpdate = true;
  if (layers.instanceColor) layers.instanceColor.needsUpdate = true;
  attentionAccents.instanceMatrix.needsUpdate = true;
  const stageBands = createStageBands(THREE, presentation, dimensions);
  scrollGroup.add(
    layers,
    attentionAccents,
    ...stageBands.map(({ mesh }) => mesh),
  );

  const coreMaterial = luminousMaterial(THREE, PALETTE.blue, {
    opacity: 0.055,
    emissiveIntensity: 0.48,
    metalness: 0.8,
    roughness: 0.18,
    wireframe: true,
  });
  const core = addMesh(
    scrollGroup,
    new THREE.CylinderGeometry(
      dimensions.width * 0.34,
      dimensions.width * 0.46,
      height + 0.8,
      dimensions.facets,
      Math.max(8, Math.round(count / 2)),
      true,
    ),
    coreMaterial,
  );
  core.name = "MODEL_LATENT_VOLUME";

  const activeLayer = groupFor(THREE);
  activeLayer.name = "ACTIVE_LAYER_APERTURE";
  const scannerPlane = addMesh(
    activeLayer,
    new THREE.CylinderGeometry(
      dimensions.width * 1.12,
      dimensions.width * 1.12,
      0.018,
      64,
    ),
    luminousMaterial(THREE, PALETTE.white, {
      opacity: 0.018,
      emissiveIntensity: 0.3,
      metalness: 0.08,
      roughness: 0.12,
    }),
  );
  scannerPlane.name = "ACTIVE_SCANNING_PLANE";
  const scannerRing = addMesh(
    activeLayer,
    new THREE.TorusGeometry(dimensions.width * 1.16, 0.036, 8, 96),
    luminousMaterial(THREE, PALETTE.white, {
      opacity: 0.46,
      emissiveIntensity: 0.78,
      metalness: 0.2,
      roughness: 0.15,
    }),
  );
  scannerRing.rotation.x = Math.PI / 2;
  scannerRing.name = "ACTIVE_SCANNING_RING";
  group.add(activeLayer);

  const input = addMesh(
    scrollGroup,
    new THREE.CylinderGeometry(
      dimensions.width * 0.7,
      dimensions.width * 0.96,
      0.18,
      48,
      1,
      true,
    ),
    luminousMaterial(THREE, PALETTE.cyan, {
      opacity: 0.44,
      emissiveIntensity: 1.4,
      wireframe: true,
    }),
    [0, height / 2 + 0.52, 0],
  );
  input.name = "TOKEN_EMBEDDING_APERTURE";

  const output = addMesh(
    scrollGroup,
    new THREE.CylinderGeometry(
      dimensions.width * 0.96,
      dimensions.width * 0.7,
      0.24,
      64,
      1,
      true,
    ),
    luminousMaterial(THREE, PALETTE.amber, {
      opacity: 0.55,
      emissiveIntensity: 1.6,
      wireframe: true,
    }),
    [0, -height / 2 - 0.52, 0],
  );
  output.name = "VOCABULARY_APERTURE";

  group.userData.height = height;
  group.userData.width = dimensions.width;
  group.userData.dimensions = dimensions;
  scrollGroup.userData.targetY = 0;
  scrollGroup.userData.lastAnimationTime = null;
  return {
    group,
    scrollGroup,
    layers,
    attentionAccents,
    stageBands,
    core,
    activeLayer,
    input,
    output,
  };
}

function createExpertField(THREE, presentation, dimensions) {
  const group = groupFor(THREE);
  group.name = "MOE_EXPERT_BANDS";
  const expertsPerLayer =
    presentation.architecture.feedForward?.kind === "moe"
      ? presentation.architecture.feedForward.experts
      : 0;
  const layerCount =
    expertsPerLayer > 0 ? presentation.architecture.layerCount : 0;
  const totalInstances = layerCount * expertsPerLayer;
  const geometry = new THREE.BoxGeometry(
    0.035,
    dimensions.stagePitch * 0.36,
    0.085,
  );
  const material = luminousMaterial(THREE, PALETTE.violet, {
    opacity: 0.1,
    emissiveIntensity: 0.36,
    metalness: 0.25,
    roughness: 0.28,
  });
  const experts = new THREE.InstancedMesh(
    geometry,
    material,
    Math.max(1, totalInstances),
  );
  experts.count = totalInstances;
  experts.name = "CONFIGURED_EXPERT_BANDS";
  experts.userData.expertsPerLayer = expertsPerLayer;
  experts.userData.activeInstances = [];
  const transform = new THREE.Object3D();
  const dormant = new THREE.Color(0x241633);
  const feedForwardStageIndex =
    dimensions.stages.indexOf("feed-forward");
  const radius = dimensions.width * 1.34;
  const positionFor = (layerIndex, expertIndex) => {
    const stageOrdinal =
      layerIndex * dimensions.stages.length +
      feedForwardStageIndex +
      0.5;
    const y =
      dimensions.height / 2 - stageOrdinal * dimensions.stagePitch;
    const angle =
      (expertIndex / Math.max(1, expertsPerLayer)) * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    );
  };
  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    for (
      let expertIndex = 0;
      expertIndex < expertsPerLayer;
      expertIndex += 1
    ) {
      const instanceIndex =
        layerIndex * expertsPerLayer + expertIndex;
      const position = positionFor(layerIndex, expertIndex);
      const angle =
        (expertIndex / Math.max(1, expertsPerLayer)) * Math.PI * 2;
      transform.position.copy(position);
      transform.rotation.set(0, -angle, 0);
      transform.updateMatrix();
      experts.setMatrixAt(instanceIndex, transform.matrix);
      experts.setColorAt(instanceIndex, dormant);
    }
  }
  experts.instanceMatrix.needsUpdate = true;
  if (experts.instanceColor) experts.instanceColor.needsUpdate = true;
  group.add(experts);

  const shared = addMesh(
    group,
    new THREE.TorusKnotGeometry(0.38, 0.025, 96, 8, 2, 3),
    luminousMaterial(THREE, PALETTE.magenta, {
      opacity: expertsPerLayer > 0 ? 0.24 : 0,
      emissiveIntensity: 0.9,
      wireframe: true,
    }),
  );
  shared.name = "SHARED_EXPERT";
  shared.visible = false;
  return { group, experts, shared, positionFor };
}

function createExpertRouteFan(THREE, presentation, expertPositionFor) {
  const group = groupFor(THREE);
  group.name = "MOE_CONFIGURED_ROUTE_FAN";
  const fanout =
    presentation.architecture.feedForward?.kind === "moe"
      ? presentation.architecture.feedForward.expertsPerToken
      : 0;
  const routes = [];
  for (let index = 0; index < fanout; index += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    const route = new THREE.Line(
      geometry,
      lineMaterial(THREE, PALETTE.magenta, 0.58),
    );
    route.name = `MOE_CONFIGURED_ROUTE_${index + 1}`;
    route.visible = false;
    route.frustumCulled = false;
    route.renderOrder = 6;
    route.material.depthTest = false;
    group.add(route);
    routes.push(route);
  }
  group.visible = false;
  group.userData.expertPositionFor = expertPositionFor;
  group.userData.routedExpertCount = 0;
  return { group, routes };
}

function createMemoryCube(THREE) {
  const group = groupFor(THREE);
  group.name = "UNIFIED_MEMORY_CUBE";
  group.position.set(-3.7, -2.65, 0.25);
  const elements = [];
  [1.4, 1.08].forEach((size, index) => {
    const shell = addMesh(
      group,
      new THREE.BoxGeometry(size, size, size),
      luminousMaterial(THREE, index === 1 ? PALETTE.blue : PALETTE.cyan, {
        opacity: index === 0 ? 0.2 : 0.1,
        emissiveIntensity: 0.9,
        metalness: 0.42,
        roughness: 0.16,
        wireframe: true,
      }),
    );
    shell.rotation.set(index * 0.16, index * 0.22, index * 0.08);
    elements.push(shell);
  });
  for (let index = 0; index < 4; index += 1) {
    const bank = addMesh(
      group,
      new THREE.BoxGeometry(0.92, 0.045, 0.92),
      luminousMaterial(THREE, PALETTE.cyan, {
        opacity: 0.13,
        emissiveIntensity: 0.58,
        metalness: 0.5,
        roughness: 0.18,
      }),
      [0, (index - 1.5) * 0.23, 0],
    );
    elements.push(bank);
  }
  group.userData.active = false;
  return { group, elements };
}

function createHardwareOrbitals(THREE) {
  const cpu = groupFor(THREE);
  cpu.name = "CPU_CONTROL_ORBITAL";
  const cpuCore = addMesh(
    cpu,
    new THREE.IcosahedronGeometry(0.34, 1),
    luminousMaterial(THREE, PALETTE.white, {
      opacity: 0.68,
      emissiveIntensity: 0.82,
      wireframe: true,
    }),
  );
  const cpuRing = addMesh(
    cpu,
    new THREE.TorusGeometry(0.62, 0.025, 6, 64),
    luminousMaterial(THREE, PALETTE.cyan, {
      opacity: 0.4,
      emissiveIntensity: 1.6,
    }),
  );
  cpuRing.rotation.x = Math.PI / 2;
  cpu.position.set(-3.7, 2.65, 0.4);

  const gpu = groupFor(THREE);
  gpu.name = "GPU_EXECUTION_ORBITAL";
  const lanes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.24, 0.24, 0.24),
    luminousMaterial(THREE, PALETTE.amber, {
      opacity: 0.68,
      emissiveIntensity: 1.08,
      metalness: 0.7,
      roughness: 0.18,
    }),
    16,
  );
  const transform = new THREE.Object3D();
  for (let index = 0; index < 16; index += 1) {
    const x = (index % 4 - 1.5) * 0.34;
    const y = (Math.floor(index / 4) - 1.5) * 0.34;
    transform.position.set(x, y, Math.sin(index * 1.7) * 0.12);
    transform.rotation.set(index * 0.19, index * 0.13, index * 0.07);
    transform.updateMatrix();
    lanes.setMatrixAt(index, transform.matrix);
  }
  lanes.instanceMatrix.needsUpdate = true;
  gpu.add(lanes);
  const gpuCage = addMesh(
    gpu,
    new THREE.IcosahedronGeometry(1.15, 1),
    luminousMaterial(THREE, PALETTE.amberSoft, {
      opacity: 0.25,
      emissiveIntensity: 0.8,
      wireframe: true,
    }),
  );
  gpu.position.set(3.7, -2.65, 0.5);

  cpu.userData.dispatchPulse = false;
  gpu.userData.active = false;
  return { cpu, cpuCore, cpuRing, gpu, gpuCage, lanes };
}

function tubeBetween(THREE, points, color) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(...point)),
  );
  const material = luminousMaterial(THREE, color, {
    opacity: 0.18,
    emissiveIntensity: 1.7,
    metalness: 0.1,
    roughness: 0.1,
  });
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 72, 0.025, 6, false),
    material,
  );
  return { curve, material, mesh };
}

function createRibbons(THREE) {
  const ribbons = [
    tubeBetween(
      THREE,
      [
        [-3.7, -2.65, 0.25],
        [-3.0, -1.6, 1.25],
        [-1.7, -0.35, 1.05],
        [0, 0, 0],
      ],
      PALETTE.cyan,
    ),
    tubeBetween(
      THREE,
      [
        [-3.7, 2.65, 0.4],
        [-3.0, 2.05, 1.25],
        [-1.55, 0.8, 0.8],
        [0, 0, 0],
      ],
      PALETTE.white,
    ),
    tubeBetween(
      THREE,
      [
        [0, 0, 0],
        [1.6, -0.75, 1.35],
        [2.8, -2.35, 1.1],
        [3.7, -2.65, 0.5],
      ],
      PALETTE.amber,
    ),
  ];
  ribbons.forEach(({ mesh }) => {
    mesh.userData.anchor = "ACTIVE_LAYER_APERTURE";
  });
  return ribbons;
}

function createSpeculationBranches(THREE) {
  const group = groupFor(THREE);
  group.name = "CONFIGURED_SPECULATION";
  const branches = [];
  for (let index = 0; index < 8; index += 1) {
    const side = index % 2 === 0 ? 1 : -1;
    const tier = Math.floor(index / 2);
    const points = [
      new THREE.Vector3(0, 4.2, 0),
      new THREE.Vector3(
        side * (1.2 + tier * 0.35),
        4.9 + tier * 0.18,
        0.4 + tier * 0.24,
      ),
      new THREE.Vector3(
        side * (2.2 + tier * 0.52),
        5.65 + tier * 0.28,
        0.8 + tier * 0.36,
      ),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(
      curve,
      36,
      0.012,
      4,
      false,
    );
    const material = luminousMaterial(THREE, PALETTE.violet, {
      opacity: 0.2,
      emissiveIntensity: 0.72,
      metalness: 0.08,
      roughness: 0.12,
    });
    const branch = new THREE.Mesh(geometry, material);
    branch.name = `CONFIGURED_SPECULATION_BRANCH_${index + 1}`;
    branch.visible = false;
    branch.userData.index = index;
    group.add(branch);
    branches.push(branch);
  }
  group.userData.configuredWidth = 0;
  return { group, branches };
}

function ringGlyph(THREE, color, count = 3) {
  const group = groupFor(THREE);
  for (let index = 0; index < count; index += 1) {
    const ring = addMesh(
      group,
      new THREE.TorusGeometry(0.48 + index * 0.18, 0.022, 6, 72),
      luminousMaterial(THREE, color, {
        opacity: 0.72 - index * 0.12,
        emissiveIntensity: 1.8,
      }),
    );
    ring.rotation.set(
      index * 0.53,
      index * 0.31,
      index * Math.PI / count,
    );
  }
  return group;
}

function matrixGlyph(THREE, color) {
  const group = groupFor(THREE);
  for (let index = 0; index < 12; index += 1) {
    const cell = addMesh(
      group,
      new THREE.BoxGeometry(0.19, 0.19, 0.08),
      luminousMaterial(THREE, color, {
        opacity: 0.52 + (index % 3) * 0.14,
        emissiveIntensity: 1.2 + (index % 4) * 0.2,
        metalness: 0.6,
      }),
      [
        (index % 4 - 1.5) * 0.25,
        (Math.floor(index / 4) - 1) * 0.25,
        Math.sin(index * 2.2) * 0.12,
      ],
    );
    cell.rotation.y = index * 0.08;
  }
  return group;
}

function bridgeGlyph(THREE, color) {
  const group = groupFor(THREE);
  [
    [new THREE.BoxGeometry(0.12, 0.82, 0.12), [-0.38, 0, 0]],
    [new THREE.BoxGeometry(0.12, 0.82, 0.12), [0.38, 0, 0]],
    [new THREE.BoxGeometry(0.76, 0.1, 0.12), [0, 0, 0]],
  ].forEach(([geometry, position], index) => {
    const segment = addMesh(
      group,
      geometry,
      luminousMaterial(THREE, color, {
        opacity: 0.64,
        emissiveIntensity: 1.25,
        metalness: 0.5,
        roughness: 0.18,
      }),
      position,
    );
    segment.rotation.y = (index - 1) * 0.12;
  });
  return group;
}

function createKernelGlyphs(THREE) {
  const kernel = groupFor(THREE);
  kernel.name = "ACTIVE_KERNEL_GLYPH";
  kernel.position.set(3.7, 2.65, 1.1);
  const cage = addMesh(
    kernel,
    new THREE.IcosahedronGeometry(1.1, 2),
    luminousMaterial(THREE, PALETTE.white, {
      opacity: 0.11,
      emissiveIntensity: 0.8,
      wireframe: true,
    }),
  );
  const glyphs = {
    attention: ringGlyph(THREE, PALETTE.cyan, 4),
    projection: matrixGlyph(THREE, PALETTE.amber),
    normalization: ringGlyph(THREE, PALETTE.white, 2),
    routing: ringGlyph(THREE, PALETTE.magenta, 5),
    activation: (() => {
      const group = groupFor(THREE);
      const flame = addMesh(
        group,
        new THREE.ConeGeometry(0.58, 1.2, 7, 2, true),
        luminousMaterial(THREE, PALETTE.amber, {
          opacity: 0.72,
          emissiveIntensity: 2,
          wireframe: true,
        }),
      );
      flame.rotation.z = Math.PI;
      return group;
    })(),
    residual: bridgeGlyph(THREE, PALETTE.white),
    "embedding-output": ringGlyph(THREE, PALETTE.violet, 6),
    "transfer-binding": matrixGlyph(THREE, PALETTE.cyan),
    other: (() => {
      const group = groupFor(THREE);
      addMesh(
        group,
        new THREE.CapsuleGeometry(0.35, 0.65, 6, 16),
        luminousMaterial(THREE, PALETTE.white, {
          opacity: 0.5,
          emissiveIntensity: 1.3,
          wireframe: true,
        }),
      );
      return group;
    })(),
  };
  for (const family of GLYPH_FAMILIES) {
    const glyph = glyphs[family];
    glyph.name = `KERNEL_${family.toUpperCase()}`;
    glyph.visible = false;
    kernel.add(glyph);
  }
  kernel.userData.exactName = "Awaiting dispatch";
  return { kernel, cage, glyphs };
}

function createParticleField(THREE) {
  const count = 240;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const ring = index % 24;
    const tier = Math.floor(index / 24);
    const angle = ring * (Math.PI * 2 / 24) + tier * 0.29;
    seeds[index * 3] = angle;
    seeds[index * 3 + 1] = tier / 9;
    seeds[index * 3 + 2] = 0.65 + (index % 7) * 0.08;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  const material = new THREE.PointsMaterial({
    color: PALETTE.white,
    size: 0.034,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "MATH_OPERATION_PARTICLES";
  points.userData.seeds = seeds;
  return points;
}

function createActivationFlow(THREE) {
  const group = groupFor(THREE);
  group.name = "ACTIVATION_FOCAL_FLOW";
  const positions = new Float32Array([
    0,
    0.7,
    0,
    0,
    -0.7,
    0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  const material = lineMaterial(THREE, PALETTE.cyan, 0.78);
  const path = new THREE.Line(geometry, material);
  path.name = "ACTIVATION_PATH";
  group.add(path);

  const courier = addMesh(
    group,
    new THREE.OctahedronGeometry(0.16, 0),
    luminousMaterial(THREE, PALETTE.white, {
      opacity: 0.96,
      emissiveIntensity: 2.1,
      metalness: 0.16,
      roughness: 0.12,
    }),
    [0, 0, 0],
  );
  courier.name = "ACTIVE_TENSOR_COURIER";
  return { group, path, courier };
}

function updateLayerColors(statue, presentation) {
  const layers = statue.parts.layers;
  const active = new statue.THREE.Color(PALETTE.white);
  const full = new statue.THREE.Color(PALETTE.blue);
  const linear = new statue.THREE.Color(PALETTE.cyanSoft);
  for (let index = 0; index < layers.count; index += 1) {
    layers.setColorAt(
      index,
      index === presentation.activation.layerIndex
        ? active
        : presentation.architecture.layerTypes[index] === "full_attention"
          ? full
          : linear,
    );
  }
  if (layers.instanceColor) layers.instanceColor.needsUpdate = true;
}

function updateExperts(statue, presentation, activationY) {
  const experts = statue.parts.experts;
  if (experts.count === 0) return;
  const routingActive =
    presentation.activation.stage === "router" ||
    presentation.activation.stage === "feed-forward";
  const routedIndices = routingActive
    ? presentation.experts.illuminatedIndices
    : [];
  const active = new statue.THREE.Color(PALETTE.magenta);
  const dormant = new statue.THREE.Color(0x241633);
  for (const instanceIndex of experts.userData.activeInstances) {
    experts.setColorAt(instanceIndex, dormant);
  }
  const layerIndex = presentation.activation.layerIndex ?? 0;
  const activeInstances = routedIndices.map(
    (expertIndex) =>
      layerIndex * experts.userData.expertsPerLayer + expertIndex,
  );
  for (const instanceIndex of activeInstances) {
    experts.setColorAt(instanceIndex, active);
  }
  experts.userData.activeInstances = activeInstances;
  if (experts.instanceColor) experts.instanceColor.needsUpdate = true;
  experts.material.opacity = routingActive ? 0.24 : 0.08;
  experts.material.emissiveIntensity = routingActive ? 0.72 : 0.22;
  statue.parts.sharedExpert.position.y = activationY;
  statue.parts.sharedExpert.visible =
    presentation.activation.stage === "feed-forward" &&
    presentation.experts.sharedExpert;
  statue.parts.expertRouteFan.visible =
    routingActive && routedIndices.length > 0;
  statue.parts.expertRouteFan.userData.routedExpertCount =
    routingActive ? routedIndices.length : 0;
  statue.parts.expertRoutes.forEach((route, index) => {
    const expertIndex = routedIndices[index];
    const endpoint =
      expertIndex === undefined
        ? null
        : statue.parts.expertPositionFor(layerIndex, expertIndex);
    route.visible = routingActive && endpoint !== null;
    if (endpoint === null) return;
    const positions = route.geometry.getAttribute("position");
    positions.setXYZ(0, 0, activationY, 0);
    positions.setXYZ(1, endpoint.x, endpoint.y, endpoint.z);
    positions.needsUpdate = true;
    route.geometry.computeBoundingSphere();
  });
}

export function applyStatuePresentation(statue, presentation) {
  statue.presentation = presentation;
  statue.root.userData.architectureAvailable =
    presentation.architecture.available;
  statue.root.userData.activeLayer = presentation.activation.layerIndex;
  statue.root.userData.activeStage = presentation.activation.stage;

  const dimensions = statue.parts.bodyDimensions;
  const activeLayerIndex = presentation.activation.layerIndex ?? 0;
  const activeStageIndex = presentation.activation.stageIndex ?? 0;
  const stageOrdinal =
    activeLayerIndex * dimensions.stages.length +
    activeStageIndex +
    0.5;
  const activationY =
    dimensions.height / 2 - stageOrdinal * dimensions.stagePitch;
  const targetScrollY = -activationY;
  statue.parts.scrollGroup.userData.targetY = targetScrollY;
  if (statue.parts.scrollGroup.userData.initialized !== true) {
    statue.parts.scrollGroup.position.y = targetScrollY;
    statue.parts.scrollGroup.userData.initialized = true;
  }
  statue.parts.activeLayer.position.y = 0;
  statue.parts.activeLayer.visible = presentation.architecture.available;
  const activeStageAppearance = stageAppearance(
    presentation.activation.stage ?? "pre-attention-norm",
    presentation.architecture.feedForwardKind,
  );
  statue.parts.activeLayer.userData.stageScale =
    0.88 + activeStageAppearance.radius * 0.12;
  updateLayerColors(statue, presentation);
  updateExperts(statue, presentation, activationY);
  statue.parts.activationCourier.position.y = 0;
  statue.parts.activationCourier.visible =
    presentation.architecture.available;

  statue.parts.memory.userData.active =
    presentation.hardware.memory.active;
  statue.parts.memory.scale.setScalar(
    presentation.hardware.memory.haloScale,
  );
  statue.parts.memoryRings.forEach((ring, index) => {
    ring.material.opacity = presentation.hardware.memory.active
      ? index === 0
        ? 0.24
        : 0.12
      : index === 0
        ? 0.08
        : 0.035;
  });

  statue.parts.cpu.userData.dispatchPulse =
    presentation.hardware.cpu.dispatchPulse;
  statue.parts.gpu.userData.active = presentation.hardware.gpu.active;
  statue.parts.gpuLanes.count = presentation.hardware.gpu.laneCount;

  statue.parts.kernel.userData.exactName = presentation.kernel.exactName;
  statue.parts.kernel.scale.setScalar(0.76);
  for (const [family, glyph] of Object.entries(statue.parts.glyphs)) {
    glyph.visible = family === presentation.kernel.family;
  }

  statue.parts.ribbons.forEach(({ material }, index) => {
    const active =
      index === 0
        ? presentation.hardware.memory.active
        : index === 1
          ? presentation.hardware.cpu.dispatchPulse
          : presentation.hardware.gpu.active;
    material.opacity = active ? 0.42 : 0.045;
  });
  statue.parts.particles.visible = presentation.hardware.gpu.active;
  statue.parts.particles.material.opacity =
    0.12 + presentation.hardware.gpu.laneCount / 80;
  statue.parts.speculation.userData.configuredWidth =
    presentation.speculation.width;
  statue.parts.speculationBranches.forEach((branch, index) => {
    branch.visible =
      presentation.speculation.visible &&
      index < Math.min(
        presentation.speculation.width,
        statue.parts.speculationBranches.length,
      );
  });
}

export function animateStatueGeometry(
  statue,
  elapsedSeconds,
  { reducedMotion = false } = {},
) {
  const time = reducedMotion ? 0 : elapsedSeconds;
  const presentation = statue.presentation;
  if (!presentation) return;

  const scrollGroup = statue.parts.scrollGroup;
  const previousTime = scrollGroup.userData.lastAnimationTime;
  const deltaSeconds =
    previousTime === null
      ? 0
      : Math.min(0.1, Math.max(0, elapsedSeconds - previousTime));
  scrollGroup.userData.lastAnimationTime = elapsedSeconds;
  if (reducedMotion) {
    scrollGroup.position.y = scrollGroup.userData.targetY;
  } else if (deltaSeconds > 0) {
    scrollGroup.position.y = statue.THREE.MathUtils.damp(
      scrollGroup.position.y,
      scrollGroup.userData.targetY,
      8,
      deltaSeconds,
    );
  }

  statue.parts.memory.rotation.y = time * 0.08;
  statue.parts.memory.rotation.x = Math.sin(time * 0.12) * 0.08;
  statue.parts.cpu.rotation.y = time * 0.62;
  statue.parts.gpu.rotation.y = -time * 0.31;
  statue.parts.kernel.rotation.z = Math.sin(time * 0.42) * 0.08;
  statue.parts.kernel.rotation.y = time * 0.08;
  statue.parts.activationCourier.position.y = reducedMotion
    ? 0
    : 0.45 - ((time * 0.7) % 1) * 0.9;
  statue.parts.activationCourier.rotation.x = time * 1.7;
  statue.parts.activationCourier.rotation.y = time * 2.1;
  statue.parts.sharedExpert.rotation.x = time * 0.48;
  statue.parts.sharedExpert.rotation.y = time * 0.72;
  statue.parts.expertRoutes.forEach((route, index) => {
    route.material.opacity =
      0.46 +
      Math.max(0, Math.sin(time * 3.4 - index * 0.48)) * 0.28;
  });
  statue.parts.speculationBranches.forEach((branch, index) => {
    branch.material.opacity =
      0.18 + Math.max(0, Math.sin(time * 1.8 - index * 0.7)) * 0.34;
  });

  const dispatchPulse =
    presentation.hardware.cpu.dispatchPulse &&
    !reducedMotion
      ? 1 + Math.max(0, Math.sin(time * 8)) * 0.22
      : 1;
  statue.parts.cpu.scale.setScalar(dispatchPulse);
  const layerPulse = reducedMotion
    ? 1
    : 1 + Math.sin(time * 4.2) * 0.035;
  statue.parts.activeLayer.scale.setScalar(
    (statue.parts.activeLayer.userData.stageScale ?? 1) * layerPulse,
  );

  const attribute = statue.parts.particles.geometry.getAttribute("position");
  const seeds = statue.parts.particles.userData.seeds;
  const activeY = 0;
  for (let index = 0; index < attribute.count; index += 1) {
    const angle = seeds[index * 3] + time * (1.2 + (index % 5) * 0.07);
    const phase = (seeds[index * 3 + 1] + time * 0.31) % 1;
    const radius = seeds[index * 3 + 2];
    attribute.setXYZ(
      index,
      Math.cos(angle) * radius,
      activeY + (phase - 0.5) * 0.72,
      Math.sin(angle) * radius,
    );
  }
  attribute.needsUpdate = true;
}

export function createStatueGeometry(THREE, presentation) {
  const root = groupFor(THREE);
  root.name = "SILICON_OBSERVATORY_STATUE";

  const body = createLayerBody(THREE, presentation);
  const expertField = createExpertField(
    THREE,
    presentation,
    body.group.userData.dimensions,
  );
  const expertRouteFan = createExpertRouteFan(
    THREE,
    presentation,
    expertField.positionFor,
  );
  body.scrollGroup.add(expertField.group, expertRouteFan.group);
  const memory = createMemoryCube(THREE);
  const hardware = createHardwareOrbitals(THREE);
  const glyph = createKernelGlyphs(THREE);
  const ribbons = createRibbons(THREE);
  const speculation = createSpeculationBranches(THREE);
  const particles = createParticleField(THREE);
  const activationFlow = createActivationFlow(THREE);
  root.add(
    body.group,
    memory.group,
    hardware.cpu,
    hardware.gpu,
    glyph.kernel,
    speculation.group,
    activationFlow.group,
    particles,
  );
  for (const ribbon of ribbons) root.add(ribbon.mesh);

  const statue = {
    THREE,
    root,
    presentation,
    parts: {
      layers: body.layers,
      attentionAccents: body.attentionAccents,
      stageBands: body.stageBands,
      scrollGroup: body.scrollGroup,
      experts: expertField.experts,
      sharedExpert: expertField.shared,
      expertPositionFor: expertField.positionFor,
      expertRouteFan: expertRouteFan.group,
      expertRoutes: expertRouteFan.routes,
      activeLayer: body.activeLayer,
      bodyHeight: body.group.userData.height,
      bodyDimensions: body.group.userData.dimensions,
      memory: memory.group,
      memoryRings: memory.elements,
      cpu: hardware.cpu,
      cpuCore: hardware.cpuCore,
      gpu: hardware.gpu,
      gpuLanes: hardware.lanes,
      kernel: glyph.kernel,
      kernelCage: glyph.cage,
      glyphs: glyph.glyphs,
      ribbons,
      speculation: speculation.group,
      speculationBranches: speculation.branches,
      activationPath: activationFlow.path,
      activationCourier: activationFlow.courier,
      particles,
    },
    geometryIdentities() {
      const identities = [];
      root.traverse((object) => {
        if (object.geometry?.uuid) identities.push(object.geometry.uuid);
      });
      return identities.sort();
    },
  };
  applyStatuePresentation(statue, presentation);
  return statue;
}

export function disposeStatueGeometry(statue) {
  const geometries = new Set();
  const materials = new Set();
  statue?.root?.traverse?.((object) => {
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

export { PALETTE as STATUE_PALETTE };
