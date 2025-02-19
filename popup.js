document.addEventListener("DOMContentLoaded", () => {
  const dateOnly = document.getElementById("dateOnly");
  const dateTime = document.getElementById("dateTime");
  const successMessage = document.getElementById("successMessage");
  const extensionToggle = document.getElementById("extensionToggle");
  const optionsGroup = document.getElementById("options");
  const commentTimestamps = document.getElementById("commentTimestamps");

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

      // Set comment timestamps toggle
      commentTimestamps.checked = data.commentTimestamps === true;
    }
  );

  // Handle extension toggle changes
  extensionToggle.addEventListener("change", () => {
    const extensionEnabled = extensionToggle.checked;
    optionsGroup.classList.toggle("disabled", !extensionEnabled);

    // Save the toggle state and notify content script
    chrome.storage.sync.set({ extensionEnabled }, () => {
      showSuccessMessage();
      notifyContentScript(
        extensionEnabled,
        document.querySelector('input[name="display"]:checked').value,
        commentTimestamps.checked
      );
    });
  });

  // Handle radio button changes
  document.querySelectorAll('input[name="display"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const displayOption = e.target.value;

      // Save the display option and notify content script
      chrome.storage.sync.set({ displayOption }, () => {
        showSuccessMessage();
        notifyContentScript(
          extensionToggle.checked,
          displayOption,
          commentTimestamps.checked
        );
      });
    });
  });

  // Add event listener for comment timestamps toggle
  document
    .getElementById("commentTimestamps")
    .addEventListener("change", (e) => {
      const showCommentTimestamps = e.target.checked;

      chrome.storage.sync.set(
        { commentTimestamps: showCommentTimestamps },
        () => {
          showSuccessMessage();
          notifyContentScript(
            extensionToggle.checked,
            document.querySelector('input[name="display"]:checked').value,
            showCommentTimestamps
          );
        }
      );
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
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "updateDisplayOption",
        enabled: enabled,
        displayOption: displayOption,
        commentTimestamps: commentTimestamps,
      });
    });
  }

  document.getElementById("creditsLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: e.target.href });
  });
});
