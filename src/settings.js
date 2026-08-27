// Settings management
document.addEventListener("DOMContentLoaded", async () => {
  // Get all form elements
  const openaiKeyInput = document.getElementById("openaiKey");
  const openaiBaseUrlInput = document.getElementById("openaiBaseUrl");
  const customPromptInput = document.getElementById("customPrompt");
  const responseLanguageSelect = document.getElementById(
    "responseLanguageSelect"
  );
  const promptVariablesEl = document.getElementById("promptVariables");
  const modelSelect = document.getElementById("modelSelect");
  const customModelInput = document.getElementById("customModel");
  const overlayWidthInput = document.getElementById("overlayWidth");
  const overlayHeightInput = document.getElementById("overlayHeight");
  const freeDragInSettingsInput = document.getElementById("freeDragInSettings");
  const appBackgroundColorInput = document.getElementById("appBackgroundColor");
  const appBackgroundOpacityInput = document.getElementById(
    "appBackgroundOpacity"
  );
  const appBackgroundOpacityValue = document.getElementById(
    "appBackgroundOpacityValue"
  );
  const mousePassthroughInput = document.getElementById("mousePassthrough");
  const applyWindowButton = document.getElementById("applyWindowButton");
  const saveButton = document.getElementById("saveButton");
  const resetPromptButton = document.getElementById("resetPromptButton");
  const resetUsageButton = document.getElementById("resetUsageButton");

  const usageElements = {
    textRequests: document.getElementById("usageTextRequests"),
    textInputTokens: document.getElementById("usageTextInputTokens"),
    textOutputTokens: document.getElementById("usageTextOutputTokens"),
    textTotalTokens: document.getElementById("usageTextTotalTokens"),
    textCachedTokens: document.getElementById("usageTextCachedTokens"),
    textReasoningTokens: document.getElementById("usageTextReasoningTokens"),
    transcriptionSessions: document.getElementById(
      "usageTranscriptionSessions"
    ),
    transcriptionFinals: document.getElementById("usageTranscriptionFinals"),
    transcriptionAudio: document.getElementById("usageTranscriptionAudio"),
    transcriptionInputTokens: document.getElementById(
      "usageTranscriptionInputTokens"
    ),
    transcriptionOutputTokens: document.getElementById(
      "usageTranscriptionOutputTokens"
    ),
    transcriptionAudioTokens: document.getElementById(
      "usageTranscriptionAudioTokens"
    ),
    transcriptionTotalTokens: document.getElementById(
      "usageTranscriptionTotalTokens"
    ),
    updatedAt: document.getElementById("usageUpdatedAt"),
  };

  // Verify all elements exist
  if (
    !openaiKeyInput ||
    !openaiBaseUrlInput ||
    !saveButton ||
    !customPromptInput ||
    !responseLanguageSelect ||
    !promptVariablesEl ||
    !modelSelect ||
    !customModelInput ||
    !overlayWidthInput ||
    !overlayHeightInput ||
    !freeDragInSettingsInput ||
    !appBackgroundColorInput ||
    !appBackgroundOpacityInput ||
    !appBackgroundOpacityValue ||
    !applyWindowButton ||
    !mousePassthroughInput
  ) {
    console.error("Required DOM elements not found");
    return;
  }

  const formatNumber = (value) => {
    const number = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat().format(Math.round(number));
  };

  const formatDuration = (seconds) => {
    const totalSeconds = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  const setUsageText = (element, value) => {
    if (element) element.textContent = value;
  };

  const normalizeOpacityPercent = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 72;

    return Math.min(Math.max(Math.round(number), 0), 100);
  };

  const renderAppBackgroundOpacity = (opacity = 0.72) => {
    const percent = normalizeOpacityPercent(Number(opacity) * 100);
    appBackgroundOpacityInput.value = String(percent);
    appBackgroundOpacityValue.textContent = `${percent}%`;
  };

  const renderOverlayWindow = (overlayWindow = {}) => {
    overlayWidthInput.value = overlayWindow.width || 800;
    overlayHeightInput.value = overlayWindow.height || 600;
    freeDragInSettingsInput.checked = overlayWindow.freeDragInSettings !== false;
  };

  const renderResponseLanguages = (
    languages = [],
    selectedLanguage = "en"
  ) => {
    responseLanguageSelect.innerHTML = "";

    languages.forEach((language) => {
      const option = document.createElement("option");
      option.value = language.id;
      option.textContent = language.name;
      if (language.id === selectedLanguage) {
        option.selected = true;
      }
      responseLanguageSelect.appendChild(option);
    });
  };

  const renderPromptVariables = (variables = []) => {
    promptVariablesEl.innerHTML = "";
    if (!Array.isArray(variables) || variables.length === 0) return;

    const title = document.createElement("div");
    title.className = "prompt-variable-title";
    title.textContent = "Available variables";
    promptVariablesEl.appendChild(title);

    variables.forEach((variable) => {
      const row = document.createElement("div");
      row.className = "prompt-variable-row";

      const token = document.createElement("code");
      token.textContent = variable.token || "";

      const description = document.createElement("span");
      description.textContent = variable.description || "";

      row.appendChild(token);
      row.appendChild(description);
      promptVariablesEl.appendChild(row);
    });
  };

  const readOverlayWindow = () => ({
    width: Number.parseInt(overlayWidthInput.value, 10),
    height: Number.parseInt(overlayHeightInput.value, 10),
    freeDragInSettings: freeDragInSettingsInput.checked,
  });

  const applyOverlayWindow = async () => {
    const overlayWindow = await window.electronAPI.setOverlayWindow(
      readOverlayWindow()
    );
    renderOverlayWindow(overlayWindow);
    return overlayWindow;
  };

  const renderUsage = (usage = {}) => {
    const text = usage.text || {};
    const transcription = usage.transcription || {};

    setUsageText(usageElements.textRequests, formatNumber(text.requests));
    setUsageText(usageElements.textInputTokens, formatNumber(text.inputTokens));
    setUsageText(
      usageElements.textOutputTokens,
      formatNumber(text.outputTokens)
    );
    setUsageText(usageElements.textTotalTokens, formatNumber(text.totalTokens));
    setUsageText(
      usageElements.textCachedTokens,
      formatNumber(text.cachedTokens)
    );
    setUsageText(
      usageElements.textReasoningTokens,
      formatNumber(text.reasoningTokens)
    );

    setUsageText(
      usageElements.transcriptionSessions,
      formatNumber(transcription.sessions)
    );
    setUsageText(
      usageElements.transcriptionFinals,
      formatNumber(transcription.finalTranscripts)
    );
    setUsageText(
      usageElements.transcriptionAudio,
      formatDuration(transcription.audioSeconds)
    );
    setUsageText(
      usageElements.transcriptionInputTokens,
      formatNumber(transcription.inputTokens)
    );
    setUsageText(
      usageElements.transcriptionOutputTokens,
      formatNumber(transcription.outputTokens)
    );
    setUsageText(
      usageElements.transcriptionAudioTokens,
      formatNumber(transcription.audioTokens)
    );
    setUsageText(
      usageElements.transcriptionTotalTokens,
      formatNumber(transcription.totalTokens)
    );

    if (usageElements.updatedAt) {
      usageElements.updatedAt.textContent = usage.updatedAt
        ? `Last updated: ${new Date(usage.updatedAt).toLocaleString()}`
        : "No usage recorded yet.";
    }
  };

  // Load current settings
  try {
    const settings = await window.electronAPI.getSettings();

    // Apply settings to form elements
    if (settings && settings.openaiKey) {
      openaiKeyInput.value = settings.openaiKey;
    }
    if (settings && settings.openaiBaseUrl) {
      openaiBaseUrlInput.value = settings.openaiBaseUrl;
    }
    if (settings && settings.customPrompt) {
      customPromptInput.value = settings.customPrompt;
    }
    if (settings && settings.responseLanguages) {
      renderResponseLanguages(
        settings.responseLanguages,
        settings.responseLanguage || "en"
      );
    }
    if (settings && settings.promptVariables) {
      renderPromptVariables(settings.promptVariables);
    }
    if (settings) {
      mousePassthroughInput.checked = settings.mousePassthrough !== false;
      appBackgroundColorInput.value = settings.appBackgroundColor || "#000000";
      renderAppBackgroundOpacity(settings.appBackgroundOpacity);
      renderOverlayWindow(settings.overlayWindow);
    }

    // Populate model dropdown
    if (settings && settings.availableModels) {
      modelSelect.innerHTML = "";
      const currentModel = settings.model || "";
      let selectedBuiltInModel = false;

      settings.availableModels.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = `${model.name} | ${model.description}`;
        if (model.id === currentModel) {
          option.selected = true;
          selectedBuiltInModel = true;
        }
        modelSelect.appendChild(option);
      });

      customModelInput.value = selectedBuiltInModel ? "" : currentModel;
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }

  try {
    const usage = await window.electronAPI.getUsage();
    renderUsage(usage);
  } catch (error) {
    console.error("Error loading usage:", error);
  }

  window.electronAPI.onUsageUpdated((usage) => {
    renderUsage(usage);
  });

  window.electronAPI.onOverlayWindowUpdated((overlayWindow) => {
    renderOverlayWindow(overlayWindow);
  });

  window.electronAPI.onResponseLanguageUpdated((data) => {
    if (data && data.languages) {
      renderResponseLanguages(data.languages, data.language || "en");
      return;
    }
    if (data && data.language) {
      responseLanguageSelect.value = data.language;
    }
  });

  // Handle reset prompt button
  if (resetPromptButton) {
    resetPromptButton.addEventListener("click", async () => {
      try {
        const defaults = await window.electronAPI.getDefaultPrompt();
        customPromptInput.value = defaults;
      } catch (error) {
        console.error("Error resetting prompt:", error);
      }
    });
  }

  if (resetUsageButton) {
    resetUsageButton.addEventListener("click", async () => {
      try {
        const usage = await window.electronAPI.resetUsage();
        renderUsage(usage);
      } catch (error) {
        console.error("Error resetting usage:", error);
      }
    });
  }

  applyWindowButton.addEventListener("click", async () => {
    try {
      await applyOverlayWindow();
      applyWindowButton.textContent = "Applied!";
      setTimeout(() => {
        applyWindowButton.textContent = "Apply Size";
      }, 1500);
    } catch (error) {
      console.error("Error applying window settings:", error);
      alert("Failed to apply window settings. Please try again.");
    }
  });

  freeDragInSettingsInput.addEventListener("change", async () => {
    try {
      await applyOverlayWindow();
    } catch (error) {
      console.error("Error applying drag setting:", error);
    }
  });

  modelSelect.addEventListener("change", () => {
    customModelInput.value = "";
  });

  appBackgroundOpacityInput.addEventListener("input", () => {
    renderAppBackgroundOpacity(
      normalizeOpacityPercent(appBackgroundOpacityInput.value) / 100
    );
  });

  // Handle save button click
  saveButton.addEventListener("click", async () => {
    const customModel = customModelInput.value.trim();
    const settings = {
      openaiKey: openaiKeyInput.value.trim(),
      openaiBaseUrl: openaiBaseUrlInput.value.trim(),
      customPrompt: customPromptInput.value,
      responseLanguage: responseLanguageSelect.value,
      model: customModel || modelSelect.value,
      mousePassthrough: mousePassthroughInput.checked,
      appBackgroundColor: appBackgroundColorInput.value,
      appBackgroundOpacity:
        normalizeOpacityPercent(appBackgroundOpacityInput.value) / 100,
      overlayWindow: readOverlayWindow(),
    };

    try {
      await window.electronAPI.saveSettings(settings);
      // Show success message
      saveButton.textContent = "Saved!";
      setTimeout(() => {
        saveButton.textContent = "Save";
      }, 2000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Failed to save settings. Please try again.");
    }
  });
});
