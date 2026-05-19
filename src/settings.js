// Settings management
document.addEventListener("DOMContentLoaded", async () => {
  // Get all form elements
  const openaiKeyInput = document.getElementById("openaiKey");
  const customPromptInput = document.getElementById("customPrompt");
  const modelSelect = document.getElementById("modelSelect");
  const mousePassthroughInput = document.getElementById("mousePassthrough");
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
    !saveButton ||
    !customPromptInput ||
    !modelSelect ||
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
    if (settings && settings.customPrompt) {
      customPromptInput.value = settings.customPrompt;
    }
    if (settings) {
      mousePassthroughInput.checked = settings.mousePassthrough !== false;
    }

    // Populate model dropdown
    if (settings && settings.availableModels) {
      modelSelect.innerHTML = "";
      settings.availableModels.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = `${model.name} | ${model.description}`;
        if (model.id === settings.model) {
          option.selected = true;
        }
        modelSelect.appendChild(option);
      });
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

  // Handle save button click
  saveButton.addEventListener("click", async () => {
    const settings = {
      openaiKey: openaiKeyInput.value.trim(),
      customPrompt: customPromptInput.value,
      model: modelSelect.value,
      mousePassthrough: mousePassthroughInput.checked,
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
