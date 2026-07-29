const ARCHITECTURE_LIMITS = Object.freeze({
  layers: 512,
  hiddenSize: 1_048_576,
  vocabSize: 16_777_216,
  heads: 4_096,
  headDimension: 65_536,
  intermediateSize: 16_777_216,
  experts: 4_096,
  mtpLayers: 64,
});

const LAYER_TYPES = new Set([
  "linear_attention",
  "full_attention",
]);

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function own(value, key) {
  return plainObject(value) && Object.hasOwn(value, key)
    ? value[key]
    : undefined;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function stringField(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function integerField(value, label, { optional = false, maximum } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new TypeError(`${label} must be a positive integer.`);
  }
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    (Number.isSafeInteger(maximum) && value > maximum)
  ) {
    const range = Number.isSafeInteger(maximum)
      ? ` from 1 through ${maximum}`
      : "";
    throw new RangeError(`${label} must be a positive integer${range}.`);
  }
  return value;
}

function booleanField(value, label, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function architectureInput(config, required) {
  if (config === undefined || config === null) {
    if (!required) return null;
    throw new TypeError("Architecture configuration is required.");
  }
  if (!plainObject(config)) {
    throw new TypeError("Architecture configuration must be a plain object.");
  }
  const nestedArchitecture = own(config, "architecture");
  const nestedTextConfig = own(config, "text_config");
  const input =
    nestedArchitecture !== undefined
      ? nestedArchitecture
      : nestedTextConfig !== undefined
        ? nestedTextConfig
        : config;
  if (!plainObject(input)) {
    throw new TypeError("Architecture configuration must be a plain object.");
  }
  if (Object.keys(input).length === 0) {
    if (!required) return null;
    throw new TypeError("Architecture configuration is required.");
  }
  return input;
}

function normalizeLayerType(value) {
  const layerType = stringField(value);
  if (!LAYER_TYPES.has(layerType)) {
    throw new TypeError(
      "Architecture layer type must be linear_attention or full_attention.",
    );
  }
  return layerType;
}

function normalizeLayerTypes(input, numHiddenLayers) {
  const exact = firstDefined(
    own(input, "layerTypes"),
    own(input, "layer_types"),
  );
  if (exact !== undefined) {
    if (!Array.isArray(exact) || exact.length !== numHiddenLayers) {
      throw new RangeError(
        `layer_types must contain exactly ${numHiddenLayers} entries.`,
      );
    }
    return exact.map(normalizeLayerType);
  }

  const pattern = firstDefined(
    own(input, "layerTypePattern"),
    own(input, "layer_type_pattern"),
  );
  if (!Array.isArray(pattern) || pattern.length === 0) {
    throw new TypeError(
      "Architecture requires layer_types or layer_type_pattern.",
    );
  }
  if (pattern.length > numHiddenLayers) {
    throw new RangeError(
      "layer_type_pattern cannot exceed num_hidden_layers.",
    );
  }
  const normalizedPattern = pattern.map(normalizeLayerType);
  return Array.from(
    { length: numHiddenLayers },
    (_, index) => normalizedPattern[index % normalizedPattern.length],
  );
}

function normalizeAttention(input) {
  const nested = own(input, "attention");
  if (nested !== undefined && !plainObject(nested)) {
    throw new TypeError("attention must be a plain object.");
  }
  return {
    queryHeads: integerField(
      firstDefined(
        own(nested, "queryHeads"),
        own(input, "num_attention_heads"),
      ),
      "num_attention_heads",
      { maximum: ARCHITECTURE_LIMITS.heads },
    ),
    keyValueHeads: integerField(
      firstDefined(
        own(nested, "keyValueHeads"),
        own(input, "num_key_value_heads"),
      ),
      "num_key_value_heads",
      { maximum: ARCHITECTURE_LIMITS.heads },
    ),
    headDimension: integerField(
      firstDefined(
        own(nested, "headDimension"),
        own(input, "head_dim"),
      ),
      "head_dim",
      { maximum: ARCHITECTURE_LIMITS.headDimension },
    ),
  };
}

function normalizeLinearAttention(input) {
  const nested = own(input, "linearAttention");
  if (nested !== undefined && !plainObject(nested)) {
    throw new TypeError("linearAttention must be a plain object.");
  }
  return {
    keyHeads: integerField(
      firstDefined(
        own(nested, "keyHeads"),
        own(input, "linear_num_key_heads"),
      ),
      "linear_num_key_heads",
      { maximum: ARCHITECTURE_LIMITS.heads },
    ),
    valueHeads: integerField(
      firstDefined(
        own(nested, "valueHeads"),
        own(input, "linear_num_value_heads"),
      ),
      "linear_num_value_heads",
      { maximum: ARCHITECTURE_LIMITS.heads },
    ),
    keyHeadDimension: integerField(
      firstDefined(
        own(nested, "keyHeadDimension"),
        own(input, "linear_key_head_dim"),
      ),
      "linear_key_head_dim",
      { maximum: ARCHITECTURE_LIMITS.headDimension },
    ),
    valueHeadDimension: integerField(
      firstDefined(
        own(nested, "valueHeadDimension"),
        own(input, "linear_value_head_dim"),
      ),
      "linear_value_head_dim",
      { maximum: ARCHITECTURE_LIMITS.headDimension },
    ),
  };
}

function normalizeFeedForward(input) {
  const nested = own(input, "feedForward");
  if (nested !== undefined && !plainObject(nested)) {
    throw new TypeError("feedForward must be a plain object.");
  }
  const declaredKind = stringField(own(nested, "kind"));
  if (
    declaredKind !== null &&
    declaredKind !== "dense" &&
    declaredKind !== "moe"
  ) {
    throw new TypeError("feedForward.kind must be dense or moe.");
  }
  const experts = integerField(
    firstDefined(own(nested, "experts"), own(input, "num_experts")),
    "num_experts",
    { optional: true, maximum: ARCHITECTURE_LIMITS.experts },
  );
  const kind = declaredKind ?? (experts === null ? "dense" : "moe");

  if (kind === "dense") {
    if (experts !== null) {
      throw new TypeError("Dense feed-forward architecture cannot declare experts.");
    }
    return {
      kind,
      intermediateSize: integerField(
        firstDefined(
          own(nested, "intermediateSize"),
          own(input, "intermediate_size"),
        ),
        "intermediate_size",
        { maximum: ARCHITECTURE_LIMITS.intermediateSize },
      ),
      sharedIntermediateSize: null,
      experts: null,
      expertsPerToken: null,
    };
  }

  const requiredExperts =
    experts ??
    integerField(undefined, "num_experts", {
      maximum: ARCHITECTURE_LIMITS.experts,
    });
  const expertsPerToken = integerField(
    firstDefined(
      own(nested, "expertsPerToken"),
      own(input, "num_experts_per_tok"),
    ),
    "num_experts_per_tok",
    { maximum: requiredExperts },
  );
  return {
    kind,
    intermediateSize: integerField(
      firstDefined(
        own(nested, "intermediateSize"),
        own(input, "moe_intermediate_size"),
      ),
      "moe_intermediate_size",
      { maximum: ARCHITECTURE_LIMITS.intermediateSize },
    ),
    sharedIntermediateSize: integerField(
      firstDefined(
        own(nested, "sharedIntermediateSize"),
        own(input, "shared_expert_intermediate_size"),
      ),
      "shared_expert_intermediate_size",
      { maximum: ARCHITECTURE_LIMITS.intermediateSize },
    ),
    experts: requiredExperts,
    expertsPerToken,
  };
}

function normalizeMtp(input) {
  const nested = own(input, "mtp");
  if (nested !== undefined && !plainObject(nested)) {
    throw new TypeError("mtp must be a plain object.");
  }
  return {
    layers:
      integerField(
        firstDefined(
          own(nested, "layers"),
          own(input, "mtp_num_hidden_layers"),
        ),
        "mtp_num_hidden_layers",
        { optional: true, maximum: ARCHITECTURE_LIMITS.mtpLayers },
      ) ?? 0,
    dedicatedEmbeddings: booleanField(
      firstDefined(
        own(nested, "dedicatedEmbeddings"),
        own(input, "mtp_use_dedicated_embeddings"),
      ),
      "mtp_use_dedicated_embeddings",
    ),
  };
}

export function normalizeArchitecture(
  config,
  { source = "checkpoint-config", required = true } = {},
) {
  const input = architectureInput(config, required);
  if (input === null) return null;

  const numHiddenLayers = integerField(
    firstDefined(
      own(input, "numHiddenLayers"),
      own(input, "num_hidden_layers"),
    ),
    "num_hidden_layers",
    { maximum: ARCHITECTURE_LIMITS.layers },
  );
  const hiddenSize = integerField(
    firstDefined(own(input, "hiddenSize"), own(input, "hidden_size")),
    "hidden_size",
    { maximum: ARCHITECTURE_LIMITS.hiddenSize },
  );

  return deepFreeze({
    source: stringField(own(input, "source")) ?? source,
    modelType:
      stringField(
        firstDefined(own(input, "modelType"), own(input, "model_type")),
      ) ?? "unknown",
    numHiddenLayers,
    hiddenSize,
    vocabSize: integerField(
      firstDefined(own(input, "vocabSize"), own(input, "vocab_size")),
      "vocab_size",
      { optional: true, maximum: ARCHITECTURE_LIMITS.vocabSize },
    ),
    layerTypes: normalizeLayerTypes(input, numHiddenLayers),
    attention: normalizeAttention(input),
    linearAttention: normalizeLinearAttention(input),
    feedForward: normalizeFeedForward(input),
    mtp: normalizeMtp(input),
  });
}
