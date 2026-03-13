// Settings management
document.addEventListener("DOMContentLoaded", async () => {
  // Get all form elements
  const openaiKeyInput = document.getElementById("openaiKey");
  const customPromptInput = document.getElementById("customPrompt");
  const modelSelect = document.getElementById("modelSelect");
  const saveButton = document.getElementById("saveButton");
  const resetPromptButton = document.getElementById("resetPromptButton");

  // Verify all elements exist
  if (!openaiKeyInput || !saveButton || !customPromptInput || !modelSelect) {
    console.error("Required DOM elements not found");
    return;
  }

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

  // Handle save button click
  saveButton.addEventListener("click", async () => {
    const settings = {
      openaiKey: openaiKeyInput.value.trim(),
      customPrompt: customPromptInput.value,
      model: modelSelect.value,
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
