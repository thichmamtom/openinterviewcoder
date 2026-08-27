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

const RESPONSE_LANGUAGES = [
  {
    id: "en",
    name: "English",
    instruction:
      "Respond in English. Keep technical identifiers, code, commands, filenames, and quoted text unchanged.",
  },
  {
    id: "vi",
    name: "Vietnamese",
    instruction:
      "Respond in Vietnamese. Keep technical identifiers, code, commands, filenames, and quoted text unchanged. Use natural Vietnamese for explanations.",
  },
];
const DEFAULT_RESPONSE_LANGUAGE = "en";
const PROMPT_VARIABLES = [
  {
    token: "{{lang}}",
    description: "Current response language code, such as en or vi.",
  },
  {
    token: "{{language}}",
    description: "Current response language name, such as English or Vietnamese.",
  },
  {
    token: "{{language_instruction}}",
    description: "Full app-generated language instruction for the current language.",
  },
  {
    token: "{{model}}",
    description: "Current model ID.",
  },
  {
    token: "{{app_name}}",
    description: "Application name.",
  },
];

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_APP_BACKGROUND_COLOR = "#000000";
const DEFAULT_APP_BACKGROUND_OPACITY = 0.72;
const DEFAULT_OVERLAY_WINDOW = {
  width: 800,
  height: 600,
  freeDragInSettings: true,
};
const OVERLAY_MIN_WIDTH = 360;
const OVERLAY_MIN_HEIGHT = 240;

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

function getFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInteger(value, min, max, fallback) {
  const number = getFiniteNumber(value);
  if (number === null) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function normalizeOverlayWindow(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {
    width: clampInteger(
      source.width,
      OVERLAY_MIN_WIDTH,
      4096,
      DEFAULT_OVERLAY_WINDOW.width
    ),
    height: clampInteger(
      source.height,
      OVERLAY_MIN_HEIGHT,
      2160,
      DEFAULT_OVERLAY_WINDOW.height
    ),
    freeDragInSettings: source.freeDragInSettings !== false,
  };
  const x = getFiniteNumber(source.x);
  const y = getFiniteNumber(source.y);

  if (x !== null) normalized.x = Math.round(x);
  if (y !== null) normalized.y = Math.round(y);

  return normalized;
}

function normalizeOpenAIBaseURL(value = DEFAULT_OPENAI_BASE_URL) {
  const rawValue = typeof value === "string" ? value.trim() : "";
  if (!rawValue) return DEFAULT_OPENAI_BASE_URL;

  const valueWithProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(rawValue)
    ? rawValue
    : `https://${rawValue}`;
  const url = new URL(valueWithProtocol);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("OpenAI base URL must use http or https.");
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString().replace(/\/$/, "");
}

function normalizeAppBackgroundColor(value = DEFAULT_APP_BACKGROUND_COLOR) {
  const rawValue = typeof value === "string" ? value.trim() : "";
  const match = rawValue.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (!match) return DEFAULT_APP_BACKGROUND_COLOR;

  const hex = match[1].toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

function normalizeAppBackgroundOpacity(value = DEFAULT_APP_BACKGROUND_OPACITY) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_APP_BACKGROUND_OPACITY;

  return Math.min(Math.max(number, 0), 1);
}

function normalizeResponseLanguage(value = DEFAULT_RESPONSE_LANGUAGE) {
  const rawValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  return RESPONSE_LANGUAGES.some((language) => language.id === rawValue)
    ? rawValue
    : DEFAULT_RESPONSE_LANGUAGE;
}

function getResponseLanguageDefinition(languageId = DEFAULT_RESPONSE_LANGUAGE) {
  const normalized = normalizeResponseLanguage(languageId);
  return (
    RESPONSE_LANGUAGES.find((language) => language.id === normalized) ||
    RESPONSE_LANGUAGES[0]
  );
}

function createPromptVariableValues(responseLanguage, model) {
  const language = getResponseLanguageDefinition(responseLanguage);
  return {
    lang: language.id,
    language: language.name,
    language_instruction: language.instruction,
    languageInstruction: language.instruction,
    model: typeof model === "string" && model.trim() ? model.trim() : DEFAULT_MODEL,
    app_name: "Open Interview Coder",
    appName: "Open Interview Coder",
  };
}

function renderPromptTemplate(template, variables = {}) {
  if (typeof template !== "string" || !template) return "";

  return template.replace(
    /{{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*}}/g,
    (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(variables, key)) {
        return match;
      }
      return String(variables[key]);
    }
  );
}

function buildSystemPrompt(customPrompt, responseLanguage, model) {
  const variables = createPromptVariableValues(responseLanguage, model);
  const trimmedCustomPrompt =
    typeof customPrompt === "string" && customPrompt.trim()
      ? customPrompt.trim()
      : DEFAULT_PROMPT;

  return renderPromptTemplate(trimmedCustomPrompt, variables);
}

function getStoredOpenAIBaseURL() {
  try {
    return normalizeOpenAIBaseURL(store.get("openai.baseUrl"));
  } catch (error) {
    return DEFAULT_OPENAI_BASE_URL;
  }
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
      baseUrl: DEFAULT_OPENAI_BASE_URL,
    },
    model: DEFAULT_MODEL,
    customPrompt: DEFAULT_PROMPT,
    responseLanguage: DEFAULT_RESPONSE_LANGUAGE,
    mousePassthrough: true,
    appearance: {
      appBackgroundColor: DEFAULT_APP_BACKGROUND_COLOR,
      appBackgroundOpacity: DEFAULT_APP_BACKGROUND_OPACITY,
    },
    overlayWindow: DEFAULT_OVERLAY_WINDOW,
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
  getOpenAIBaseURL: () => getStoredOpenAIBaseURL(),
  setOpenAIBaseURL: (baseUrl) =>
    store.set("openai.baseUrl", normalizeOpenAIBaseURL(baseUrl)),
  isDefaultOpenAIBaseURL: () =>
    getStoredOpenAIBaseURL() === DEFAULT_OPENAI_BASE_URL,
  hasOpenAIKey: () => !!store.get("openai.apiKey"),
  getCustomPrompt: () => store.get("customPrompt") || DEFAULT_PROMPT,
  setCustomPrompt: (prompt) => store.set("customPrompt", prompt),
  getResponseLanguage: () =>
    normalizeResponseLanguage(store.get("responseLanguage")),
  setResponseLanguage: (language) => {
    const normalized = normalizeResponseLanguage(language);
    store.set("responseLanguage", normalized);
    return normalized;
  },
  toggleResponseLanguage: () => {
    const current = normalizeResponseLanguage(store.get("responseLanguage"));
    const currentIndex = RESPONSE_LANGUAGES.findIndex(
      (language) => language.id === current
    );
    const nextLanguage =
      RESPONSE_LANGUAGES[(currentIndex + 1) % RESPONSE_LANGUAGES.length];
    store.set("responseLanguage", nextLanguage.id);
    return nextLanguage.id;
  },
  buildSystemPrompt: () =>
    buildSystemPrompt(
      store.get("customPrompt") || DEFAULT_PROMPT,
      store.get("responseLanguage"),
      store.get("model")
    ),
  getModel: () => store.get("model") || DEFAULT_MODEL,
  setModel: (model) => store.set("model", model),
  getMousePassthrough: () => store.get("mousePassthrough") !== false,
  setMousePassthrough: (enabled) =>
    store.set("mousePassthrough", Boolean(enabled)),
  getAppBackgroundColor: () =>
    normalizeAppBackgroundColor(store.get("appearance.appBackgroundColor")),
  setAppBackgroundColor: (color) =>
    store.set("appearance.appBackgroundColor", normalizeAppBackgroundColor(color)),
  getAppBackgroundOpacity: () =>
    normalizeAppBackgroundOpacity(store.get("appearance.appBackgroundOpacity")),
  setAppBackgroundOpacity: (opacity) =>
    store.set(
      "appearance.appBackgroundOpacity",
      normalizeAppBackgroundOpacity(opacity)
    ),
  getOverlayWindow: () => normalizeOverlayWindow(store.get("overlayWindow")),
  setOverlayWindow: (overlayWindow) => {
    const current = normalizeOverlayWindow(store.get("overlayWindow"));
    const next = normalizeOverlayWindow({
      ...current,
      ...(overlayWindow || {}),
    });
    store.set("overlayWindow", next);
    return next;
  },
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
  DEFAULT_RESPONSE_LANGUAGE,
  DEFAULT_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_APP_BACKGROUND_COLOR,
  DEFAULT_APP_BACKGROUND_OPACITY,
  DEFAULT_OVERLAY_WINDOW,
  RESPONSE_LANGUAGES,
  PROMPT_VARIABLES,
  AVAILABLE_MODELS,
};
