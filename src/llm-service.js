const axios = require("axios");
const { ipcMain } = require("electron");
const fs = require("fs");
const config = require("./config");

let isInitialized = false;

// Conversation history — stores past messages for multi-turn context
// Each entry: { role: "user"|"assistant", content: string|array }
let conversationHistory = [];
const MAX_HISTORY_ENTRIES = 100; // 50 message pairs

// Reset conversation history
function resetConversationHistory() {
  conversationHistory = [];
}

// Trim history to stay within limits
function trimHistory() {
  if (conversationHistory.length > MAX_HISTORY_ENTRIES) {
    // Remove oldest messages from the front, keeping the most recent ones
    conversationHistory = conversationHistory.slice(
      conversationHistory.length - MAX_HISTORY_ENTRIES
    );
  }
}

// Initialize the LLM service
async function initializeLLMService() {
  const apiKey = config.getOpenAIKey();
  if (!apiKey) return;

  if (!isInitialized) {
    ipcMain.handle("analyze-screenshot", async (event, data) => {
      try {
        return await makeLLMRequest(event, data);
      } catch (error) {
        throw new Error(`Failed to analyze screenshot: ${error.message}`);
      }
    });

    ipcMain.handle("test-response", async (event, prompt) => {
      try {
        return await makeLLMRequest(event, { prompt });
      } catch (error) {
        throw new Error(`Failed to test response: ${error.message}`);
      }
    });

    // IPC handler to reset conversation memory
    ipcMain.handle("reset-conversation", () => {
      resetConversationHistory();
      return true;
    });

    isInitialized = true;
  }
}

async function makeLLMRequest(event, data) {
  const apiKey = config.getOpenAIKey();
  if (!apiKey) {
    throw new Error(
      "OpenAI API key not configured. Please set your API key in the settings."
    );
  }

  if (!apiKey.startsWith("sk-")) {
    throw new Error(
      "Invalid OpenAI API key format. API keys should start with 'sk-'"
    );
  }

  const systemPrompt = config.getCustomPrompt();
  const selectedModel = config.getModel();
  const messageId = Date.now().toString();

  // Build the current user message content
  const userContent = [
    {
      type: "input_text",
      text: data.prompt || "Analyze this screenshot and provide insights.",
    },
  ];

  if (data.filePath) {
    if (!fs.existsSync(data.filePath)) {
      throw new Error("Screenshot file not found");
    }
    const imageBuffer = fs.readFileSync(data.filePath);
    const base64Image = imageBuffer.toString("base64");
    userContent.push({
      type: "input_image",
      image_url: `data:image/png;base64,${base64Image}`,
    });
  }

  // Add current user message to conversation history
  conversationHistory.push({
    role: "user",
    content: userContent,
  });
  trimHistory();

  // Build input: system prompt + full conversation history
  const requestData = {
    model: selectedModel,
    stream: true,
    input: [
      {
        role: "developer",
        content: systemPrompt,
      },
      ...conversationHistory,
    ],
  };

  // Add reasoning effort if the model supports it (e.g. gpt-5.2 → low)
  const modelConfig = config.AVAILABLE_MODELS.find((m) => m.id === selectedModel);
  if (modelConfig && modelConfig.reasoning) {
    requestData.reasoning = { effort: modelConfig.reasoning };
  }

  // Notify renderer that streaming has started
  event.sender.send("stream-update", {
    messageId,
    content: "",
    isComplete: false,
    status: "streaming",
  });

  try {
    const response = await axios({
      method: "post",
      url: "https://api.openai.com/v1/responses",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      data: requestData,
      responseType: "stream",
    });

    let fullContent = "";

    await new Promise((resolve, reject) => {
      let buffer = "";

      response.data.on("data", (chunk) => {
        buffer += chunk.toString();

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(jsonStr);

            // Handle output_text.delta events
            if (parsed.type === "response.output_text.delta" && parsed.delta) {
              fullContent += parsed.delta;
              event.sender.send("stream-update", {
                messageId,
                content: fullContent,
                isComplete: false,
                status: "streaming",
              });
            }

            // Handle completion
            if (parsed.type === "response.completed") {
              resolve();
            }
          } catch (e) {
            // Skip unparseable lines
          }
        }
      });

      response.data.on("end", () => {
        resolve();
      });

      response.data.on("error", (err) => {
        reject(err);
      });
    });

    // Store assistant response in conversation history
    conversationHistory.push({
      role: "assistant",
      content: fullContent,
    });
    trimHistory();

    // Send final complete message
    event.sender.send("stream-update", {
      messageId,
      content: fullContent,
      isComplete: true,
      status: "completed",
    });

    return {
      success: true,
      messageId,
      provider: "openai",
      model: selectedModel,
      status: "completed",
    };
  } catch (error) {
    // Remove the user message we just added since the request failed
    conversationHistory.pop();

    if (error.response) {
      if (error.response.status === 401) {
        throw new Error(
          "Invalid API key. Please check your OpenAI API key in settings."
        );
      }
      // For streaming errors, the response body may be a stream
      let errorMessage = error.message;
      if (error.response.data && typeof error.response.data === "object" && error.response.data.error) {
        errorMessage = error.response.data.error.message || error.message;
      }
      throw new Error(`API Error: ${errorMessage}`);
    } else if (error.request) {
      throw new Error(
        "No response received from OpenAI API. Please check your internet connection."
      );
    }
    throw new Error(`Request Error: ${error.message}`);
  }
}

module.exports = {
  initializeLLMService,
  resetConversationHistory,
};
