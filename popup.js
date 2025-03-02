document.addEventListener("DOMContentLoaded", () => {
  const dateOnly = document.getElementById("dateOnly");
  const dateTime = document.getElementById("dateTime");
  const successMessage = document.getElementById("successMessage");
  const extensionToggle = document.getElementById("extensionToggle");
  const optionsGroup = document.getElementById("options");
  const commentTimestamps = document.getElementById("commentTimestamps");
  const commentTimestampsContainer = document
    .getElementById("commentTimestamps")
    .closest(".toggle-switch");

  // Initialize the UI based on stored preferences
  chrome.storage.sync.get(
    ["displayOption", "extensionEnabled", "commentTimestamps"],
    (data) => {
      // Set display option
      if (data.displayOption === "datetime") {
        dateTime.checked = true;
      } else {
        dateOnly.checked = true;
      }

      // Set extension toggle
      extensionToggle.checked = data.extensionEnabled !== false; // Default to true if not set
      optionsGroup.classList.toggle("disabled", !extensionToggle.checked);
      commentTimestampsContainer.classList.toggle(
        "disabled",
        !extensionToggle.checked
      );

      // Set comment timestamps toggle
      commentTimestamps.checked = data.commentTimestamps === true;
    }
  );

  // Handle extension toggle changes
  function updateSettings(settings, additionalParams = {}) {
    chrome.storage.sync.set(settings, () => {
      showSuccessMessage();
      notifyContentScript(
        extensionToggle.checked,
        document.querySelector('input[name="display"]:checked').value,
        commentTimestamps.checked,
        ...Object.values(additionalParams)
      );
    });
  }

  extensionToggle.addEventListener("change", () => {
    const extensionEnabled = extensionToggle.checked;
    optionsGroup.classList.toggle("disabled", !extensionEnabled);
    commentTimestampsContainer.classList.toggle("disabled", !extensionEnabled);

    updateSettings({ extensionEnabled });
  });

  // Handle radio button changes
  document.querySelectorAll('input[name="display"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const displayOption = e.target.value;

      // Save the display option and notify content script
      updateSettings({ displayOption });
    });
  });

  // Add event listener for comment timestamps toggle
  document
    .getElementById("commentTimestamps")
    .addEventListener("change", (e) => {
      const showCommentTimestamps = e.target.checked;

      updateSettings({ commentTimestamps: showCommentTimestamps });
    });

  // Helper function to show success message
  function showSuccessMessage() {
    successMessage.classList.add("show");
    setTimeout(() => {
      successMessage.classList.remove("show");
    }, 2000);
  }

  // Helper function to notify content script
  function notifyContentScript(enabled, displayOption, commentTimestamps) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      // Make sure we have a tab
      if (tabs && tabs.length > 0) {
        // Send message and handle potential errors
        chrome.tabs
          .sendMessage(tabs[0].id, {
            action: "updateDisplayOption",
            enabled,
            displayOption,
            commentTimestamps,
          })
          .catch(() => {
            // Silently catch any connection errors
            // This happens when the extension popup is opened on non-LinkedIn pages
          });
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
