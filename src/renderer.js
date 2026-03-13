// DOM Elements
const chatHistory = document.getElementById("chat-history");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let messages = [];
let speechRecognition = null;
let isListening = false;

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

// Set up event listeners
function setupEventListeners() {
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

  // Handle selection capture (Cmd+Shift+C)
  window.electronAPI.onSelectionCaptured((text) => {
    if (text) {
      showToast("📋 Selection captured");
      handleTestResponse(text);
    }
  });

  // // Handle speech toggle (Cmd+Shift+V)
  // window.electronAPI.onToggleSpeech(() => {
  //   toggleSpeechRecognition();
  // });
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
    // Double-check scroll after a short delay to handle dynamic content
    setTimeout(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 100);
  }
}

// Update message
function updateMessage(data) {
  const { messageId, content, isComplete } = data;
  console.log("updateMessage called:", {
    messageId,
    contentLength: content.length,
    isComplete,
  });

  // Find or create message element
  let messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) {
    console.log("Creating new message element");
    messageEl = createMessageElement(messageId);
    chatHistory.appendChild(messageEl);
    // Show typing indicator for new messages
    typingIndicator.classList.add("visible");
    console.log("Typing indicator shown");
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
    console.log("Message complete, hiding typing indicator");
    typingIndicator.classList.remove("visible");

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
    // Show typing indicator before analyzing screenshot
    typingIndicator.classList.add("visible");
    console.log("Showing typing indicator for screenshot analysis");

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
    typingIndicator.classList.remove("visible");
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

    // Show typing indicator
    typingIndicator.classList.add("visible");
    console.log("Showing typing indicator for new test response");

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
      assistantMessageEl.classList.remove("loading");
      scrollToBottom();
    }

    // Update the message in the messages array
    assistantMessage.content = result.content;
    assistantMessage.status = "completed";

    // Hide typing indicator
    typingIndicator.classList.remove("visible");
    console.log("Test response complete, hiding typing indicator");
  } catch (error) {
    console.error("Error in handleTestResponse:", error);
    typingIndicator.classList.remove("visible");
    addErrorMessage(error.message);
  }
}

// Speech-to-text using Web Speech API
function toggleSpeechRecognition() {
  if (isListening) {
    stopSpeechRecognition();
    return;
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showToast("⚠️ Speech recognition not supported");
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = "en-US";

  let finalTranscript = "";
  let interimTranscript = "";

  speechRecognition.onstart = () => {
    isListening = true;
    showSpeechIndicator(true);
    showToast("🎤 Listening...");
  };

  speechRecognition.onresult = (event) => {
    interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript + " ";
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    // Update the speech indicator with live transcript
    updateSpeechText(finalTranscript + interimTranscript);
  };

  speechRecognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    if (event.error !== "aborted") {
      showToast(`⚠️ Speech error: ${event.error}`);
    }
    stopSpeechRecognition();
  };

  speechRecognition.onend = () => {
    isListening = false;
    showSpeechIndicator(false);

    const transcript = finalTranscript.trim();
    if (transcript) {
      showToast("✅ Sending to AI...");
      handleTestResponse(transcript);
    }
  };

  speechRecognition.start();
}

function stopSpeechRecognition() {
  if (speechRecognition) {
    speechRecognition.stop();
    speechRecognition = null;
  }
  isListening = false;
  showSpeechIndicator(false);
}

function showSpeechIndicator(show) {
  const indicator = document.getElementById("speech-indicator");
  if (indicator) {
    indicator.style.display = show ? "flex" : "none";
  }
}

function updateSpeechText(text) {
  const speechText = document.getElementById("speech-text");
  if (speechText) {
    speechText.textContent = text || "Listening...";
  }
}

// Toast notification
function showToast(message) {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
