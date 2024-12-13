document.addEventListener("DOMContentLoaded", () => {
  const saveButton = document.getElementById("save");
  const dateOnly = document.getElementById("dateOnly");
  const dateTime = document.getElementById("dateTime");
  const successMessage = document.getElementById("successMessage");
  const extensionToggle = document.getElementById("extensionToggle");
  const optionsGroup = document.getElementById("options");

  // Initialize the UI based on stored preferences
  chrome.storage.sync.get(["displayOption", "extensionEnabled"], (data) => {
    // Set display option
    if (data.displayOption === "datetime") {
      dateTime.checked = true;
    } else {
      dateOnly.checked = true;
    }

    // Set extension toggle
    extensionToggle.checked = data.extensionEnabled !== false; // Default to true if not set
    optionsGroup.classList.toggle("disabled", !extensionToggle.checked);
  });

  // Handle extension toggle
  extensionToggle.addEventListener("change", () => {
    optionsGroup.classList.toggle("disabled", !extensionToggle.checked);
  });

  saveButton.addEventListener("click", () => {
    const displayOption = document.querySelector(
      'input[name="display"]:checked'
    ).value;
    const extensionEnabled = extensionToggle.checked;

    // Save all preferences
    chrome.storage.sync.set({ displayOption, extensionEnabled }, () => {
      // Show success message
      successMessage.classList.add("show");
      setTimeout(() => {
        successMessage.classList.remove("show");
      }, 2000);

      // Send message to content scripts to update immediately
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "updateDisplayOption",
          enabled: extensionEnabled,
          displayOption: displayOption,
        });
      });
    });
  });

  document.getElementById("creditsLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: e.target.href });
  });
});
