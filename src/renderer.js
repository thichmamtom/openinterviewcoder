// DOM Elements
const chatHistory = document.getElementById("chat-history");
const speechStatus = document.getElementById("speech-status");

// Chat state
let messages = [];

// System audio transcription state
let audioStream = null;
let audioContext = null;
let audioSource = null;
let audioProcessor = null;
let silentGain = null;
let transcriptionSessionId = null;
let isListeningToSystemAudio = false;
let isStoppingSystemAudio = false;
let currentTranscriptDelta = "";
let finalTranscriptSegments = [];
const TRANSCRIPTION_FINALIZE_DELAY_MS = 1800;

// Initialize marked with options
if (typeof marked === "undefined") {
  console.error("marked library not loaded");
} else {
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
}

// Initialize the UI
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
});

function setMousePassthroughState(enabled) {
  const value = enabled ? "true" : "false";
  document.documentElement.setAttribute("data-mouse-passthrough", value);
  document.body.setAttribute("data-mouse-passthrough", value);
}

// Set up event listeners
function setupEventListeners() {
  window.electronAPI
    .getSettings()
    .then((settings) =>
      setMousePassthroughState(settings.mousePassthrough !== false)
    )
    .catch((error) => console.error("Error loading mouse setting:", error));

  // Window position update
  window.electronAPI.onWindowPositionChanged((position) => {
    document.body.setAttribute("data-position", position);
  });

  // Handle keyboard shortcuts
  document.addEventListener("keydown", handleKeyboardShortcuts);

  // Handle new screenshots
  window.electronAPI.onScreenshotCaptured(addScreenshotToChat);

  // Handle chat reset
  window.electronAPI.onResetChat(resetChat);

  // Handle response updates
  window.electronAPI.onStreamUpdate(updateMessage);

  // Handle chat scrolling via keyboard shortcuts and global wheel events
  window.electronAPI.onScrollChat((direction) => {
    const chatContainer = document.querySelector(".chat-container");
    if (chatContainer) {
      if (typeof direction === "number") {
        // Numeric delta from uiohook global wheel capture
        chatContainer.scrollTop += direction;
      } else if (direction === "up") {
        chatContainer.scrollTop -= 100;
      } else if (direction === "down") {
        chatContainer.scrollTop += 100;
      }
    }
  });

  window.electronAPI.onToggleMouseIgnore((enabled) => {
    setMousePassthroughState(enabled);
  });

  // Handle selection capture (Cmd+Shift+C)
  window.electronAPI.onSelectionCaptured((text) => {
    if (text) {
      handleTestResponse(text);
    }
  });

  // Handle speech toggle (Cmd+Shift+V)
  window.electronAPI.onToggleSpeech(() => {
    toggleSpeechRecording();
  });

  window.electronAPI.onAudioTranscriptionDelta((data) => {
    if (!data || data.sessionId !== transcriptionSessionId) return;
    currentTranscriptDelta += data.delta || "";
    setSpeechStatus("listening", currentTranscriptDelta || "Listening to system audio...");
  });

  window.electronAPI.onAudioTranscriptionCompleted((data) => {
    if (!data || data.sessionId !== transcriptionSessionId) return;
    const transcript = (data.transcript || "").trim();
    if (transcript) {
      finalTranscriptSegments.push(transcript);
    }
    currentTranscriptDelta = "";
    setSpeechStatus("listening", "Listening to system audio...");
  });

  window.electronAPI.onAudioTranscriptionStatus((data) => {
    if (!data || data.sessionId !== transcriptionSessionId) return;
    if (data.status === "speech_started") {
      setSpeechStatus("listening", "Listening to system audio...");
    }
  });

  window.electronAPI.onAudioTranscriptionError((data) => {
    if (!data || data.sessionId !== transcriptionSessionId) return;
    const message = data.error || "System audio transcription failed.";
    console.error("System audio transcription error:", message);
    setSpeechStatus("error", message);
    addErrorMessage(message);
  });
}

async function toggleSpeechRecording() {
  if (isStoppingSystemAudio) {
    setSpeechStatus("transcribing", "Finalizing transcript...");
    return;
  }

  if (isListeningToSystemAudio) {
    await stopSpeechRecording();
    return;
  }

  await startSpeechRecording();
}

async function startSpeechRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error("System audio capture is not supported.");
    }

    finalTranscriptSegments = [];
    currentTranscriptDelta = "";
    setSpeechStatus("transcribing", "Connecting to system audio...");

    audioStream = await getSystemAudioStream();
    const result = await window.electronAPI.startAudioTranscription({
      model: "gpt-realtime-whisper",
      language: "en",
    });
    transcriptionSessionId = result.sessionId;

    startAudioStreaming(audioStream);
    isListeningToSystemAudio = true;
    setSpeechStatus("listening", "Listening to system audio...");
  } catch (error) {
    console.error("Error starting system audio transcription:", error);
    cleanupSpeechRecording();
    setSpeechStatus("error", error.message);
    addErrorMessage(error.message);
  }
}

async function getSystemAudioStream() {
  await window.electronAPI.enableLoopbackAudio();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });

    if (stream.getAudioTracks().length === 0) {
      throw new Error("No system audio track was captured.");
    }

    return stream;
  } finally {
    window.electronAPI
      .disableLoopbackAudio()
      .catch((error) => console.error("Failed to disable loopback mode:", error));
  }
}

function startAudioStreaming(stream) {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio is not supported.");
  }

  audioContext = new AudioContextConstructor({ sampleRate: 24000 });
  audioSource = audioContext.createMediaStreamSource(stream);
  audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  audioProcessor.onaudioprocess = (event) => {
    if (!transcriptionSessionId || isStoppingSystemAudio) return;

    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);
    output.fill(0);

    const audio = float32ToPcm16Base64(input);
    window.electronAPI
      .appendAudioTranscription({
        sessionId: transcriptionSessionId,
        audio,
      })
      .catch((error) => {
        console.error("Failed to append audio chunk:", error);
        setSpeechStatus("error", error.message);
      });
  };

  audioSource.connect(audioProcessor);
  audioProcessor.connect(silentGain);
  silentGain.connect(audioContext.destination);
}

async function stopSpeechRecording() {
  if (!isListeningToSystemAudio && !transcriptionSessionId) {
    cleanupSpeechRecording();
    return;
  }

  isStoppingSystemAudio = true;
  isListeningToSystemAudio = false;
  setSpeechStatus("transcribing", "Finalizing transcript...");

  try {
    stopAudioGraph();

    if (transcriptionSessionId) {
      await window.electronAPI.stopAudioTranscription({
        sessionId: transcriptionSessionId,
      });
      await delay(TRANSCRIPTION_FINALIZE_DELAY_MS);
    }

    const transcript = getCollectedTranscript();
    cleanupSpeechRecording();

    if (transcript) {
      clearSpeechStatus();
      handleTestResponse(transcript);
    } else {
      setSpeechStatus("error", "No system audio transcript was captured.");
    }
  } catch (error) {
    console.error("Error stopping system audio transcription:", error);
    cleanupSpeechRecording();
    setSpeechStatus("error", error.message);
    addErrorMessage(error.message);
  }
}

function stopAudioGraph() {
  if (audioProcessor) {
    audioProcessor.disconnect();
    audioProcessor.onaudioprocess = null;
  }

  if (audioSource) {
    audioSource.disconnect();
  }

  if (silentGain) {
    silentGain.disconnect();
  }

  if (audioContext && audioContext.state !== "closed") {
    audioContext.close().catch(() => {});
  }

  audioProcessor = null;
  audioSource = null;
  silentGain = null;
  audioContext = null;
}

function cleanupSpeechRecording() {
  stopAudioGraph();

  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
  }

  audioStream = null;
  transcriptionSessionId = null;
  isListeningToSystemAudio = false;
  isStoppingSystemAudio = false;
  currentTranscriptDelta = "";
  finalTranscriptSegments = [];
}

function getCollectedTranscript() {
  return [...finalTranscriptSegments, currentTranscriptDelta]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function float32ToPcm16Base64(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setSpeechStatus(state, message) {
  if (!speechStatus) return;

  speechStatus.hidden = false;
  speechStatus.textContent = message;
  speechStatus.setAttribute("data-state", state);
}

function clearSpeechStatus() {
  if (!speechStatus) return;

  speechStatus.hidden = true;
  speechStatus.textContent = "";
  speechStatus.removeAttribute("data-state");
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(event) {
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") {
    return;
  }

  if (event.key === "Escape") {
    window.electronAPI.hideWindow();
  }

  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "t") {
    event.preventDefault();
    handleTestResponse("write python code to print 'Hello, world!'");
  }
}

// Scroll to bottom of chat
function scrollToBottom() {
  const chatContainer = document.querySelector(".chat-container");
  if (chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// Update message
function updateMessage(data) {
  const { messageId, content, isComplete } = data;

  // Find or create message element
  let messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) {
    messageEl = createMessageElement(messageId);
    chatHistory.appendChild(messageEl);
    updateNullStateVisibility();
  }

  // Update content
  const contentWrapper = messageEl.querySelector(".message-content");
  if (contentWrapper) {
    if (content && typeof content === "string") {
      contentWrapper.innerHTML = marked.parse(content);
    } else {
      contentWrapper.innerHTML = ""; // Clear content if it's null/undefined or not a string
    }
    messageEl.style.display = "block"; // Show when content is added
    scrollToBottom();
  }

  // Handle completion
  if (isComplete) {
    // Update the message in the messages array
    const messageIndex = messages.findIndex((m) => m.messageId === messageId);
    if (messageIndex !== -1) {
      messages[messageIndex].content = content;
      messages[messageIndex].status = "completed";
    }
  }
}

// Create message element
function createMessageElement(messageId) {
  const messageEl = document.createElement("div");
  messageEl.className = "message assistant";
  messageEl.setAttribute("data-message-id", messageId);
  messageEl.style.display = "none"; // Hide initially

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "message-content markdown-body";
  messageEl.appendChild(contentWrapper);

  return messageEl;
}

// Add error message
function addErrorMessage(message) {
  const errorEl = document.createElement("div");
  errorEl.className = "message error";
  errorEl.textContent = `Error: ${message}`;
  chatHistory.appendChild(errorEl);
  scrollToBottom();
}

// Add screenshot to chat
async function addScreenshotToChat(data) {
  const message = {
    type: "screenshot",
    timestamp: Date.now(),
    filePath: data.filePath,
  };

  messages.push(message);

  const messageEl = document.createElement("div");
  messageEl.className = "message user";

  const img = document.createElement("img");
  img.src = `file://${data.filePath}`;
  img.className = "screenshot-thumbnail";
  img.alt = "Screenshot";
  img.addEventListener("click", () =>
    window.electronAPI.openFile(data.filePath)
  );

  messageEl.appendChild(img);
  chatHistory.appendChild(messageEl);
  scrollToBottom();

  try {
    const result = await window.electronAPI.analyzeScreenshot({
      filePath: data.filePath,
      history: messages
        .filter((m) => m.type === "assistant")
        .map((m) => ({
          role: "assistant",
          content: m.content,
        })),
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    messages.push({
      type: "assistant",
      timestamp: Date.now(),
      messageId: result.messageId,
      provider: result.provider,
      model: result.model,
      content: "",
      status: "pending",
    });
  } catch (error) {
    addErrorMessage(error.message);
  }
}

// Reset chat
function resetChat() {
  chatHistory.innerHTML = "";
  messages = [];
  // Also clear backend conversation memory
  window.electronAPI.resetConversation();
  updateNullStateVisibility();
}

function updateNullStateVisibility() {
  const nullState = document.getElementById("null-state");
  if (nullState) {
    nullState.style.display = messages.length === 0 ? "flex" : "none";
  }
}

// Handle test response
async function handleTestResponse(prompt) {
  try {
    // Add user message
    const userMessage = {
      type: "user",
      timestamp: Date.now(),
      content: prompt,
    };
    messages.push(userMessage);

    const userMessageEl = document.createElement("div");
    userMessageEl.className = "message user";
    userMessageEl.textContent = prompt;
    chatHistory.appendChild(userMessageEl);

    // Add assistant message placeholder
    const messageId = Date.now().toString();
    const assistantMessage = {
      type: "assistant",
      timestamp: Date.now(),
      messageId,
      content: "",
      status: "pending",
    };
    messages.push(assistantMessage);

    const assistantMessageEl = createMessageElement(messageId);
    chatHistory.appendChild(assistantMessageEl);
    scrollToBottom();

    const result = await window.electronAPI.testResponse(prompt);
    if (!result.success) {
      throw new Error(result.error);
    }

    // Update the message with the response
    const contentWrapper = assistantMessageEl.querySelector(".message-content");
    if (contentWrapper) {
      if (result.content && typeof result.content === "string") {
        contentWrapper.innerHTML = marked.parse(result.content);
      } else {
        contentWrapper.innerHTML = ""; // Clear content if it's null/undefined or not a string
      }
      scrollToBottom();
    }

    // Update the message in the messages array
    assistantMessage.content = result.content;
    assistantMessage.status = "completed";
  } catch (error) {
    console.error("Error in handleTestResponse:", error);
    addErrorMessage(error.message);
  }
}
