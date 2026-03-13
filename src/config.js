const Store = require("electron-store");

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

const store = new Store({
  defaults: {
    openai: {
      apiKey: "",
    },
    model: DEFAULT_MODEL,
    customPrompt: DEFAULT_PROMPT,
  },
});

module.exports = {
  getOpenAIKey: () => store.get("openai.apiKey") || "",
  setOpenAIKey: (key) => store.set("openai.apiKey", key),
  hasOpenAIKey: () => !!store.get("openai.apiKey"),
  getCustomPrompt: () => store.get("customPrompt") || DEFAULT_PROMPT,
  setCustomPrompt: (prompt) => store.set("customPrompt", prompt),
  getModel: () => store.get("model") || DEFAULT_MODEL,
  setModel: (model) => store.set("model", model),
  DEFAULT_PROMPT,
  DEFAULT_MODEL,
  AVAILABLE_MODELS,
};
