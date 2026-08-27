require("dotenv").config();
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  desktopCapturer,
  clipboard,
  Menu,
  Tray,
} = require("electron");
const path = require("path");
const { execSync } = require("child_process");
const { uIOhook } = require("uiohook-napi");
const {
  ensureScreenRecordingPermission,
  captureFullScreen,
  getRecentScreenshots,
} = require("./screenshot");
const { initializeLLMService, resetConversationHistory } = require("./llm-service");
const { initMain: initLoopbackAudio } = require("electron-audio-loopback");
const config = require("./config");

initLoopbackAudio({
  forceCoreAudioTap: true,
  sourcesOptions: {
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 },
  },
});

function compareVersion(version, target) {
  const versionParts = String(version).split(".").map((part) => Number(part) || 0);
  const targetParts = String(target).split(".").map((part) => Number(part) || 0);
  const length = Math.max(versionParts.length, targetParts.length);

  for (let index = 0; index < length; index += 1) {
    const versionPart = versionParts[index] || 0;
    const targetPart = targetParts[index] || 0;
    if (versionPart > targetPart) return 1;
    if (versionPart < targetPart) return -1;
  }

  return 0;
}

function getSystemAudioCaptureSupport() {
  if (process.platform !== "darwin") {
    return { supported: true };
  }

  const version =
    typeof process.getSystemVersion === "function"
      ? process.getSystemVersion()
      : "0.0.0";

  if (compareVersion(version, "12.7.6") <= 0) {
    return {
      supported: false,
      reason:
        `Native system audio capture is not supported on macOS ${version}. ` +
        "Upgrade to macOS 13 or newer, or route system audio through a virtual audio device such as BlackHole or Soundflower.",
    };
  }

  return { supported: true };
}

// IPC handlers for settings
ipcMain.handle("get-settings", () => {
  return {
    openaiKey: config.getOpenAIKey(),
    openaiBaseUrl: config.getOpenAIBaseURL(),
    customPrompt: config.getCustomPrompt(),
    responseLanguage: config.getResponseLanguage(),
    responseLanguages: config.RESPONSE_LANGUAGES,
    promptVariables: config.PROMPT_VARIABLES,
    model: config.getModel(),
    availableModels: config.AVAILABLE_MODELS,
    mousePassthrough: config.getMousePassthrough(),
    appBackgroundColor: config.getAppBackgroundColor(),
    appBackgroundOpacity: config.getAppBackgroundOpacity(),
    overlayWindow: config.getOverlayWindow(),
  };
});

ipcMain.handle("get-default-prompt", () => {
  return config.DEFAULT_PROMPT;
});

ipcMain.handle("get-usage", () => {
  return config.getUsage();
});

ipcMain.handle("reset-usage", () => {
  return config.resetUsage();
});

config.onUsageUpdated((usage) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("usage-updated", usage);
    }
  });
});

// IPC handler for scrolling chat
ipcMain.handle("scroll-chat", (event, direction) => {
  if (invisibleWindow) {
    invisibleWindow.webContents.send("scroll-chat", direction);
  }
  return true;
});

ipcMain.handle("save-settings", async (event, settings) => {
  if (typeof settings.openaiBaseUrl === "string") {
    config.setOpenAIBaseURL(settings.openaiBaseUrl);
  }
  if (settings.openaiKey) {
    config.setOpenAIKey(settings.openaiKey);
    // Reinitialize LLM service with new API key
    await initializeLLMService();
  }
  if (typeof settings.customPrompt === "string") {
    config.setCustomPrompt(settings.customPrompt);
  }
  if (typeof settings.responseLanguage === "string") {
    config.setResponseLanguage(settings.responseLanguage);
    sendResponseLanguageUpdated();
  }
  if (settings.model) {
    config.setModel(settings.model);
  }
  if (typeof settings.mousePassthrough === "boolean") {
    config.setMousePassthrough(settings.mousePassthrough);
    setMousePassthrough(settings.mousePassthrough);
  }
  if (typeof settings.appBackgroundColor === "string") {
    config.setAppBackgroundColor(settings.appBackgroundColor);
  }
  if (
    typeof settings.appBackgroundOpacity === "number" ||
    typeof settings.appBackgroundOpacity === "string"
  ) {
    config.setAppBackgroundOpacity(settings.appBackgroundOpacity);
  }
  if (
    typeof settings.appBackgroundColor === "string" ||
    typeof settings.appBackgroundOpacity === "number" ||
    typeof settings.appBackgroundOpacity === "string"
  ) {
    sendAppBackgroundColorUpdated();
  }
  if (settings.overlayWindow && typeof settings.overlayWindow === "object") {
    applyOverlayWindowSettings(settings.overlayWindow);
  }
  return true;
});

ipcMain.handle("set-overlay-window", (event, overlayWindow) => {
  return applyOverlayWindowSettings(overlayWindow);
});

// IPC handler for settings window visibility
ipcMain.handle("show-settings", () => {
  createSettingsWindow();
});

// IPC handler for chat reset
ipcMain.handle("reset-chat", (event) => {
  if (invisibleWindow) {
    invisibleWindow.webContents.send("reset-chat");
  }
  // Also clear backend conversation memory
  resetConversationHistory();
  return true;
});

// IPC handler for context menu
ipcMain.handle("build-context-menu", (event) => {
  const menu = Menu.buildFromTemplate([
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { type: "separator" },
    { role: "selectAll" },
  ]);
  return menu;
});

ipcMain.handle("write-clipboard-text", (event, text) => {
  clipboard.writeText(typeof text === "string" ? text : String(text || ""));
  return true;
});

// IPC handlers for screenshots
ipcMain.handle("get-screenshots-directory", () => {
  const { ensureScreenshotsDirectory } = require("./screenshot");
  return ensureScreenshotsDirectory();
});

ipcMain.handle("get-recent-screenshots", () => {
  return getRecentScreenshots();
});

ipcMain.handle("ensure-screen-recording-permission", () => {
  return ensureScreenRecordingPermission();
});

ipcMain.handle("get-system-audio-capture-support", () => {
  return getSystemAudioCaptureSupport();
});

// IPC handlers for window controls
ipcMain.handle("minimize-window", () => {
  if (invisibleWindow) {
    invisibleWindow.minimize();
  }
});

ipcMain.handle("hide-window", () => {
  if (invisibleWindow) {
    invisibleWindow.hide();
  }
});

let invisibleWindow;
let settingsWindow = null;
let tray = null;
let mousePassthrough = config.getMousePassthrough();
let settingsOverlayEditMode = false;
let overlayVisibleBeforeSettings = true;
let overlayBoundsPersistTimer = null;
const OVERLAY_MIN_SIZE = {
  width: 360,
  height: 240,
};

function getSafeOverlayBounds(overlayWindow = config.getOverlayWindow()) {
  const display =
    Number.isFinite(overlayWindow.x) && Number.isFinite(overlayWindow.y)
      ? screen.getDisplayMatching({
          x: overlayWindow.x,
          y: overlayWindow.y,
          width: overlayWindow.width,
          height: overlayWindow.height,
        })
      : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(
    Math.max(overlayWindow.width, OVERLAY_MIN_SIZE.width),
    workArea.width
  );
  const height = Math.min(
    Math.max(overlayWindow.height, OVERLAY_MIN_SIZE.height),
    workArea.height
  );
  const x = Number.isFinite(overlayWindow.x)
    ? Math.min(Math.max(overlayWindow.x, workArea.x), workArea.x + workArea.width - width)
    : workArea.x + Math.round((workArea.width - width) / 2);
  const y = Number.isFinite(overlayWindow.y)
    ? Math.min(Math.max(overlayWindow.y, workArea.y), workArea.y + workArea.height - height)
    : workArea.y + Math.round((workArea.height - height) / 2);

  return { x, y, width, height };
}

function sendOverlayWindowUpdated(overlayWindow = config.getOverlayWindow()) {
  if (settingsWindow && !settingsWindow.webContents.isDestroyed()) {
    settingsWindow.webContents.send("overlay-window-updated", overlayWindow);
  }
}

function sendOverlayEditModeChanged() {
  if (!invisibleWindow || invisibleWindow.webContents.isDestroyed()) return;

  invisibleWindow.webContents.send("overlay-edit-mode-changed", {
    enabled: settingsOverlayEditMode,
    freeDragInSettings: config.getOverlayWindow().freeDragInSettings !== false,
  });
}

function getAppBackgroundSettings() {
  return {
    color: config.getAppBackgroundColor(),
    opacity: config.getAppBackgroundOpacity(),
  };
}

function sendAppBackgroundColorUpdated(
  background = getAppBackgroundSettings()
) {
  if (!invisibleWindow || invisibleWindow.webContents.isDestroyed()) return;

  invisibleWindow.webContents.send("app-background-color-updated", background);
}

function sendResponseLanguageUpdated(
  language = config.getResponseLanguage(),
  options = {}
) {
  const payload = {
    language,
    languages: config.RESPONSE_LANGUAGES,
    toggled: Boolean(options.toggled),
  };

  [invisibleWindow, settingsWindow].forEach((window) => {
    if (window && !window.webContents.isDestroyed()) {
      window.webContents.send("response-language-updated", payload);
    }
  });
}

function persistOverlayBounds() {
  if (!invisibleWindow || invisibleWindow.isDestroyed()) return;

  const bounds = invisibleWindow.getBounds();
  const overlayWindow = config.setOverlayWindow({
    ...config.getOverlayWindow(),
    ...bounds,
  });
  sendOverlayWindowUpdated(overlayWindow);
}

function scheduleOverlayBoundsPersist() {
  clearTimeout(overlayBoundsPersistTimer);
  overlayBoundsPersistTimer = setTimeout(persistOverlayBounds, 120);
}

function getEffectiveMousePassthrough() {
  return settingsOverlayEditMode ? false : mousePassthrough;
}

function applyMousePassthrough(options = {}) {
  if (!invisibleWindow) return mousePassthrough;

  const effectiveMousePassthrough = getEffectiveMousePassthrough();
  invisibleWindow.setIgnoreMouseEvents(effectiveMousePassthrough);
  invisibleWindow.webContents.isIgnoringMouseEvents = effectiveMousePassthrough;

  if (options.notify !== false && !invisibleWindow.webContents.isDestroyed()) {
    invisibleWindow.webContents.send(
      "toggle-mouse-ignore",
      effectiveMousePassthrough
    );
  }

  return mousePassthrough;
}

function setOverlayEditMode(enabled) {
  settingsOverlayEditMode = Boolean(enabled);

  if (!invisibleWindow || invisibleWindow.isDestroyed()) return;

  invisibleWindow.setResizable(true);
  invisibleWindow.setMovable(true);

  if (settingsOverlayEditMode && !invisibleWindow.isVisible()) {
    invisibleWindow.showInactive();
  }

  applyMousePassthrough();
  sendOverlayEditModeChanged();
}

function beginOverlayCustomizationMode() {
  if (!invisibleWindow || invisibleWindow.isDestroyed()) return;

  if (!settingsOverlayEditMode) {
    overlayVisibleBeforeSettings = invisibleWindow.isVisible();
  }

  if (!invisibleWindow.isVisible()) {
    invisibleWindow.showInactive();
  }

  setOverlayEditMode(true);
  sendOverlayWindowUpdated();
}

function endOverlayCustomizationMode() {
  const shouldHideOverlay = !overlayVisibleBeforeSettings;

  setOverlayEditMode(false);

  if (
    shouldHideOverlay &&
    invisibleWindow &&
    !invisibleWindow.isDestroyed() &&
    !app.isQuitting
  ) {
    invisibleWindow.hide();
  }
}

function applyOverlayWindowSettings(overlayWindow = {}) {
  const nextOverlayWindow = config.setOverlayWindow(overlayWindow);

  if (!invisibleWindow || invisibleWindow.isDestroyed()) {
    sendOverlayWindowUpdated(nextOverlayWindow);
    return nextOverlayWindow;
  }

  const bounds = getSafeOverlayBounds(nextOverlayWindow);
  invisibleWindow.setMinimumSize(OVERLAY_MIN_SIZE.width, OVERLAY_MIN_SIZE.height);
  invisibleWindow.setResizable(true);
  invisibleWindow.setMovable(true);
  invisibleWindow.setBounds(bounds);

  const persistedOverlayWindow = config.setOverlayWindow({
    ...nextOverlayWindow,
    ...bounds,
  });
  sendOverlayEditModeChanged();
  sendOverlayWindowUpdated(persistedOverlayWindow);
  return persistedOverlayWindow;
}

function setMousePassthrough(enabled, options = {}) {
  mousePassthrough = Boolean(enabled);

  return applyMousePassthrough(options);
}

function configureMediaPermissions() {
  if (!invisibleWindow || invisibleWindow.webContents.isDestroyed()) return;

  const overlayWebContentsId = invisibleWindow.webContents.id;
  const appSession = invisibleWindow.webContents.session;

  const isOverlayAudioRequest = (webContents, permission, details = {}) => {
    if (!webContents || webContents.id !== overlayWebContentsId) return false;
    if (permission !== "media") return false;

    const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    return mediaTypes.length === 0 || mediaTypes.includes("audio");
  };

  appSession.setPermissionCheckHandler((webContents, permission, origin, details) =>
    isOverlayAudioRequest(webContents, permission, details)
  );

  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isOverlayAudioRequest(webContents, permission, details));
  });
}

// Create shared menu template
function createMenuTemplate() {
  return [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Preferences...",
                accelerator: "Command+,",
                click: () => createSettingsWindow(),
              },
              {
                label: "Toggle Response Language",
                accelerator: "CommandOrControl+Shift+L",
                click: () => {
                  config.toggleResponseLanguage();
                  sendResponseLanguageUpdated(config.getResponseLanguage(), {
                    toggled: true,
                  });
                },
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Developer Tools",
          accelerator:
            process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
          click: (_, window) => {
            if (window) {
              window.webContents.toggleDevTools();
            }
          },
        },
      ],
    },
  ];
}

function createInvisibleWindow() {
  const overlayBounds = getSafeOverlayBounds(config.getOverlayWindow());

  invisibleWindow = new BrowserWindow({
    ...overlayBounds,
    minWidth: OVERLAY_MIN_SIZE.width,
    minHeight: OVERLAY_MIN_SIZE.height,
    resizable: true,
    movable: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  configureMediaPermissions();

  // Set window type to utility on macOS
  if (process.platform === "darwin") {
    invisibleWindow.setAlwaysOnTop(true, "utility", 1);
    // Hide window buttons but keep functionality
    invisibleWindow.setWindowButtonVisibility(false);
  }

  // Set content protection to prevent screen capture
  invisibleWindow.setContentProtection(true);

  // Mouse passthrough keeps the overlay click-through by default.
  setMousePassthrough(mousePassthrough, { notify: false });

  invisibleWindow.loadFile("index.html");
  invisibleWindow.webContents.once("did-finish-load", () => {
    setMousePassthrough(mousePassthrough);
    sendOverlayEditModeChanged();
  });

  // Open DevTools in development
  if (process.argv.includes("--debug")) {
    invisibleWindow.webContents.openDevTools();
  }

  // Handle window visibility
  invisibleWindow.on("show", () => {
    invisibleWindow.showInactive();
  });

  // Prevent the window from being closed with mouse
  invisibleWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      invisibleWindow.hide();
    }
    return false;
  });

  // Set the menu for the invisible window
  const menu = Menu.buildFromTemplate(createMenuTemplate());
  Menu.setApplicationMenu(menu);

  invisibleWindow.on("move", scheduleOverlayBoundsPersist);
  invisibleWindow.on("resize", scheduleOverlayBoundsPersist);

  // Show window initially
  invisibleWindow.showInactive();

  // Set up global wheel event capture using uiohook
  setupGlobalWheelCapture();
}

// Set up global wheel event capture using uiohook-napi
function setupGlobalWheelCapture() {
  try {
    uIOhook.on("wheel", (event) => {
      if (!invisibleWindow || !invisibleWindow.isVisible()) return;
      if (settingsOverlayEditMode) return;
      if (!mousePassthrough) return;

      const bounds = invisibleWindow.getBounds();
      const mouseX = event.x;
      const mouseY = event.y;

      // Check if mouse is within the overlay window bounds
      if (
        mouseX >= bounds.x &&
        mouseX <= bounds.x + bounds.width &&
        mouseY >= bounds.y &&
        mouseY <= bounds.y + bounds.height
      ) {
        // event.rotation: positive = scroll down, negative = scroll up
        const scrollAmount = event.rotation * 50;
        invisibleWindow.webContents.send("scroll-chat", scrollAmount);
      }
    });

    uIOhook.start();
  } catch (error) {
    console.warn(
      "Global wheel capture disabled. Grant Accessibility permission and restart the app to enable overlay wheel scrolling.",
      error
    );
  }
}

function createSettingsWindow() {
  beginOverlayCustomizationMode();

  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    resizable: true,
    minimizable: true,
    maximizable: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  settingsWindow.loadFile("settings.html");

  // Open DevTools in development
  if (process.argv.includes("--debug")) {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.once("ready-to-show", () => {
    beginOverlayCustomizationMode();
    settingsWindow.show();
  });

  // Handle window close
  settingsWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      settingsWindow.hide();
      endOverlayCustomizationMode();
    }
    return false;
  });

  settingsWindow.on("hide", () => {
    if (!app.isQuitting) {
      endOverlayCustomizationMode();
    }
  });
}

// Register global shortcuts
function registerShortcuts() {
  const registerShortcut = (accelerator, handler) => {
    const registered = globalShortcut.register(accelerator, handler);
    if (!registered) {
      console.warn(`Global shortcut failed to register: ${accelerator}`);
    }
    return registered;
  };

  const captureScreenshot = async () => {
    try {
      // Hide window before taking screenshot
      if (invisibleWindow && invisibleWindow.isVisible()) {
        invisibleWindow.hide();
      }

      // Wait for window to hide
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Take screenshot (permission already checked at startup)
      const screenshotPath = await captureFullScreen(desktopCapturer, screen);
      if (screenshotPath) {
        console.log("Screenshot saved:", screenshotPath);
        // Notify renderer about successful capture
        if (invisibleWindow) {
          invisibleWindow.webContents.send("screenshot-captured", {
            filePath: screenshotPath,
            timestamp: Date.now(),
          });
        }
      }

      // Show window again after a brief delay
      setTimeout(() => {
        if (invisibleWindow) {
          invisibleWindow.showInactive();
        }
      }, 200);
    } catch (error) {
      console.error("Screenshot failed:", error);
      if (invisibleWindow) {
        invisibleWindow.showInactive();
      }
    }
  };

  const toggleVisibility = () => {
    if (invisibleWindow.isVisible()) {
      invisibleWindow.hide();
    } else {
      invisibleWindow.showInactive();
    }
  };

  // Screenshot shortcut. Shift+S matches the documented shortcut.
  registerShortcut("CommandOrControl+Shift+S", captureScreenshot);
  registerShortcut("CommandOrControl+H", captureScreenshot);

  // Toggle visibility shortcut. Shift+H matches the documented shortcut.
  registerShortcut("CommandOrControl+Shift+H", toggleVisibility);
  registerShortcut("CommandOrControl+B", toggleVisibility);

  // Test response shortcut (Command/Ctrl + Shift + T)
  registerShortcut("CommandOrControl+Shift+T", async () => {
    if (invisibleWindow) {
      try {
        await invisibleWindow.webContents.executeJavaScript(`
          window.electronAPI.testResponse("write python code to print 'Hello, world!'");
        `);
      } catch (error) {
        console.error("Failed to test response:", error);
      }
    }
  });

  // Window movement shortcuts
  const NUDGE_AMOUNT = 50;
  const screenBounds = screen.getPrimaryDisplay().workAreaSize;

  // Nudge window with arrow keys
  registerShortcut("CommandOrControl+Left", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x - NUDGE_AMOUNT, y);
    }
  });

  registerShortcut("CommandOrControl+Right", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x + NUDGE_AMOUNT, y);
    }
  });

  registerShortcut("CommandOrControl+Up", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x, y - NUDGE_AMOUNT);
    }
  });

  registerShortcut("CommandOrControl+Down", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x, y + NUDGE_AMOUNT);
    }
  });

  // Snap window to screen edges
  registerShortcut("CommandOrControl+Shift+Left", () => {
    if (invisibleWindow) {
      invisibleWindow.setPosition(0, 0);
    }
  });

  registerShortcut("CommandOrControl+Shift+Right", () => {
    if (invisibleWindow) {
      const windowBounds = invisibleWindow.getBounds();
      invisibleWindow.setPosition(screenBounds.width - windowBounds.width, 0);
    }
  });

  registerShortcut("CommandOrControl+Shift+Up", () => {
    if (invisibleWindow) {
      invisibleWindow.setPosition(0, 0);
    }
  });

  registerShortcut("CommandOrControl+Shift+Down", () => {
    if (invisibleWindow) {
      const windowBounds = invisibleWindow.getBounds();
      invisibleWindow.setPosition(0, screenBounds.height - windowBounds.height);
    }
  });

  // Reset chat shortcut (Command/Ctrl + Shift + R)
  registerShortcut("CommandOrControl+Shift+R", () => {
    if (invisibleWindow) {
      invisibleWindow.webContents.send("reset-chat");
      resetConversationHistory();
    }
  });

  // Copy the latest assistant response, including in-progress streamed text.
  registerShortcut("CommandOrControl+Shift+Y", () => {
    if (invisibleWindow) {
      invisibleWindow.webContents.send("copy-last-response");
    }
  });

  // Copy selection and send to AI (Command/Ctrl + Shift + C)
  registerShortcut("CommandOrControl+Shift+C", async () => {
    if (!invisibleWindow) return;

    try {
      // Save current clipboard content to restore later
      const previousClipboard = clipboard.readText();

      // Simulate Cmd+C in the foreground app to copy the current selection
      if (process.platform === "darwin") {
        execSync(
          'osascript -e \'tell application "System Events" to keystroke "c" using command down\''
        );
      }

      // Wait for clipboard to update
      await new Promise((resolve) => setTimeout(resolve, 150));

      const selectedText = clipboard.readText().trim();

      if (selectedText && selectedText !== previousClipboard) {
        console.log("Captured selection:", selectedText.substring(0, 100) + "...");
        // Show overlay if hidden
        if (!invisibleWindow.isVisible()) {
          invisibleWindow.showInactive();
        }
        // Send selection as a prompt to renderer
        invisibleWindow.webContents.send("selection-captured", selectedText);
      } else if (selectedText) {
        // If clipboard didn't change, the selection might already be in clipboard
        if (!invisibleWindow.isVisible()) {
          invisibleWindow.showInactive();
        }
        invisibleWindow.webContents.send("selection-captured", selectedText);
      }
    } catch (error) {
      console.error("Failed to capture selection:", error);
    }
  });

  // Toggle speech-to-text (Command/Ctrl + Shift + V)
  registerShortcut("CommandOrControl+Shift+V", () => {
    if (invisibleWindow) {
      // Show overlay if hidden
      if (!invisibleWindow.isVisible()) {
        invisibleWindow.showInactive();
      }
      invisibleWindow.webContents.send("toggle-speech");
    }
  });

  // Toggle mouse passthrough. Off lets Chromium handle native wheel scrolling.
  registerShortcut("CommandOrControl+Shift+M", () => {
    const enabled = !mousePassthrough;
    config.setMousePassthrough(enabled);
    setMousePassthrough(enabled);
  });

  // Toggle response language, similar to an input-method switch.
  registerShortcut("CommandOrControl+Shift+L", () => {
    const language = config.toggleResponseLanguage();
    sendResponseLanguageUpdated(language, { toggled: true });
  });

  // Chat scrolling shortcuts
  registerShortcut("Alt+Up", () => {
    if (invisibleWindow) {
      invisibleWindow.webContents.send("scroll-chat", "up");
    }
  });

  registerShortcut("Alt+Down", () => {
    if (invisibleWindow) {
      invisibleWindow.webContents.send("scroll-chat", "down");
    }
  });
}

// When app is ready
app.whenReady().then(async () => {
  // Load API key from config before initializing services
  const apiKey = config.getOpenAIKey();
  if (apiKey) {
    process.env.OPENAI_API_KEY = apiKey;
  }
  process.env.OPENAI_BASE_URL = config.getOpenAIBaseURL();

  // Ensure all permissions before proceeding (macOS)
  if (process.platform === "darwin") {
    const hasScreenPermission = await ensureScreenRecordingPermission();
    if (!hasScreenPermission) {
      console.log("Screen recording permission not granted at startup.");
    }

    // Check accessibility permission (needed for global shortcuts)
    const { systemPreferences } = require("electron");
    const isTrusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!isTrusted) {
      console.log("Accessibility permission requested. App may need restart after granting.");
    }
  }

  // Prompt user to configure API key if not set
  if (!config.hasOpenAIKey()) {
    console.log("No OpenAI API key configured. Opening settings...");
  }

  createInvisibleWindow();
  registerShortcuts();
  await initializeLLMService();

  // Open settings if no API key is configured
  if (!config.hasOpenAIKey()) {
    createSettingsWindow();
  }

  // Create tray icon for Windows
  if (process.platform === "win32") {
    tray = new Tray(path.join(__dirname, "../assets/OCTO.png"));
    const contextMenu = Menu.buildFromTemplate([
      { label: "Show", click: () => invisibleWindow.show() },
      { label: "Hide", click: () => invisibleWindow.hide() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray.setToolTip("Open Interview Coder");
    tray.setContextMenu(contextMenu);
  }

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createInvisibleWindow();
    }
  });
});

// Quit when all windows are closed.
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Clean up on app quit
app.on("before-quit", () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  uIOhook.stop();
});
