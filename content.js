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

// Add this near the top of the file
const ROUTES = {
  FEED: "/feed/",
  PROFILE: "/in/",
  SINGLE_POST: "/feed/update/",
  SINGLE_POST2: "/posts/",
  RECENT_ACTIVITY: "/recent-activity/",
};

function getCurrentRoute() {
  const url = window.location.href;

  // Check for recent activity pages first
  if (url.includes("/recent-activity/")) {
    return "RECENT_ACTIVITY";
  }

  // Then check other routes
  for (const [key, path] of Object.entries(ROUTES)) {
    if (url.includes(path)) return key;
  }
  return null;
}

// Function to decode the timestamp from LinkedIn's post ID
function decodeLinkedInTimestamp(postID) {
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

  // Common date format options
  const dateOptions = {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  };

  const formattedDate = date.toLocaleDateString("en-US", dateOptions);

  if (displayOption !== "datetime") {
    return formattedDate;
  }

  // Additional time formatting for datetime option
  const formattedTime = date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s(AM|PM)/, "$1");

  return `${formattedDate}, ${formattedTime} (${shortTimeZone})`;
}

// Function to process and update timestamps on main feed posts and recent activity
function handleMainFeedPosts(displayOption, rootNode = document) {
  // Find all post elements using the defined selectors
  const postElements = rootNode.querySelectorAll(SELECTORS.postElements);

  postElements.forEach((postElement) => {
    // Extract the post ID from either data-id or data-urn attribute
    const dataId =
      postElement.getAttribute("data-id") ||
      postElement.getAttribute("data-urn");
    if (!dataId) return;

    // Extract the numeric ID from the end of the data attribute
    const postID = dataId.split(":").pop();
    const timestampMillis = decodeLinkedInTimestamp(postID);
    if (!timestampMillis) return;

    // Format the timestamp according to user preferences
    const formattedDate = formatDate(timestampMillis, displayOption);
    // Find the element containing the relative time text (e.g., "2 hours ago")
    const relativeTimeElement = postElement.querySelector(
      SELECTORS.relativeTime
    );

    if (!relativeTimeElement) return;

    // Store the original relative time text if not already saved
    if (!relativeTimeElement.hasAttribute("data-original-text")) {
      const originalText = Array.from(relativeTimeElement.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ");
      relativeTimeElement.setAttribute("data-original-text", originalText);
    }

    // Retrieve the stored original text
    const originalText = relativeTimeElement.getAttribute("data-original-text");

    // Remove all existing text nodes to prepare for new timestamp
    Array.from(relativeTimeElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        relativeTimeElement.removeChild(node);
      }
    });

    // Create the new timestamp format: "MM/DD/YY • original relative time"
    const newText = `${formattedDate} • ${originalText}`;
    // Insert the new timestamp at the beginning of the element
    relativeTimeElement.insertBefore(
      document.createTextNode(newText),
      relativeTimeElement.firstChild
    );
  });
}

// Function to handle single post pages (/feed/update/... or /posts/...)
function handleSinglePostPage(displayOption, rootNode = document, currentUrl) {
  let postId;

  // Handle /feed/update/ format
  const activityPattern = /urn:li:activity:(\d+)/;
  const activityMatch = currentUrl.match(activityPattern);

  // Handle /posts/ format
  const postsPattern = /activity-(\d+)/;
  const postsMatch = currentUrl.match(postsPattern);

  if (activityMatch) {
    postId = activityMatch[1];
  } else if (postsMatch) {
    postId = postsMatch[1];
  } else {
    return;
  }

  // Get the timestamp from the activity ID
  const timestampMillis = decodeLinkedInTimestamp(postId);
  if (!timestampMillis) return;

  // Find the relative time element
  const relativeTimeElement = rootNode.querySelector(
    '.update-components-actor__sub-description span[aria-hidden="true"]'
  );

  if (!relativeTimeElement) return;

  // Format the new date
  const formattedDate = formatDate(timestampMillis, displayOption);

  if (relativeTimeElement.hasAttribute("data-timestamp-added")) {
    // Update existing timestamp
    const firstTextNode = Array.from(relativeTimeElement.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE
    );
    if (firstTextNode) {
      firstTextNode.textContent = `${formattedDate} • `;
    }
  } else {
    // Add new timestamp
    relativeTimeElement.insertBefore(
      document.createTextNode(`${formattedDate} • `),
      relativeTimeElement.firstChild
    );
    relativeTimeElement.setAttribute("data-timestamp-added", "true");
  }
}

// Function to handle profile activity posts (linkedin.com/in/[username])
function handleProfilePosts(displayOption, rootNode = document) {
  // Add a small delay to ensure DOM is loaded
  setTimeout(() => {
    // The IDs are within the <a> tag in the .pv0.ph5 div
    const profileLinks =
      rootNode.querySelector(".pv0.ph5")?.getElementsByTagName("a") || [];
    const activityPattern = /urn:li:activity:(\d+)/;

    for (const link of profileLinks) {
      // Skip non-post links
      if (!link.href.includes("/feed/update/")) continue;

      const match = link.href.match(activityPattern);
      if (!match) continue;

      const descriptionSpan = link.querySelector(SELECTORS.profileDescription);
      if (!descriptionSpan?.textContent.includes("posted this •")) continue;

      const timestampMillis = decodeLinkedInTimestamp(match[1]);
      if (!timestampMillis) continue;

      const strongElement = descriptionSpan.querySelector("strong");
      if (!strongElement) continue;

      // Store original text if not already saved
      if (!descriptionSpan.hasAttribute("data-original-text")) {
        descriptionSpan.setAttribute(
          "data-original-text",
          descriptionSpan.textContent.trim()
        );
      }

      const originalText = descriptionSpan.getAttribute("data-original-text");
      const relativeTime = originalText
        .split("posted this •")[1]
        ?.split("•")
        .pop()
        ?.trim();

      if (!relativeTime) continue;

      // Clear existing text nodes
      Array.from(descriptionSpan.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .forEach((node) => node.remove());

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
  }, 1000); // Added delay to ensure DOM is ready
}

// Main function that calls the appropriate handler based on URL
function replaceRelativeTimes(displayOption, rootNode = document) {
  const route = getCurrentRoute();

  if (route === "SINGLE_POST" || route === "SINGLE_POST2") {
    handleSinglePostPage(displayOption, rootNode, window.location.href);
  } else if (route === "RECENT_ACTIVITY") {
    handleMainFeedPosts(displayOption, rootNode);
  } else if (route === "PROFILE") {
    handleProfilePosts(displayOption, rootNode);
  } else if (route === "FEED") {
    handleMainFeedPosts(displayOption, rootNode);
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

// Add cleanup function
function cleanup() {
  if (feedObserver) {
    feedObserver.disconnect();
    feedObserver = null;
  }
  // Clear any running intervals
  if (window.urlCheckInterval) {
    clearInterval(window.urlCheckInterval);
  }
}

// Add to extension disable handler
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

  const onUrlChange = async () => {
    const newUrl = window.location.href;
    if (currentUrl !== newUrl) {
      currentUrl = newUrl;

      // Clear existing interval
      if (urlCheckInterval) {
        clearInterval(urlCheckInterval);
      }

      // Wait for DOM to settle after SPA navigation
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Get latest settings and apply changes
      try {
        const data = await chrome.storage.sync.get([
          "displayOption",
          "extensionEnabled",
        ]);
        if (data.extensionEnabled !== false) {
          replaceRelativeTimes(data.displayOption || "date");

          // Set up a short interval to catch dynamically loaded content
          urlCheckInterval = setInterval(() => {
            replaceRelativeTimes(data.displayOption || "date");
          }, 1000);

          // Clear interval after 5 seconds
          setTimeout(() => {
            if (urlCheckInterval) {
              clearInterval(urlCheckInterval);
            }
          }, 5000);
        }
      } catch (error) {
        console.error("Error handling URL change:", error);
      }
    }
  };

  // Listen for URL changes using History API
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

  // Listen for PopState event
  window.addEventListener("popstate", onUrlChange);

  // Observe DOM changes for SPA navigation
  const observer = new MutationObserver(() => {
    if (currentUrl !== window.location.href) {
      onUrlChange();
    }
  });

  // Observe changes to the main content area
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial check
  onUrlChange();
}

// Run the replacement initially and set up observers
initializeDateReplacement();

// Start monitoring URL changes
monitorUrlChanges();
