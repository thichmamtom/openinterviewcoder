const { contextBridge, ipcRenderer, shell } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Get settings
  getSettings: () => ipcRenderer.invoke("get-settings"),

  // Save settings
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // Show settings window
  showSettings: () => ipcRenderer.invoke("show-settings"),

  // Get default prompt
  getDefaultPrompt: () => ipcRenderer.invoke("get-default-prompt"),

  // Usage
  getUsage: () => ipcRenderer.invoke("get-usage"),
  resetUsage: () => ipcRenderer.invoke("reset-usage"),
  onUsageUpdated: (callback) =>
    ipcRenderer.on("usage-updated", (event, value) => callback(value)),

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  setOverlayWindow: (overlayWindow) =>
    ipcRenderer.invoke("set-overlay-window", overlayWindow),

  // Context menu
  buildContextMenu: () => ipcRenderer.invoke("build-context-menu"),

  // Clipboard
  writeClipboardText: (text) => ipcRenderer.invoke("write-clipboard-text", text),

  // Screenshot handling
  onScreenshotCaptured: (callback) =>
    ipcRenderer.on("screenshot-captured", (event, value) => callback(value)),
  analyzeScreenshot: (data) => ipcRenderer.invoke("analyze-screenshot", data),
  onStreamUpdate: (callback) =>
    ipcRenderer.on("stream-update", (event, value) => callback(value)),
  onCopyLastResponse: (callback) =>
    ipcRenderer.on("copy-last-response", (event) => callback()),
  getScreenshotsDirectory: () =>
    ipcRenderer.invoke("get-screenshots-directory"),
  getRecentScreenshots: () => ipcRenderer.invoke("get-recent-screenshots"),
  ensureScreenRecordingPermission: () =>
    ipcRenderer.invoke("ensure-screen-recording-permission"),
  getSystemAudioCaptureSupport: () =>
    ipcRenderer.invoke("get-system-audio-capture-support"),

  // Test response
  testResponse: (prompt) => ipcRenderer.invoke("test-response", prompt),

  // System audio loopback
  enableLoopbackAudio: () => ipcRenderer.invoke("enable-loopback-audio"),
  disableLoopbackAudio: () => ipcRenderer.invoke("disable-loopback-audio"),

  // Realtime audio transcription
  startAudioTranscription: (options) =>
    ipcRenderer.invoke("audio-transcription-start", options),
  appendAudioTranscription: (data) =>
    ipcRenderer.invoke("audio-transcription-append", data),
  stopAudioTranscription: (data) =>
    ipcRenderer.invoke("audio-transcription-stop", data),
  onAudioTranscriptionDelta: (callback) =>
    ipcRenderer.on("audio-transcription-delta", (event, value) =>
      callback(value)
    ),
  onAudioTranscriptionCompleted: (callback) =>
    ipcRenderer.on("audio-transcription-completed", (event, value) =>
      callback(value)
    ),
  onAudioTranscriptionStatus: (callback) =>
    ipcRenderer.on("audio-transcription-status", (event, value) =>
      callback(value)
    ),
  onAudioTranscriptionError: (callback) =>
    ipcRenderer.on("audio-transcription-error", (event, value) =>
      callback(value)
    ),

  // File handling
  openFile: (path) => shell.openPath(path),

  // Chat reset
  onResetChat: (callback) =>
    ipcRenderer.on("reset-chat", (event) => callback()),

  // Reset conversation memory (backend)
  resetConversation: () => ipcRenderer.invoke("reset-conversation"),

  // Window position
  onWindowPositionChanged: (callback) =>
    ipcRenderer.on("window-position-changed", (event, value) =>
      callback(value)
    ),
  updatePosition: (position) => ipcRenderer.invoke("update-position", position),

  // Scroll chat
  onScrollChat: (callback) =>
    ipcRenderer.on("scroll-chat", (event, direction) => callback(direction)),

  // Selection capture (Cmd+Shift+C)
  onSelectionCaptured: (callback) =>
    ipcRenderer.on("selection-captured", (event, text) => callback(text)),

  // Speech-to-text toggle (Cmd+Shift+V)
  onToggleSpeech: (callback) =>
    ipcRenderer.on("toggle-speech", (event) => callback()),

  // Click-through mode
  onToggleMouseIgnore: (callback) =>
    ipcRenderer.on("toggle-mouse-ignore", (event, value) => callback(value)),
  onAppBackgroundColorUpdated: (callback) =>
    ipcRenderer.on("app-background-color-updated", (event, value) =>
      callback(value)
    ),
  onResponseLanguageUpdated: (callback) =>
    ipcRenderer.on("response-language-updated", (event, value) =>
      callback(value)
    ),

  // Overlay customization mode
  onOverlayWindowUpdated: (callback) =>
    ipcRenderer.on("overlay-window-updated", (event, value) => callback(value)),
  onOverlayEditModeChanged: (callback) =>
    ipcRenderer.on("overlay-edit-mode-changed", (event, value) =>
      callback(value)
    ),
});

// No need for additional electron context bridge since we're handling everything through electronAPI
