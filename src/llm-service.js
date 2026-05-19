const axios = require("axios");
const { ipcMain } = require("electron");
const fs = require("fs");
const WebSocket = require("ws");
const config = require("./config");

let isInitialized = false;
let nextTranscriptionSessionId = 1;
const transcriptionSessions = new Map();

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

    ipcMain.handle("audio-transcription-start", async (event, options = {}) => {
      try {
        return await startRealtimeTranscription(event.sender, options);
      } catch (error) {
        throw new Error(`Failed to start audio transcription: ${error.message}`);
      }
    });

    ipcMain.handle("audio-transcription-append", (event, data) => {
      try {
        return appendRealtimeAudio(data);
      } catch (error) {
        throw new Error(`Failed to stream audio: ${error.message}`);
      }
    });

    ipcMain.handle("audio-transcription-stop", (event, data) => {
      try {
        return stopRealtimeTranscription(data);
      } catch (error) {
        throw new Error(`Failed to stop audio transcription: ${error.message}`);
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

function validateOpenAIKey() {
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

  return apiKey;
}

function sendTranscriptionStatus(sender, sessionId, status, detail) {
  if (!sender || sender.isDestroyed()) return;
  sender.send("audio-transcription-status", {
    sessionId,
    status,
    detail,
  });
}

function sendTranscriptionError(sender, sessionId, message) {
  if (!sender || sender.isDestroyed()) return;
  sender.send("audio-transcription-error", {
    sessionId,
    error: message,
  });
}

function addNumber(target, key, value) {
  if (Number.isFinite(value)) {
    target[key] = (target[key] || 0) + value;
  }
}

function addNestedNumber(target, section, key, value) {
  if (!Number.isFinite(value)) return;
  if (!target[section]) target[section] = {};
  target[section][key] = (target[section][key] || 0) + value;
}

function addUsageTotals(target, usage = {}) {
  addNumber(target, "input_tokens", usage.input_tokens);
  addNumber(target, "output_tokens", usage.output_tokens);
  addNumber(target, "total_tokens", usage.total_tokens);

  const inputDetails =
    usage.input_tokens_details || usage.input_token_details || {};
  const outputDetails =
    usage.output_tokens_details || usage.output_token_details || {};

  addNestedNumber(
    target,
    "input_token_details",
    "cached_tokens",
    inputDetails.cached_tokens
  );
  addNestedNumber(
    target,
    "input_token_details",
    "audio_tokens",
    inputDetails.audio_tokens
  );
  addNestedNumber(
    target,
    "output_token_details",
    "reasoning_tokens",
    outputDetails.reasoning_tokens
  );
  addNestedNumber(
    target,
    "output_token_details",
    "audio_tokens",
    outputDetails.audio_tokens
  );
  addNumber(target, "audio_tokens", usage.audio_tokens);
}

function getUsageNumber(usage, key) {
  return Number.isFinite(usage[key]) ? usage[key] : 0;
}

function getUsageDetailNumber(usage, section, key) {
  const details = usage[section] || {};
  return Number.isFinite(details[key]) ? details[key] : 0;
}

function getUsageTotalsDelta(current = {}, persisted = {}) {
  return {
    input_tokens:
      getUsageNumber(current, "input_tokens") -
      getUsageNumber(persisted, "input_tokens"),
    output_tokens:
      getUsageNumber(current, "output_tokens") -
      getUsageNumber(persisted, "output_tokens"),
    total_tokens:
      getUsageNumber(current, "total_tokens") -
      getUsageNumber(persisted, "total_tokens"),
    audio_tokens:
      getUsageNumber(current, "audio_tokens") -
      getUsageNumber(persisted, "audio_tokens"),
    input_token_details: {
      cached_tokens:
        getUsageDetailNumber(current, "input_token_details", "cached_tokens") -
        getUsageDetailNumber(persisted, "input_token_details", "cached_tokens"),
      audio_tokens:
        getUsageDetailNumber(current, "input_token_details", "audio_tokens") -
        getUsageDetailNumber(persisted, "input_token_details", "audio_tokens"),
    },
    output_token_details: {
      reasoning_tokens:
        getUsageDetailNumber(
          current,
          "output_token_details",
          "reasoning_tokens"
        ) -
        getUsageDetailNumber(
          persisted,
          "output_token_details",
          "reasoning_tokens"
        ),
      audio_tokens:
        getUsageDetailNumber(current, "output_token_details", "audio_tokens") -
        getUsageDetailNumber(persisted, "output_token_details", "audio_tokens"),
    },
  };
}

function hasTranscriptionUsageDelta(delta) {
  return (
    delta.audioSeconds > 0 ||
    delta.finalTranscripts > 0 ||
    delta.input_tokens > 0 ||
    delta.output_tokens > 0 ||
    delta.total_tokens > 0 ||
    delta.audio_tokens > 0 ||
    delta.input_token_details.cached_tokens > 0 ||
    delta.input_token_details.audio_tokens > 0 ||
    delta.output_token_details.reasoning_tokens > 0 ||
    delta.output_token_details.audio_tokens > 0
  );
}

function flushTranscriptionUsageDelta(session, options = {}) {
  if (!session) return;

  const now = Date.now();
  if (!options.force && now - session.lastUsageFlushAt < 1000) return;

  const usageDelta = getUsageTotalsDelta(
    session.usageTotals,
    session.persistedUsageTotals
  );
  const delta = {
    ...usageDelta,
    finalTranscripts:
      session.finalTranscripts - session.persistedFinalTranscripts,
    audioSeconds: session.audioSeconds - session.persistedAudioSeconds,
  };

  if (!hasTranscriptionUsageDelta(delta)) {
    session.lastUsageFlushAt = now;
    return;
  }

  config.recordTranscriptionUsage(delta);
  session.persistedUsageTotals = JSON.parse(JSON.stringify(session.usageTotals));
  session.persistedFinalTranscripts = session.finalTranscripts;
  session.persistedAudioSeconds = session.audioSeconds;
  session.lastUsageFlushAt = now;
}

function recordRealtimeUsageFromEvent(session, event = {}) {
  const usage = event.usage || (event.response && event.response.usage);
  if (!usage || typeof usage !== "object") return;

  const usageEventId =
    event.event_id || event.response?.id || `${event.type}:${event.item_id || ""}`;
  if (session.seenUsageEventIds.has(usageEventId)) return;

  session.seenUsageEventIds.add(usageEventId);
  addUsageTotals(session.usageTotals, usage);
}

function getPcm16AudioSeconds(base64Audio) {
  try {
    return Buffer.from(base64Audio, "base64").length / (24000 * 2);
  } catch (error) {
    return 0;
  }
}

function flushTranscriptionUsage(session) {
  if (!session || session.usageFlushed) return;

  session.usageFlushed = true;
  flushTranscriptionUsageDelta(session, { force: true });
}

async function startRealtimeTranscription(sender, options = {}) {
  const apiKey = validateOpenAIKey();
  const sessionId = String(nextTranscriptionSessionId++);
  const audioQueue = [];
  const session = {
    id: sessionId,
    sender,
    audioQueue,
    ready: false,
    closeTimer: null,
    ws: null,
    audioSeconds: 0,
    finalTranscripts: 0,
    usageTotals: {},
    persistedUsageTotals: {},
    seenUsageEventIds: new Set(),
    persistedAudioSeconds: 0,
    persistedFinalTranscripts: 0,
    lastUsageFlushAt: 0,
    usageFlushed: false,
  };

  const ws = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-realtime",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );
  session.ws = ws;
  transcriptionSessions.set(sessionId, session);
  config.recordTranscriptionUsage({ sessions: 1 });

  ws.on("open", () => {
    session.ready = true;
    sendTranscriptionStatus(sender, sessionId, "connected");

    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              format: {
                type: "audio/pcm",
                rate: 24000,
              },
              transcription: {
                model: options.model || "gpt-realtime-whisper",
                language: options.language || "en",
              },
              turn_detection: null,
            },
          },
        },
      })
    );

    while (audioQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(audioQueue.shift());
    }
  });

  ws.on("message", (data) => {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch (error) {
      return;
    }

    recordRealtimeUsageFromEvent(session, event);
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      session.finalTranscripts += 1;
    }
    flushTranscriptionUsageDelta(session);

    if (!sender || sender.isDestroyed()) return;

    if (event.type === "conversation.item.input_audio_transcription.delta") {
      sender.send("audio-transcription-delta", {
        sessionId,
        itemId: event.item_id,
        delta: event.delta || "",
      });
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      sender.send("audio-transcription-completed", {
        sessionId,
        itemId: event.item_id,
        transcript: event.transcript || "",
      });
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      sendTranscriptionStatus(sender, sessionId, "speech_started");
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      sendTranscriptionStatus(sender, sessionId, "speech_stopped");
      return;
    }

    if (event.type === "error") {
      const message =
        event.error && event.error.message
          ? event.error.message
          : "Realtime transcription error.";
      sendTranscriptionError(sender, sessionId, message);
    }
  });

  ws.on("error", (error) => {
    sendTranscriptionError(sender, sessionId, error.message);
  });

  ws.on("close", () => {
    flushTranscriptionUsage(session);
    transcriptionSessions.delete(sessionId);
    sendTranscriptionStatus(sender, sessionId, "closed");
  });

  return {
    success: true,
    sessionId,
  };
}

function appendRealtimeAudio(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Audio chunk payload is required.");
  }

  const { sessionId, audio } = data;
  const session = transcriptionSessions.get(String(sessionId));
  if (!session || !session.ws) {
    throw new Error("Audio transcription session was not found.");
  }

  if (typeof audio !== "string" || audio.length === 0) {
    throw new Error("Audio chunk is required.");
  }

  const message = JSON.stringify({
    type: "input_audio_buffer.append",
    audio,
  });
  const audioSeconds = getPcm16AudioSeconds(audio);

  if (session.ws.readyState === WebSocket.OPEN && session.ready) {
    session.ws.send(message);
    session.audioSeconds += audioSeconds;
  } else if (
    session.ws.readyState === WebSocket.CONNECTING ||
    session.ws.readyState === WebSocket.OPEN
  ) {
    session.audioQueue.push(message);
    session.audioSeconds += audioSeconds;
  } else {
    throw new Error("Audio transcription session is closed.");
  }
  flushTranscriptionUsageDelta(session);

  return true;
}

function stopRealtimeTranscription(data) {
  const sessionId = data && data.sessionId;
  const session = transcriptionSessions.get(String(sessionId));
  if (!session || !session.ws) {
    return true;
  }

  if (session.closeTimer) {
    clearTimeout(session.closeTimer);
  }

  if (session.ws.readyState === WebSocket.OPEN) {
    try {
      session.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch (error) {
      // The server may reject an empty commit. Closing still releases resources.
    }
  }

  session.closeTimer = setTimeout(() => {
    if (
      session.ws.readyState === WebSocket.OPEN ||
      session.ws.readyState === WebSocket.CONNECTING
    ) {
      session.ws.close();
    }
  }, 1500);

  return true;
}

async function makeLLMRequest(event, data) {
  const apiKey = validateOpenAIKey();

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
              if (parsed.response && parsed.response.usage) {
                config.recordTextUsage(parsed.response.usage);
              }
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
