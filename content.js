let feedObserver = null;
let currentUrl = window.location.href;

// Add at the top of the file, after the initial variables
const SELECTORS = {
  postElements:
    'div[data-id*="urn:li:activity"], div[data-urn*="urn:li:activity"]',
  relativeTime:
    '.update-components-actor__sub-description span[aria-hidden="true"]',
  profileDescription:
    '.feed-mini-update-contextual-description__text span[aria-hidden="true"]',
};

// Function to decode the timestamp from LinkedIn's data-id attribute
function decodeLinkedInTimestamp(dataId) {
  const postID = dataId.split(":").pop();
  if (!postID) return null;
  return Number(BigInt(postID) >> 22n);
}

// Simplify date formatting by caching timezone
const shortTimeZone = new Date()
  .toLocaleTimeString("en-us", { timeZoneName: "short" })
  .split(" ")
  .pop();

// Function to format the date based on user preference
function formatDate(timestampMillis, displayOption) {
  const date = new Date(timestampMillis);

  if (displayOption === "datetime") {
    // Format the date with two-digit year
    const formattedDate = date.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "2-digit",
    });

    // Format the time without seconds and remove space before AM/PM
    let formattedTime = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // Remove the space before AM/PM
    formattedTime = formattedTime.replace(/\s(AM|PM)/, "$1");

    return `${formattedDate}, ${formattedTime} (${shortTimeZone})`;
  } else {
    const formattedDate = date.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "2-digit",
    });
    return formattedDate; // Fixed bug here (no parentheses)
  }
}

// Function to replace relative times with exact dates while preserving SVGs
function replaceRelativeTimes(displayOption, rootNode = document) {
  // Cache the selectors
  const postElements = rootNode.querySelectorAll(SELECTORS.postElements);

  postElements.forEach((postElement) => {
    const dataId =
      postElement.getAttribute("data-id") ||
      postElement.getAttribute("data-urn");
    if (!dataId) return;

    const timestampMillis = decodeLinkedInTimestamp(dataId);
    if (!timestampMillis) return;

    const formattedDate = formatDate(timestampMillis, displayOption);
    const relativeTimeElement = postElement.querySelector(
      SELECTORS.relativeTime
    );

    if (!relativeTimeElement) return;

    // Store original text if not already stored
    if (!relativeTimeElement.hasAttribute("data-original-text")) {
      // Clone the existing text nodes
      const originalText = Array.from(relativeTimeElement.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ");
      relativeTimeElement.setAttribute("data-original-text", originalText);
    }

    const originalText = relativeTimeElement.getAttribute("data-original-text");

    // Remove existing text nodes to prevent duplication
    Array.from(relativeTimeElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        relativeTimeElement.removeChild(node);
      }
    });

    // Create and insert the new text node
    const newText = `${formattedDate} • ${originalText}`;
    relativeTimeElement.insertBefore(
      document.createTextNode(newText),
      relativeTimeElement.firstChild
    );
  });

  // Handle profile activity posts efficiently
  const profileLinks = rootNode.getElementsByTagName("a");
  const activityPattern = /urn:li:activity:(\d+)/;

  for (const link of profileLinks) {
    // Skip non-feed links early
    if (!link.href.includes("/feed/update/")) continue;

    // Extract post ID from URL
    const match = link.href.match(activityPattern);
    if (!match) continue;

    // Find and validate the description span
    const descriptionSpan = link.querySelector(SELECTORS.profileDescription);
    if (!descriptionSpan?.textContent.includes("posted this •")) continue;

    // Get timestamp
    const timestampMillis = decodeLinkedInTimestamp(
      `urn:li:activity:${match[1]}`
    );
    if (!timestampMillis) continue;

    // Find the username element
    const strongElement = descriptionSpan.querySelector("strong");
    if (!strongElement) continue;

    // Get relative time from original text
    const originalText = descriptionSpan.textContent.trim();
    const relativeTime = originalText
      .split("posted this •")[1]
      ?.split("•")
      .pop()
      ?.trim();
    if (!relativeTime) continue;

    // Remove all text nodes while preserving the strong element
    Array.from(descriptionSpan.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .forEach((node) => node.remove());

    // Clear any remaining content after the strong element
    while (strongElement.nextSibling) {
      strongElement.nextSibling.remove();
    }

    // Add the new formatted text
    descriptionSpan.appendChild(
      document.createTextNode(
        ` posted this • ${formatDate(
          timestampMillis,
          displayOption
        )} • ${relativeTime}`
      )
    );
  }
}

// Function to observe the feed container and profile content
function observeFeedContainer(displayOption) {
  // If an observer already exists, disconnect it
  if (feedObserver) {
    feedObserver.disconnect();
  }

  // Create a new observer that watches for both feed and profile content
  feedObserver = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Run the replacement on the new node
            replaceRelativeTimes(displayOption, node);
          }
        });
      }
    }
  });

  // Start observing the entire document body for changes
  feedObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also run the replacement immediately
  replaceRelativeTimes(displayOption);
}

// Check if the extension context is valid
function isExtensionContextValid() {
  return (
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    !!chrome.runtime.getManifest()
  );
}

// Function to initialize date replacement
function initializeDateReplacement() {
  if (!isExtensionContextValid()) return;

  chrome.storage.sync
    .get(["displayOption", "extensionEnabled"])
    .then((data) => {
      if (!isExtensionContextValid()) return;

      const displayOption = data.displayOption || "date";
      const extensionEnabled = data.extensionEnabled !== false;

      if (extensionEnabled) {
        // Run the replacement initially on the whole document
        replaceRelativeTimes(displayOption);
        // Observe the feed container for new posts
        observeFeedContainer(displayOption);
      } else {
        if (feedObserver) {
          feedObserver.disconnect();
          feedObserver = null;
        }
      }
    })
    .catch((error) => {
      console.log("Storage access failed:", error);
    });
}

function handleExtensionToggle(enabled, displayOption) {
  if (enabled) {
    initializeDateReplacement();
  } else {
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }
    location.reload();
  }
}

// Update the message listener
const messageListener = (request, sender, sendResponse) => {
  if (!isExtensionContextValid()) {
    chrome.runtime.onMessage.removeListener(messageListener);
    return;
  }

  if (request.action === "updateDisplayOption") {
    handleExtensionToggle(request.enabled, request.displayOption);
  }
};

chrome.runtime.onMessage.addListener(messageListener);

// One-time storage listener at the top-level
chrome.storage.onChanged.addListener((changes, area) => {
  if (!isExtensionContextValid()) return;
  if (area === "sync") {
    // Rerun replacement after changes to update display formatting
    chrome.storage.sync.get(["displayOption", "extensionEnabled"], (data) => {
      if (!isExtensionContextValid()) return;
      const displayOption = data.displayOption || "date";
      const extensionEnabled = data.extensionEnabled !== false;

      if (extensionEnabled) {
        replaceRelativeTimes(displayOption);
      } else {
        if (feedObserver) {
          feedObserver.disconnect();
          feedObserver = null;
        }
      }
    });
  }
});

// Function to monitor URL changes
function monitorUrlChanges() {
  let currentUrl = window.location.href;
  let urlCheckInterval;

  const onUrlChange = () => {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;

      // Clear any existing interval
      if (urlCheckInterval) {
        clearInterval(urlCheckInterval);
      }

      // Set up an interval to check for new content
      urlCheckInterval = setInterval(() => {
        chrome.storage.sync
          .get(["displayOption", "extensionEnabled"])
          .then((data) => {
            if (data.extensionEnabled !== false) {
              replaceRelativeTimes(data.displayOption || "date");
            }
          });
      }, 1000); // Check every second

      // Clear the interval after 10 seconds
      setTimeout(() => {
        if (urlCheckInterval) {
          clearInterval(urlCheckInterval);
        }
      }, 10000);

      // Initial replacement
      initializeDateReplacement();
    }
  };

  // Override pushState and replaceState to detect URL changes
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onUrlChange();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onUrlChange();
  };

  // Listen to the popstate event
  window.addEventListener("popstate", onUrlChange);

  // Initial URL check
  onUrlChange();
}

// Run the replacement initially and set up observers
initializeDateReplacement();

// Start monitoring URL changes
monitorUrlChanges();
