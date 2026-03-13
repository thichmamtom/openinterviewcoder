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
const { uIOhook, UiohookWheelEvent } = require("uiohook-napi");
const {
  ensureScreenRecordingPermission,
  captureFullScreen,
  getRecentScreenshots,
} = require("./screenshot");
const { initializeLLMService, resetConversationHistory } = require("./llm-service");
const config = require("./config");

// IPC handlers for settings
ipcMain.handle("get-settings", () => {
  return {
    openaiKey: config.getOpenAIKey(),
    customPrompt: config.getCustomPrompt(),
    model: config.getModel(),
    availableModels: config.AVAILABLE_MODELS,
  };
});

ipcMain.handle("get-default-prompt", () => {
  return config.DEFAULT_PROMPT;
});

// IPC handler for scrolling chat
ipcMain.handle("scroll-chat", (event, direction) => {
  if (invisibleWindow) {
    invisibleWindow.webContents.send("scroll-chat", direction);
  }
  return true;
});

ipcMain.handle("save-settings", async (event, settings) => {
  if (settings.openaiKey) {
    config.setOpenAIKey(settings.openaiKey);
    // Reinitialize LLM service with new API key
    await initializeLLMService();
  }
  if (typeof settings.customPrompt === "string") {
    config.setCustomPrompt(settings.customPrompt);
  }
  if (settings.model) {
    config.setModel(settings.model);
  }
  return true;
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

// IPC handlers for screenshots
ipcMain.handle("get-screenshots-directory", () => {
  const { ensureScreenshotsDirectory } = require("./screenshot");
  return ensureScreenshotsDirectory();
});

ipcMain.handle("get-recent-screenshots", () => {
  return getRecentScreenshots();
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
  invisibleWindow = new BrowserWindow({
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

  // Set window type to utility on macOS
  if (process.platform === "darwin") {
    invisibleWindow.setAlwaysOnTop(true, "utility", 1);
    // Hide window buttons but keep functionality
    invisibleWindow.setWindowButtonVisibility(false);
  }

  // Set content protection to prevent screen capture
  invisibleWindow.setContentProtection(true);

  // Always ignore mouse events to prevent interaction with screen sharing
  invisibleWindow.setIgnoreMouseEvents(true);
  invisibleWindow.webContents.isIgnoringMouseEvents = true;

  invisibleWindow.loadFile("index.html");

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

  // Show window initially
  invisibleWindow.showInactive();

  // Set up global wheel event capture using uiohook
  setupGlobalWheelCapture();
}

// Set up global wheel event capture using uiohook-napi
function setupGlobalWheelCapture() {
  uIOhook.on("wheel", (event) => {
    if (!invisibleWindow || !invisibleWindow.isVisible()) return;

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
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
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
    settingsWindow.show();
  });

  // Handle window close
  settingsWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      settingsWindow.hide();
    }
    return false;
  });
}

// Register global shortcuts
function registerShortcuts() {
  // Screenshot shortcut (Command/Ctrl + H)
  globalShortcut.register("CommandOrControl+H", async () => {
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
  });

  // Toggle visibility shortcut (Command/Ctrl + B)
  globalShortcut.register("CommandOrControl+B", () => {
    if (invisibleWindow.isVisible()) {
      invisibleWindow.hide();
    } else {
      invisibleWindow.showInactive();
    }
  });

  // Test response shortcut (Command/Ctrl + Shift + T)
  globalShortcut.register("CommandOrControl+Shift+T", async () => {
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
  globalShortcut.register("CommandOrControl+Left", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x - NUDGE_AMOUNT, y);
    }
  });

  globalShortcut.register("CommandOrControl+Right", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x + NUDGE_AMOUNT, y);
    }
  });

  globalShortcut.register("CommandOrControl+Up", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x, y - NUDGE_AMOUNT);
    }
  });

  globalShortcut.register("CommandOrControl+Down", () => {
    if (invisibleWindow) {
      const [x, y] = invisibleWindow.getPosition();
      invisibleWindow.setPosition(x, y + NUDGE_AMOUNT);
    }
  });

  // Snap window to screen edges
  globalShortcut.register("CommandOrControl+Shift+Left", () => {
    if (invisibleWindow) {
      invisibleWindow.setPosition(0, 0);
    }
  });

  globalShortcut.register("CommandOrControl+Shift+Right", () => {
    if (invisibleWindow) {
      const windowBounds = invisibleWindow.getBounds();
      invisibleWindow.setPosition(screenBounds.width - windowBounds.width, 0);
    }
  });

  globalShortcut.register("CommandOrControl+Shift+Up", () => {
    if (invisibleWindow) {
      invisibleWindow.setPosition(0, 0);
    }
  });

  globalShortcut.register("CommandOrControl+Shift+Down", () => {
    if (invisibleWindow) {
      const windowBounds = invisibleWindow.getBounds();
      invisibleWindow.setPosition(0, screenBounds.height - windowBounds.height);
    }
  });

  // Reset chat shortcut (Command/Ctrl + Shift + R)
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    if (invisibleWindow) {
      invisibleWindow.webContents.send("reset-chat");
      resetConversationHistory();
    }
  });

  // Copy selection and send to AI (Command/Ctrl + Shift + C)
  globalShortcut.register("CommandOrControl+Shift+C", async () => {
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
  globalShortcut.register("CommandOrControl+Shift+V", () => {
    if (invisibleWindow) {
      // Show overlay if hidden
      if (!invisibleWindow.isVisible()) {
        invisibleWindow.showInactive();
      }
      invisibleWindow.webContents.send("toggle-speech");
    }
  });

  // Chat scrolling shortcuts
  globalShortcut.register("Alt+Up", () => {
    if (invisibleWindow) {
      invisibleWindow.webContents.send("scroll-chat", "up");
    }
  });

  globalShortcut.register("Alt+Down", () => {
    if (invisibleWindow) {
      invisibleWindow.webContents.send("scroll-chat", "down");
    }
  });

  // For macOS, also register Option key combinations
  if (process.platform === "darwin") {
    globalShortcut.register("Option+Up", () => {
      if (invisibleWindow) {
        invisibleWindow.webContents.send("scroll-chat", "up");
      }
    });

    globalShortcut.register("Option+Down", () => {
      if (invisibleWindow) {
        invisibleWindow.webContents.send("scroll-chat", "down");
      }
    });
  }
}

// When app is ready
app.whenReady().then(async () => {
  // Load API key from config before initializing services
  const apiKey = config.getOpenAIKey();
  if (apiKey) {
    process.env.OPENAI_API_KEY = apiKey;
  }

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
