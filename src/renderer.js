// DOM Elements
const chatHistory = document.getElementById("chat-history");
const speechStatus = document.getElementById("speech-status");

// Chat state
let messages = [];
let autoScrollDuringStream = true;
let activeStreamCount = 0;
let programmaticScrollToken = 0;

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
let activeTranscriptionMessage = null;
let responseLanguage = "en";
let statusAutoHideTimer = null;
const TRANSCRIPTION_FINALIZE_DELAY_MS = 1800;
const COPY_BUTTON_RESET_MS = 1200;

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
  initializeShortcutIcons();
  setupEventListeners();
  updateNullStateVisibility();
});

function setMousePassthroughState(enabled) {
  const value = enabled ? "true" : "false";
  document.documentElement.setAttribute("data-mouse-passthrough", value);
  document.body.setAttribute("data-mouse-passthrough", value);
}

function setAppBackgroundColorState(background = {}) {
  const color =
    typeof background === "string" ? background : background && background.color;
  const opacity =
    background && typeof background === "object" ? background.opacity : undefined;
  const normalizedColor = normalizeHexColor(color);
  const normalizedOpacity = normalizeOpacity(opacity);
  const borderOpacity = Math.min(normalizedOpacity * 0.55, 0.5);
  const rgb = hexToRgb(normalizedColor);

  document.documentElement.style.setProperty(
    "--app-background-color",
    normalizedColor
  );
  document.documentElement.style.setProperty(
    "--app-background-rgb",
    `${rgb.r}, ${rgb.g}, ${rgb.b}`
  );
  document.documentElement.style.setProperty(
    "--app-background-opacity",
    normalizedOpacity.toFixed(2)
  );
  document.documentElement.style.setProperty(
    "--app-background-border-opacity",
    borderOpacity.toFixed(2)
  );
  document.body.style.setProperty("--app-background-color", normalizedColor);
  document.body.style.setProperty(
    "--app-background-rgb",
    `${rgb.r}, ${rgb.g}, ${rgb.b}`
  );
  document.body.style.setProperty(
    "--app-background-opacity",
    normalizedOpacity.toFixed(2)
  );
  document.body.style.setProperty(
    "--app-background-border-opacity",
    borderOpacity.toFixed(2)
  );
}

function normalizeHexColor(color) {
  const rawValue = typeof color === "string" ? color.trim() : "";
  const match = rawValue.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (!match) return "#000000";

  const hex = match[1].toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

function normalizeOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.72;

  return Math.min(Math.max(number, 0), 1);
}

function hexToRgb(color) {
  const normalizedColor = normalizeHexColor(color);
  const value = Number.parseInt(normalizedColor.slice(1), 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function setOverlayEditModeState(state = {}) {
  const enabled = state.enabled ? "true" : "false";
  const freeDragInSettings = state.freeDragInSettings !== false ? "true" : "false";

  document.documentElement.setAttribute("data-overlay-edit-mode", enabled);
  document.body.setAttribute("data-overlay-edit-mode", enabled);
  document.documentElement.setAttribute(
    "data-free-drag-in-settings",
    freeDragInSettings
  );
  document.body.setAttribute("data-free-drag-in-settings", freeDragInSettings);
}

function setResponseLanguageState(language = "en") {
  responseLanguage = language === "vi" ? "vi" : "en";
  document.documentElement.setAttribute("data-response-language", responseLanguage);
  document.body.setAttribute("data-response-language", responseLanguage);
}

function getResponseLanguageName(language = responseLanguage) {
  return language === "vi" ? "Vietnamese" : "English";
}

function initializeShortcutIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

// Set up event listeners
function setupEventListeners() {
  window.electronAPI
    .getSettings()
    .then((settings) => {
      setMousePassthroughState(settings.mousePassthrough !== false);
      setAppBackgroundColorState({
        color: settings.appBackgroundColor,
        opacity: settings.appBackgroundOpacity,
      });
      setResponseLanguageState(settings.responseLanguage);
    })
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
  window.electronAPI.onCopyLastResponse(copyLastAssistantResponse);

  // Handle chat scrolling via keyboard shortcuts and global wheel events
  window.electronAPI.onScrollChat((direction) => {
    const chatContainer = document.querySelector(".chat-container");
    if (chatContainer) {
      disableAutoScrollForActiveStream();
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

  const chatContainer = document.querySelector(".chat-container");
  if (chatContainer) {
    chatContainer.addEventListener("wheel", () => {
      disableAutoScrollForActiveStream();
    });

    chatContainer.addEventListener("scroll", () => {
      if (programmaticScrollToken === 0) {
        disableAutoScrollForActiveStream();
      }
    });
  }

  window.electronAPI.onToggleMouseIgnore((enabled) => {
    setMousePassthroughState(enabled);
  });

  window.electronAPI.onAppBackgroundColorUpdated((color) => {
    setAppBackgroundColorState(color);
  });

  window.electronAPI.onResponseLanguageUpdated((data) => {
    const language = data && data.language ? data.language : "en";
    setResponseLanguageState(language);
    if (data && data.toggled) {
      showTransientStatus(
        `Response language: ${getResponseLanguageName(language)}`
      );
    }
  });

  window.electronAPI.onOverlayEditModeChanged((state) => {
    setOverlayEditModeState(state);
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
    updateLiveTranscriptionMessage();
    setSpeechStatus("listening", "Listening to system audio...");
  });

  window.electronAPI.onAudioTranscriptionCompleted((data) => {
    if (!data || data.sessionId !== transcriptionSessionId) return;
    const transcript = (data.transcript || "").trim();
    if (transcript) {
      finalTranscriptSegments.push(transcript);
    }
    currentTranscriptDelta = "";
    updateLiveTranscriptionMessage();
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
    finalizeLiveTranscriptionMessage(getCollectedTranscript());
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
    removeLiveTranscriptionMessage();
    setSpeechStatus("transcribing", "Connecting to system audio...");

    const audioCaptureSupport =
      await window.electronAPI.getSystemAudioCaptureSupport();
    if (!audioCaptureSupport.supported) {
      throw new Error(audioCaptureSupport.reason);
    }

    const hasScreenPermission =
      await window.electronAPI.ensureScreenRecordingPermission();
    if (!hasScreenPermission) {
      throw new Error(
        "Screen Recording permission is required before system audio can start. Enable it in System Settings, then restart the app."
      );
    }

    audioStream = await getSystemAudioStream();
    const result = await window.electronAPI.startAudioTranscription({
      model: "gpt-realtime-whisper",
      language: "en",
    });
    transcriptionSessionId = result.sessionId;

    startLiveTranscriptionMessage();
    startAudioStreaming(audioStream);
    isListeningToSystemAudio = true;
    setSpeechStatus("listening", "Listening to system audio...");
  } catch (error) {
    console.error("Error starting system audio transcription:", error);
    cleanupSpeechRecording();
    removeLiveTranscriptionMessage();
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
    finalizeLiveTranscriptionMessage(transcript);
    const transcriptionMessage = activeTranscriptionMessage;
    cleanupSpeechRecording();

    if (transcript) {
      clearSpeechStatus();
      activeTranscriptionMessage = null;
      handleTestResponse(transcript, {
        userMessage: transcriptionMessage && transcriptionMessage.message,
        userMessageEl: transcriptionMessage && transcriptionMessage.element,
      });
    } else {
      removeLiveTranscriptionMessage(transcriptionMessage);
      setSpeechStatus("error", "No system audio transcript was captured.");
    }
  } catch (error) {
    console.error("Error stopping system audio transcription:", error);
    finalizeLiveTranscriptionMessage(getCollectedTranscript());
    activeTranscriptionMessage = null;
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

function startLiveTranscriptionMessage() {
  const message = {
    type: "user",
    timestamp: Date.now(),
    content: "",
    status: "transcribing",
    source: "system-audio",
  };
  const messageEl = createUserTextMessageElement(
    "Listening to system audio...",
    ""
  );

  messageEl.classList.add("transcription-live", "transcription-empty");
  messages.push(message);
  activeTranscriptionMessage = { message, element: messageEl };
  chatHistory.appendChild(messageEl);
  updateNullStateVisibility();
  scrollToBottom();
}

function updateLiveTranscriptionMessage() {
  if (!activeTranscriptionMessage) return;

  const transcript = getCollectedTranscript();
  const displayText = transcript || "Listening to system audio...";

  activeTranscriptionMessage.message.content = transcript;
  setUserTextMessageContent(
    activeTranscriptionMessage.element,
    displayText,
    transcript
  );
  activeTranscriptionMessage.element.classList.toggle(
    "transcription-empty",
    !transcript
  );
  scrollToBottom();
}

function finalizeLiveTranscriptionMessage(transcript) {
  if (!activeTranscriptionMessage) return;

  const finalTranscript = (transcript || "").trim();

  activeTranscriptionMessage.message.content = finalTranscript;
  activeTranscriptionMessage.message.status = finalTranscript
    ? "submitted"
    : "empty";
  setUserTextMessageContent(
    activeTranscriptionMessage.element,
    finalTranscript || "Listening to system audio...",
    finalTranscript
  );
  activeTranscriptionMessage.element.classList.remove("transcription-live");
  activeTranscriptionMessage.element.classList.toggle(
    "transcription-empty",
    !finalTranscript
  );
  scrollToBottom();
}

function removeLiveTranscriptionMessage(
  transcriptionMessage = activeTranscriptionMessage
) {
  if (!transcriptionMessage) return;

  messages = messages.filter((message) => message !== transcriptionMessage.message);

  if (transcriptionMessage.element && transcriptionMessage.element.parentNode) {
    transcriptionMessage.element.remove();
  }

  if (activeTranscriptionMessage === transcriptionMessage) {
    activeTranscriptionMessage = null;
  }
  updateNullStateVisibility();
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

  clearTimeout(statusAutoHideTimer);
  statusAutoHideTimer = null;
  speechStatus.hidden = false;
  speechStatus.textContent = message;
  speechStatus.setAttribute("data-state", state);
}

function clearSpeechStatus() {
  if (!speechStatus) return;

  clearTimeout(statusAutoHideTimer);
  statusAutoHideTimer = null;
  speechStatus.hidden = true;
  speechStatus.textContent = "";
  speechStatus.removeAttribute("data-state");
}

function showTransientStatus(message, state = "info", duration = 1600) {
  setSpeechStatus(state, message);

  const expectedMessage = message;
  statusAutoHideTimer = setTimeout(() => {
    if (
      speechStatus &&
      speechStatus.textContent === expectedMessage &&
      speechStatus.getAttribute("data-state") === state
    ) {
      clearSpeechStatus();
    }
  }, duration);
}

function resetAutoScrollForRequest() {
  autoScrollDuringStream = true;
  activeStreamCount += 1;
}

function finishStreamingRequest() {
  activeStreamCount = Math.max(0, activeStreamCount - 1);
}

function disableAutoScrollForActiveStream() {
  if (activeStreamCount > 0) {
    autoScrollDuringStream = false;
  }
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

  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "y"
  ) {
    event.preventDefault();
    copyLastAssistantResponse();
  }
}

// Scroll to bottom of chat
function scrollToBottom() {
  const chatContainer = document.querySelector(".chat-container");
  if (chatContainer) {
    const scrollToken = programmaticScrollToken + 1;
    programmaticScrollToken = scrollToken;
    chatContainer.scrollTop = chatContainer.scrollHeight;
    setTimeout(() => {
      if (programmaticScrollToken === scrollToken) {
        programmaticScrollToken = 0;
      }
    }, 100);
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
    setMessageCopyContent(messageEl, typeof content === "string" ? content : "");
    messageEl.style.display = "block"; // Show when content is added
    if (autoScrollDuringStream) {
      scrollToBottom();
    }
  }

  // Handle completion
  if (isComplete) {
    finishStreamingRequest();
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

  addMessageCopyButton(messageEl);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "message-content markdown-body";
  messageEl.appendChild(contentWrapper);

  return messageEl;
}

function createUserTextMessageElement(content = "", copyContent = content) {
  const messageEl = document.createElement("div");
  messageEl.className = "message user";
  addMessageCopyButton(messageEl, copyContent);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "message-content";
  contentWrapper.textContent = content;
  messageEl.appendChild(contentWrapper);

  return messageEl;
}

function setUserTextMessageContent(messageEl, content, copyContent = content) {
  if (!messageEl) return;

  let contentWrapper = messageEl.querySelector(".message-content");
  if (!contentWrapper) {
    messageEl.textContent = "";
    contentWrapper = document.createElement("div");
    contentWrapper.className = "message-content";
    messageEl.appendChild(contentWrapper);
  }
  contentWrapper.textContent = content;
  setMessageCopyContent(messageEl, copyContent);
}

function addMessageCopyButton(messageEl, copyContent = "") {
  let button = messageEl.querySelector(".message-copy-button");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "message-copy-button";
    button.title = "Copy message";
    button.setAttribute("aria-label", "Copy message");
    button.innerHTML = '<i data-lucide="copy"></i>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyMessageContent(messageEl, button);
    });
    messageEl.addEventListener("click", (event) => {
      if (event.target.closest?.("button, a, input, textarea, select, img")) {
        return;
      }
      if (window.getSelection?.().toString()) return;
      copyMessageContent(messageEl, button);
    });
    messageEl.insertBefore(button, messageEl.firstChild);
    initializeShortcutIcons();
  }

  setMessageCopyContent(messageEl, copyContent);
  return button;
}

function setMessageCopyContent(messageEl, content = "") {
  if (!messageEl) return;

  const copyContent = typeof content === "string" ? content : String(content || "");
  messageEl.dataset.copyContent = copyContent;

  const button = messageEl.querySelector(".message-copy-button");
  if (button) {
    button.disabled = copyContent.trim().length === 0;
  }
}

async function copyMessageContent(messageEl, button) {
  const copyContent = messageEl.dataset.copyContent || "";
  if (!copyContent.trim()) return;

  try {
    await writeClipboardText(copyContent);
    setMessageCopyButtonState(button, "copied");
  } catch (error) {
    console.error("Failed to copy message:", error);
    setMessageCopyButtonState(button, "error");
  }
}

function getLastAssistantCopyTarget() {
  const assistantMessageElements = Array.from(
    document.querySelectorAll(".message.assistant")
  ).reverse();

  for (const messageEl of assistantMessageElements) {
    const copyContent = messageEl.dataset.copyContent || "";
    if (copyContent.trim()) {
      return {
        content: copyContent,
        button: messageEl.querySelector(".message-copy-button"),
      };
    }
  }

  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.type === "assistant" && message.content);

  return latestAssistantMessage
    ? { content: latestAssistantMessage.content, button: null }
    : null;
}

async function copyLastAssistantResponse() {
  const target = getLastAssistantCopyTarget();

  if (!target) {
    showTransientStatus("No response to copy", "error");
    return;
  }

  try {
    await writeClipboardText(target.content);
    setMessageCopyButtonState(target.button, "copied");
    showTransientStatus("Last response copied");
  } catch (error) {
    console.error("Failed to copy last response:", error);
    setMessageCopyButtonState(target.button, "error");
    showTransientStatus("Copy failed", "error");
  }
}

async function writeClipboardText(text) {
  if (
    window.electronAPI &&
    typeof window.electronAPI.writeClipboardText === "function"
  ) {
    try {
      await window.electronAPI.writeClipboardText(text);
      return;
    } catch (error) {
      console.warn("Electron clipboard write failed:", error);
    }
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    if (!document.execCommand || !document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    textArea.remove();
  }
}

function setMessageCopyButtonState(button, state) {
  if (!button) return;

  const isCopied = state === "copied";
  const isError = state === "error";
  button.classList.toggle("copied", isCopied);
  button.classList.toggle("copy-error", isError);
  button.innerHTML = `<i data-lucide="${isCopied ? "check" : "copy"}"></i>`;
  button.setAttribute(
    "aria-label",
    isCopied ? "Copied message" : "Copy message"
  );
  button.title = isCopied ? "Copied" : "Copy message";
  initializeShortcutIcons();

  clearTimeout(button.copyResetTimer);
  button.copyResetTimer = setTimeout(() => {
    button.classList.remove("copied", "copy-error");
    button.innerHTML = '<i data-lucide="copy"></i>';
    button.setAttribute("aria-label", "Copy message");
    button.title = "Copy message";
    initializeShortcutIcons();
  }, COPY_BUTTON_RESET_MS);
}

// Add error message
function addErrorMessage(message) {
  const errorEl = document.createElement("div");
  errorEl.className = "message error";
  const errorText = `Error: ${message}`;
  addMessageCopyButton(errorEl, errorText);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "message-content";
  contentWrapper.textContent = errorText;
  errorEl.appendChild(contentWrapper);
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
  updateNullStateVisibility();

  const messageEl = document.createElement("div");
  messageEl.className = "message user";
  addMessageCopyButton(messageEl, `![Screenshot](file://${data.filePath})`);

  const img = document.createElement("img");
  img.src = `file://${data.filePath}`;
  img.className = "screenshot-thumbnail";
  img.alt = "Screenshot";
  img.addEventListener("click", () =>
    window.electronAPI.openFile(data.filePath)
  );

  messageEl.appendChild(img);
  chatHistory.appendChild(messageEl);
  resetAutoScrollForRequest();
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
    finishStreamingRequest();
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
  const hasResponseScreen = messages.length > 0;

  if (nullState) {
    nullState.style.display = hasResponseScreen ? "none" : "flex";
  }
  document.body.setAttribute(
    "data-response-screen",
    hasResponseScreen ? "true" : "false"
  );
}

// Handle test response
async function handleTestResponse(prompt, options = {}) {
  try {
    const promptText = typeof prompt === "string" ? prompt : String(prompt || "");
    if (!promptText.trim()) return;

    resetAutoScrollForRequest();
    // Add user message
    let userMessage = options.userMessage;
    let userMessageEl = options.userMessageEl;

    if (userMessage && userMessageEl) {
      userMessage.content = promptText;
      userMessage.status = "submitted";
      setUserTextMessageContent(userMessageEl, promptText);
      userMessageEl.classList.remove("transcription-live", "transcription-empty");
    } else {
      userMessage = {
        type: "user",
        timestamp: Date.now(),
        content: promptText,
      };
      messages.push(userMessage);
      updateNullStateVisibility();

      userMessageEl = createUserTextMessageElement(promptText);
      chatHistory.appendChild(userMessageEl);
    }

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

    const result = await window.electronAPI.testResponse(promptText);
    if (!result.success) {
      throw new Error(result.error);
    }

    // Update the message with the response
    const contentWrapper = assistantMessageEl.querySelector(".message-content");
    if (contentWrapper && typeof result.content === "string") {
      contentWrapper.innerHTML = marked.parse(result.content);
      setMessageCopyContent(assistantMessageEl, result.content);
      scrollToBottom();
    }

    // Update the message in the messages array
    if (typeof result.content === "string") {
      assistantMessage.content = result.content;
    }
    assistantMessage.status = "completed";
  } catch (error) {
    console.error("Error in handleTestResponse:", error);
    finishStreamingRequest();
    addErrorMessage(error.message);
  }
}
