import { TRANSFORMER_STAGES } from "./statue-state.js";

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

function createLayerBody(THREE, presentation) {
  const group = groupFor(THREE);
  group.name = "LLM_LAYER_STACK";
  const count = presentation.architecture.layerCount;
  const dense = presentation.architecture.feedForwardKind === "dense";
  const geometry = new THREE.TorusGeometry(1, 0.024, 4, 24);
  const material = luminousMaterial(THREE, PALETTE.cyan, {
    opacity: 0.42,
    emissiveIntensity: 0.46,
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
    new THREE.TorusGeometry(1, 0.018, 4, 24),
    luminousMaterial(THREE, PALETTE.attention, {
      opacity: 0.2,
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
  const height = dense ? 8.9 : 7.3;
  let attentionAccentIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const ratio = count <= 1 ? 0.5 : index / (count - 1);
    const y = (ratio - 0.5) * height;
    const spiral = index * 0.028;
    const waist = 0.9 + Math.sin(ratio * Math.PI) * 0.16;
    const full =
      presentation.architecture.layerTypes[index] === "full_attention";
    transform.position.set(0, y, 0);
    transform.rotation.set(
      Math.PI / 2,
      spiral,
      Math.sin(spiral) * 0.025,
    );
    const attentionScale = full ? 1.12 : 1;
    transform.scale.set(
      (dense ? 1.72 : 1.94) * waist * attentionScale,
      (dense ? 1.36 : 1.56) * waist * attentionScale,
      1,
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
  group.add(layers, attentionAccents);

  const coreMaterial = luminousMaterial(THREE, PALETTE.blue, {
    opacity: 0.18,
    emissiveIntensity: 0.9,
    metalness: 0.8,
    roughness: 0.18,
    wireframe: true,
  });
  const core = addMesh(
    group,
    new THREE.CylinderGeometry(
      dense ? 0.62 : 0.78,
      dense ? 0.88 : 1.04,
      height + 0.8,
      dense ? 10 : 14,
      Math.max(8, Math.round(count / 2)),
      true,
    ),
    coreMaterial,
  );
  core.name = "MODEL_LATENT_VOLUME";

  const activeLayer = addMesh(
    group,
    new THREE.TorusGeometry(dense ? 1.92 : 2.18, 0.036, 8, 96),
    luminousMaterial(THREE, PALETTE.white, {
      opacity: 0.76,
      emissiveIntensity: 1.12,
      metalness: 0.2,
      roughness: 0.15,
    }),
  );
  activeLayer.rotation.x = Math.PI / 2;
  activeLayer.name = "ACTIVE_LAYER_APERTURE";

  const input = addMesh(
    group,
    new THREE.CylinderGeometry(1.25, 1.72, 0.18, 48, 1, true),
    luminousMaterial(THREE, PALETTE.cyan, {
      opacity: 0.44,
      emissiveIntensity: 1.4,
      wireframe: true,
    }),
    [0, -height / 2 - 0.52, 0],
  );
  input.name = "TOKEN_EMBEDDING_APERTURE";

  const output = addMesh(
    group,
    new THREE.CylinderGeometry(1.72, 1.25, 0.24, 64, 1, true),
    luminousMaterial(THREE, PALETTE.amber, {
      opacity: 0.55,
      emissiveIntensity: 1.6,
      wireframe: true,
    }),
    [0, height / 2 + 0.52, 0],
  );
  output.name = "VOCABULARY_APERTURE";

  group.userData.height = height;
  return {
    group,
    layers,
    attentionAccents,
    core,
    activeLayer,
    input,
    output,
  };
}

function createExpertField(THREE, presentation, bodyHeight) {
  const group = groupFor(THREE);
  group.name = "MOE_EXPERT_FIELD";
  const count =
    presentation.architecture.feedForward?.kind === "moe"
      ? presentation.architecture.feedForward.experts
      : 0;
  const geometry = new THREE.OctahedronGeometry(0.075, 0);
  const material = luminousMaterial(THREE, PALETTE.violet, {
    opacity: 0.55,
    emissiveIntensity: 1,
    metalness: 0.25,
    roughness: 0.28,
  });
  const experts = new THREE.InstancedMesh(
    geometry,
    material,
    Math.max(1, count),
  );
  experts.count = count;
  experts.name = "CONFIGURED_EXPERTS";
  const transform = new THREE.Object3D();
  const positions = [];
  const dormant = new THREE.Color(0x583b82);
  const columns = Math.max(1, Math.min(16, Math.ceil(Math.sqrt(count))));
  const rows = Math.max(1, Math.ceil(count / columns));
  for (let index = 0; index < count; index += 1) {
    const band = index % columns;
    const tier = Math.floor(index / columns);
    const angle =
      band * (Math.PI * 2 / columns) + tier * 0.13;
    const tierRatio = rows <= 1 ? 0.5 : tier / (rows - 1);
    const y = (tierRatio - 0.5) * (bodyHeight * 0.88);
    const radius = 3.05 + Math.sin(tier * 0.8) * 0.22;
    transform.position.set(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    );
    positions.push(transform.position.clone());
    transform.rotation.set(angle, angle * 0.3, -angle);
    transform.scale.setScalar(0.8 + (index % 3) * 0.18);
    transform.updateMatrix();
    experts.setMatrixAt(index, transform.matrix);
    experts.setColorAt(index, dormant);
  }
  experts.instanceMatrix.needsUpdate = true;
  if (experts.instanceColor) experts.instanceColor.needsUpdate = true;
  group.add(experts);

  const shared = addMesh(
    group,
    new THREE.TorusKnotGeometry(0.38, 0.025, 96, 8, 2, 3),
    luminousMaterial(THREE, PALETTE.magenta, {
      opacity: count > 0 ? 0.24 : 0,
      emissiveIntensity: 0.9,
      wireframe: true,
    }),
  );
  shared.name = "SHARED_EXPERT";
  shared.visible = false;
  return { group, experts, shared, positions };
}

function createExpertRouteFan(THREE, presentation, expertPositions) {
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
      lineMaterial(THREE, PALETTE.magenta, 0.34),
    );
    route.name = `MOE_CONFIGURED_ROUTE_${index + 1}`;
    route.visible = false;
    group.add(route);
    routes.push(route);
  }
  group.visible = false;
  group.userData.expertPositions = expertPositions;
  group.userData.routedExpertCount = 0;
  return { group, routes };
}

function createMemoryHalo(THREE) {
  const group = groupFor(THREE);
  group.name = "UNIFIED_MEMORY_HALO";
  const rings = [];
  [
    [5.25, 0.028, 0.24, 0.08],
    [5.65, 0.018, -0.38, -0.14],
    [4.88, 0.014, 0.58, 0.22],
  ].forEach(([radius, tube, tiltX, tiltY], index) => {
    const ring = addMesh(
      group,
      new THREE.TorusGeometry(radius, tube, 6, 192),
      luminousMaterial(THREE, index === 1 ? PALETTE.blue : PALETTE.cyan, {
        opacity: index === 0 ? 0.28 : 0.14,
        emissiveIntensity: 1.08,
        metalness: 0.1,
        roughness: 0.12,
      }),
    );
    ring.rotation.set(tiltX, tiltY, index * 0.38);
    rings.push(ring);
  });
  group.userData.active = false;
  return { group, rings };
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
  cpu.position.set(-5.05, 2.8, 0.4);

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
  gpu.position.set(5.1, -2.5, 0.5);

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
  return [
    tubeBetween(
      THREE,
      [
        [-4.9, 0.1, -0.1],
        [-3.5, 1.35, 1.5],
        [-2.1, 0.3, 1.1],
        [0, 0, 0],
      ],
      PALETTE.cyan,
    ),
    tubeBetween(
      THREE,
      [
        [-4.8, 2.75, 0.4],
        [-3.25, 3.35, 1.25],
        [-1.5, 1.8, 0.8],
        [0, 0.4, 0],
      ],
      PALETTE.white,
    ),
    tubeBetween(
      THREE,
      [
        [0, -0.2, 0],
        [1.7, -1.2, 1.35],
        [3.45, -3.2, 1.1],
        [5.0, -2.5, 0.5],
      ],
      PALETTE.amber,
    ),
  ];
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
  kernel.position.set(0, -0.15, 3.15);
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
    size: 0.055,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "MATH_OPERATION_PARTICLES";
  points.userData.seeds = seeds;
  return points;
}

function createActivationFlow(THREE, bodyHeight) {
  const group = groupFor(THREE);
  group.name = "ACTIVATION_ASCENT";
  const positions = new Float32Array([
    0,
    -bodyHeight / 2 - 0.38,
    0,
    0,
    -bodyHeight / 2,
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
    [0, -bodyHeight / 2, 0],
  );
  courier.name = "ACTIVE_TENSOR_COURIER";
  return { group, path, courier };
}

function stageNodeGeometry(THREE, stage) {
  if (stage.includes("norm")) {
    return new THREE.OctahedronGeometry(0.115, 0);
  }
  if (stage === "attention") {
    return new THREE.TorusGeometry(0.115, 0.028, 5, 18);
  }
  if (stage === "feed-forward") {
    return new THREE.TetrahedronGeometry(0.14, 0);
  }
  return new THREE.BoxGeometry(0.17, 0.075, 0.075);
}

function stageNodeColor(stage) {
  if (stage.includes("norm")) return PALETTE.cyan;
  if (stage === "attention") return PALETTE.attention;
  if (stage === "feed-forward") return PALETTE.amber;
  return PALETTE.white;
}

function createTransformerStageCircuit(THREE, dense) {
  const group = groupFor(THREE);
  group.name = "ACTIVE_TRANSFORMER_STAGE_CIRCUIT";
  const radius = dense ? 1.48 : 1.68;
  const rail = addMesh(
    group,
    new THREE.TorusGeometry(radius, 0.018, 4, 96),
    luminousMaterial(THREE, PALETTE.blue, {
      opacity: 0.48,
      emissiveIntensity: 0.82,
      metalness: 0.2,
      roughness: 0.18,
    }),
  );
  rail.name = "TRANSFORMER_STAGE_RAIL";

  const nodes = TRANSFORMER_STAGES.map((stage, index) => {
    const angle =
      -Math.PI / 2 + index * (Math.PI * 2 / TRANSFORMER_STAGES.length);
    const node = addMesh(
      group,
      stageNodeGeometry(THREE, stage),
      luminousMaterial(THREE, stageNodeColor(stage), {
        opacity: 0.16,
        emissiveIntensity: 0.24,
        metalness: 0.22,
        roughness: 0.16,
      }),
      [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        0.16,
      ],
    );
    node.name = `TRANSFORMER_STAGE_${stage.toUpperCase()}`;
    node.rotation.set(angle * 0.1, angle * 0.08, angle);
    node.userData.stage = stage;
    node.userData.stageIndex = index;
    node.userData.active = false;
    return node;
  });

  const courier = addMesh(
    group,
    new THREE.OctahedronGeometry(0.105, 0),
    luminousMaterial(THREE, PALETTE.white, {
      opacity: 0.96,
      emissiveIntensity: 1.8,
      metalness: 0.12,
      roughness: 0.1,
    }),
  );
  courier.name = "ACTIVE_TRANSFORMER_STAGE_COURIER";
  group.userData.activeStageIndex = null;
  group.userData.activeStage = null;
  return { group, rail, nodes, courier };
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
    presentation.activation.stage === "feed-forward";
  const routedIndices = routingActive
    ? presentation.experts.illuminatedIndices
    : [];
  const illuminated = new Set(routedIndices);
  const active = new statue.THREE.Color(PALETTE.magenta);
  const dormant = new statue.THREE.Color(0x583b82);
  for (let index = 0; index < experts.count; index += 1) {
    experts.setColorAt(index, illuminated.has(index) ? active : dormant);
  }
  if (experts.instanceColor) experts.instanceColor.needsUpdate = true;
  statue.parts.sharedExpert.visible =
    routingActive && presentation.experts.sharedExpert;
  statue.parts.expertRouteFan.visible =
    routingActive && routedIndices.length > 0;
  statue.parts.expertRouteFan.userData.routedExpertCount =
    routingActive ? routedIndices.length : 0;
  statue.parts.expertRoutes.forEach((route, index) => {
    const expertIndex = routedIndices[index];
    const endpoint =
      statue.parts.expertPositions[expertIndex] ?? null;
    route.visible = routingActive && endpoint !== null;
    if (endpoint === null) return;
    const positions = route.geometry.getAttribute("position");
    positions.setXYZ(0, 0, activationY, 0);
    positions.setXYZ(1, endpoint.x, endpoint.y, endpoint.z);
    positions.needsUpdate = true;
  });
}

export function applyStatuePresentation(statue, presentation) {
  statue.presentation = presentation;
  statue.root.userData.architectureAvailable =
    presentation.architecture.available;
  statue.root.userData.activeLayer = presentation.activation.layerIndex;
  statue.root.userData.activeStage = presentation.activation.stage;

  const height = statue.parts.bodyHeight;
  const layerCount = presentation.architecture.layerCount;
  const layerRatio =
    presentation.activation.layerIndex === null || layerCount <= 1
      ? 0.5
      : presentation.activation.layerIndex / (layerCount - 1);
  statue.parts.activeLayer.position.y = (layerRatio - 0.5) * height;
  statue.parts.activeLayer.visible = presentation.architecture.available;
  statue.parts.activeLayer.userData.stageScale =
    [0.82, 1.08, 0.96, 0.84, 1, 1.04][
      presentation.activation.stageIndex ?? 0
    ];
  updateLayerColors(statue, presentation);
  const activationY = statue.parts.activeLayer.position.y;
  updateExperts(statue, presentation, activationY);
  statue.parts.activationCourier.position.y = activationY;
  statue.parts.activationCourier.visible =
    presentation.architecture.available;
  const activationPositions =
    statue.parts.activationPath.geometry.getAttribute("position");
  activationPositions.setY(1, activationY);
  activationPositions.needsUpdate = true;
  const activeStageIndex = presentation.activation.stageIndex;
  const activeStageNode =
    activeStageIndex === null
      ? null
      : statue.parts.stageNodes[activeStageIndex];
  statue.parts.stageCircuit.position.y = activationY;
  statue.parts.stageCircuit.position.x = 1.45;
  statue.parts.stageCircuit.position.z = 1.9;
  statue.parts.stageCircuit.visible =
    presentation.architecture.available && activeStageNode !== null;
  statue.parts.stageCircuit.userData.activeStageIndex =
    activeStageIndex;
  statue.parts.stageCircuit.userData.activeStage =
    presentation.activation.stage;
  statue.parts.stageNodes.forEach((node, index) => {
    const active = index === activeStageIndex;
    const complete =
      activeStageIndex !== null && index < activeStageIndex;
    node.userData.active = active;
    node.userData.complete = complete;
    node.material.opacity = active ? 0.94 : complete ? 0.54 : 0.26;
    node.material.emissiveIntensity = active
      ? 1.55
      : complete
        ? 0.82
        : 0.38;
    node.scale.setScalar(active ? 1.38 : complete ? 0.98 : 0.82);
  });
  statue.parts.stageCourier.visible = activeStageNode !== null;
  if (activeStageNode !== null) {
    statue.parts.stageCourier.position.copy(activeStageNode.position);
  }

  statue.parts.memory.userData.active =
    presentation.hardware.memory.active;
  statue.parts.memory.scale.setScalar(
    presentation.hardware.memory.haloScale,
  );
  statue.parts.memoryRings.forEach((ring, index) => {
    ring.material.opacity = presentation.hardware.memory.active
      ? 0.23 - index * 0.04
      : 0.05;
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
    material.opacity = active ? 0.72 : 0.08;
  });
  statue.parts.particles.visible = presentation.hardware.gpu.active;
  statue.parts.particles.material.opacity =
    0.24 + presentation.hardware.gpu.laneCount / 24;
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

  statue.parts.memory.rotation.y = time * 0.045;
  statue.parts.cpu.rotation.y = time * 0.62;
  statue.parts.gpu.rotation.y = -time * 0.31;
  statue.parts.kernel.rotation.z = Math.sin(time * 0.42) * 0.08;
  statue.parts.kernel.rotation.y = time * 0.08;
  statue.parts.activationCourier.rotation.x = time * 1.7;
  statue.parts.activationCourier.rotation.y = time * 2.1;
  statue.parts.stageCircuit.rotation.y =
    0.65 + Math.sin(time * 0.42) * 0.045;
  statue.parts.stageCourier.rotation.x = time * 2.4;
  statue.parts.stageCourier.rotation.y = time * 3.1;
  statue.parts.sharedExpert.rotation.x = time * 0.48;
  statue.parts.sharedExpert.rotation.y = time * 0.72;
  statue.parts.expertRoutes.forEach((route, index) => {
    route.material.opacity =
      0.2 +
      Math.max(0, Math.sin(time * 3.4 - index * 0.48)) * 0.32;
  });
  const stagePulse = reducedMotion
    ? 1
    : 1 + Math.sin(time * 7.2) * 0.16;
  statue.parts.stageCourier.scale.setScalar(stagePulse);
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
  const activeY = statue.parts.activeLayer.position.y;
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
    body.group.userData.height,
  );
  const expertRouteFan = createExpertRouteFan(
    THREE,
    presentation,
    expertField.positions,
  );
  const memory = createMemoryHalo(THREE);
  const hardware = createHardwareOrbitals(THREE);
  const glyph = createKernelGlyphs(THREE);
  const ribbons = createRibbons(THREE);
  const speculation = createSpeculationBranches(THREE);
  const particles = createParticleField(THREE);
  const activationFlow = createActivationFlow(
    THREE,
    body.group.userData.height,
  );
  const stageCircuit = createTransformerStageCircuit(
    THREE,
    presentation.architecture.feedForwardKind === "dense",
  );

  root.add(
    body.group,
    expertField.group,
    expertRouteFan.group,
    memory.group,
    hardware.cpu,
    hardware.gpu,
    glyph.kernel,
    speculation.group,
    activationFlow.group,
    stageCircuit.group,
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
      experts: expertField.experts,
      sharedExpert: expertField.shared,
      expertPositions: expertField.positions,
      expertRouteFan: expertRouteFan.group,
      expertRoutes: expertRouteFan.routes,
      activeLayer: body.activeLayer,
      bodyHeight: body.group.userData.height,
      memory: memory.group,
      memoryRings: memory.rings,
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
      stageCircuit: stageCircuit.group,
      stageRail: stageCircuit.rail,
      stageNodes: stageCircuit.nodes,
      stageCourier: stageCircuit.courier,
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
