document.addEventListener("DOMContentLoaded", () => {
  const successMessage = document.getElementById("successMessage");
  const extensionToggle = document.getElementById("extensionToggle");
  const dateFormatSelect = document.getElementById("dateFormatSelect");
  const timeFormatToggle = document.getElementById("timeFormatToggle");
  const timeFormatSwitchLabel = timeFormatToggle.closest(".switch");

  // Initialize the UI based on stored preferences
  chrome.storage.sync.get(
    ["extensionEnabled", "dateFormat", "use24HourTime"],
    (data) => {
      // Set extension toggle
      extensionToggle.checked = data.extensionEnabled !== false;
      // Set date format dropdown
      dateFormatSelect.value = data.dateFormat || "browser";
      // Set 24-hour time toggle
      timeFormatToggle.checked = !!data.use24HourTime;
      updateTimeFormatToggleState();
    }
  );

  // Handle extension toggle changes
  function updateSettings(settings) {
    chrome.storage.sync.set(settings, () => {
      showSuccessMessage();
      notifyContentScript({
        enabled: extensionToggle.checked,
        dateFormat: dateFormatSelect.value,
        use24HourTime: timeFormatToggle.checked,
      });
    });
  }

  extensionToggle.addEventListener("change", () => {
    const extensionEnabled = extensionToggle.checked;
    updateSettings({ extensionEnabled });
  });

  dateFormatSelect.addEventListener("change", () => {
    updateTimeFormatToggleState();
    updateSettings({ dateFormat: dateFormatSelect.value });
  });

  timeFormatToggle.addEventListener("change", () => {
    if (timeFormatToggle.disabled) return;
    updateSettings({ use24HourTime: timeFormatToggle.checked });
  });

  function updateTimeFormatToggleState() {
    if (dateFormatSelect.value === "iso") {
      timeFormatToggle.disabled = true;
      timeFormatToggle.checked = true;
      timeFormatSwitchLabel.style.opacity = 0.5;
      timeFormatSwitchLabel.title = "ISO 8601 always uses 24-hour time";
    } else {
      timeFormatToggle.disabled = false;
      timeFormatSwitchLabel.style.opacity = 1;
      timeFormatSwitchLabel.title = "";
    }
  }

  // Helper function to show success message
  function showSuccessMessage() {
    successMessage.classList.add("show");
    setTimeout(() => {
      successMessage.classList.remove("show");
    }, 2000);
  }

  // Helper function to notify content script
  function notifyContentScript({ enabled, dateFormat, use24HourTime }) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: "updateDisplayOption",
            enabled,
            dateFormat,
            use24HourTime,
          })
          .catch(() => {});
      }
    });
  }

  document.getElementById("creditsLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: e.target.href });
  });

  document.querySelector(".coffee-button").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: e.target.href });
  });
});
