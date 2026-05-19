const Store = require("electron-store");
const { EventEmitter } = require("events");

const DEFAULT_PROMPT = `You are an invisible AI assistant that analyzes screenshots during meetings and presentations.

Key Responsibilities:
1. Analyze visual content quickly and efficiently
2. Provide concise, actionable insights
3. Identify key information, patterns, and potential issues
4. Suggest relevant follow-up questions or actions

Guidelines:
- Keep responses brief and scannable (max 200 words)
- Use bullet points and clear formatting
- Highlight important terms using **bold**
- Focus on actionable insights
- If code is shown, provide quick technical insights
- For data/charts, emphasize key trends and anomalies
- During presentations, note key takeaways and action items

Format your responses in sections:
• Quick Summary (2-3 sentences)
• Key Points (3-5 bullets)
• Suggested Actions (if applicable)
• Technical Notes (if code/data is present)`;

const DEFAULT_MODEL = "gpt-4o-mini";

const AVAILABLE_MODELS = [
  { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast & affordable" },
  { id: "gpt-4o", name: "GPT-4o", description: "Best overall" },
  { id: "gpt-4.1", name: "GPT-4.1", description: "Flagship model" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", description: "Fast & smart" },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", description: "Fastest & cheapest" },
  { id: "gpt-5.2", name: "GPT-5.2", description: "Latest, minimal reasoning", reasoning: "low" },
  { id: "o4-mini", name: "o4-mini", description: "Reasoning, fast" },
  { id: "o3", name: "o3", description: "Reasoning, powerful" },
  { id: "o3-mini", name: "o3-mini", description: "Reasoning, affordable" },
];

function createDefaultUsage() {
  return {
    text: {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
    transcription: {
      sessions: 0,
      finalTranscripts: 0,
      audioSeconds: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      audioTokens: 0,
    },
    updatedAt: null,
  };
}

function mergeUsageWithDefaults(usage = {}) {
  const defaults = createDefaultUsage();
  return {
    text: {
      ...defaults.text,
      ...(usage.text || {}),
    },
    transcription: {
      ...defaults.transcription,
      ...(usage.transcription || {}),
    },
    updatedAt: usage.updatedAt || null,
  };
}

function getNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function normalizeTokenUsage(usage = {}) {
  const inputDetails =
    usage.input_tokens_details || usage.input_token_details || {};
  const outputDetails =
    usage.output_tokens_details || usage.output_token_details || {};

  return {
    inputTokens: getNumber(usage.input_tokens),
    outputTokens: getNumber(usage.output_tokens),
    totalTokens: getNumber(usage.total_tokens),
    cachedTokens: getNumber(inputDetails.cached_tokens),
    reasoningTokens: getNumber(outputDetails.reasoning_tokens),
    audioTokens:
      getNumber(inputDetails.audio_tokens) +
      getNumber(outputDetails.audio_tokens) +
      getNumber(usage.audio_tokens),
  };
}

const store = new Store({
  defaults: {
    openai: {
      apiKey: "",
    },
    model: DEFAULT_MODEL,
    customPrompt: DEFAULT_PROMPT,
    mousePassthrough: true,
    usage: createDefaultUsage(),
  },
});
const usageEvents = new EventEmitter();

function emitUsageUpdated(usage) {
  usageEvents.emit("usage-updated", usage);
}

module.exports = {
  getOpenAIKey: () => store.get("openai.apiKey") || "",
  setOpenAIKey: (key) => store.set("openai.apiKey", key),
  hasOpenAIKey: () => !!store.get("openai.apiKey"),
  getCustomPrompt: () => store.get("customPrompt") || DEFAULT_PROMPT,
  setCustomPrompt: (prompt) => store.set("customPrompt", prompt),
  getModel: () => store.get("model") || DEFAULT_MODEL,
  setModel: (model) => store.set("model", model),
  getMousePassthrough: () => store.get("mousePassthrough") !== false,
  setMousePassthrough: (enabled) =>
    store.set("mousePassthrough", Boolean(enabled)),
  getUsage: () => mergeUsageWithDefaults(store.get("usage")),
  resetUsage: () => {
    const usage = createDefaultUsage();
    store.set("usage", usage);
    emitUsageUpdated(usage);
    return usage;
  },
  recordTextUsage: (usage) => {
    const current = mergeUsageWithDefaults(store.get("usage"));
    const normalized = normalizeTokenUsage(usage);
    current.text.requests += 1;
    current.text.inputTokens += normalized.inputTokens;
    current.text.outputTokens += normalized.outputTokens;
    current.text.totalTokens += normalized.totalTokens;
    current.text.cachedTokens += normalized.cachedTokens;
    current.text.reasoningTokens += normalized.reasoningTokens;
    current.updatedAt = new Date().toISOString();
    store.set("usage", current);
    emitUsageUpdated(current);
    return current;
  },
  recordTranscriptionUsage: (usage = {}) => {
    const current = mergeUsageWithDefaults(store.get("usage"));
    const normalized = normalizeTokenUsage(usage);
    current.transcription.sessions += getNumber(usage.sessions);
    current.transcription.finalTranscripts += getNumber(usage.finalTranscripts);
    current.transcription.audioSeconds += getNumber(usage.audioSeconds);
    current.transcription.inputTokens += normalized.inputTokens;
    current.transcription.outputTokens += normalized.outputTokens;
    current.transcription.totalTokens += normalized.totalTokens;
    current.transcription.audioTokens += normalized.audioTokens;
    current.updatedAt = new Date().toISOString();
    store.set("usage", current);
    emitUsageUpdated(current);
    return current;
  },
  onUsageUpdated: (callback) => {
    usageEvents.on("usage-updated", callback);
    return () => usageEvents.off("usage-updated", callback);
  },
  DEFAULT_PROMPT,
  DEFAULT_MODEL,
  AVAILABLE_MODELS,
};
