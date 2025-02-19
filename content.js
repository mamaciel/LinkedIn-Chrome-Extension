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
  comments: "article.comments-comment-entity",
  commentTime: "time.comments-comment-meta__data",
};

// Add this near the top of the file
const ROUTES = {
  COMPANY: "/company/",
  FEED: "/feed/",
  PROFILE: "/in/",
  SINGLE_POST: "/feed/update/",
  SINGLE_POST2: "/posts/",
  RECENT_ACTIVITY: "/recent-activity/",
  SEARCH: "/search/",
};

// Add at the top with other constants
const DEBOUNCE_DELAY = 100; // milliseconds
const PROCESSED_POSTS = new Set(); // Track which posts we've already processed

// Cache formatters
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Utility debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function getCurrentRoute() {
  const url = window.location.href;

  // Check for single post pages first (they're more specific)
  if (url.includes("/feed/update/") || url.includes("/posts/")) {
    return url.includes("/feed/update/") ? "SINGLE_POST" : "SINGLE_POST2";
  }

  // Then check other routes
  return (
    Object.entries(ROUTES).find(([_, path]) => url.includes(path))?.[0] || null
  );
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
  const formattedDate = dateFormatter.format(date);

  if (displayOption !== "datetime") {
    return formattedDate;
  }

  const formattedTime = timeFormatter.format(date).replace(/\s(AM|PM)/, "$1");

  return `${formattedDate}, ${formattedTime} (${shortTimeZone})`;
}

// Function to process and update timestamps on main feed posts and recent activity
function handleMainFeedPosts(displayOption, rootNode = document) {
  // Find all post elements using the defined selectors
  const postElements = rootNode.querySelectorAll(SELECTORS.postElements);

  postElements.forEach((postElement) => {
    // Skip if we've already processed this post
    const dataId =
      postElement.getAttribute("data-id") ||
      postElement.getAttribute("data-urn");
    if (!dataId || PROCESSED_POSTS.has(dataId)) return;

    // Process the post
    const postID = dataId.split(":").pop();
    const timestampMillis = decodeLinkedInTimestamp(postID);
    if (!timestampMillis) return;

    const relativeTimeElement = postElement.querySelector(
      SELECTORS.relativeTime
    );
    if (!relativeTimeElement) return;

    // Format the timestamp according to user preferences
    const formattedDate = formatDate(timestampMillis, displayOption);

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

    // Mark this post as processed
    PROCESSED_POSTS.add(dataId);
  });
}

// Debounced version of the handler
const debouncedHandleMainFeedPosts = debounce(
  handleMainFeedPosts,
  DEBOUNCE_DELAY
);

// Main function that calls the appropriate handler based on URL
function replaceRelativeTimes(displayOption, rootNode = document) {
  handleMainFeedPosts(displayOption, rootNode);

  // Get the setting and process comments if enabled
  chrome.storage.sync.get(["commentTimestamps"], (data) => {
    if (data.commentTimestamps === true) {
      handleCommentTimestamps(displayOption, rootNode);
    }
  });
}

// Function to observe the feed container and profile content
function observeFeedContainer(displayOption) {
  // If an observer already exists, disconnect it
  if (feedObserver) {
    feedObserver.disconnect();
  }

  // Create a new observer that watches for both feed and profile content
  feedObserver = new MutationObserver((mutationsList) => {
    let shouldProcessPosts = false;
    let shouldProcessComments = false;

    // Check if any mutations are relevant before processing
    for (const mutation of mutationsList) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        const addedNodes = Array.from(mutation.addedNodes);

        // Check for new posts
        if (
          addedNodes.some(
            (node) =>
              node.nodeType === Node.ELEMENT_NODE &&
              (node.querySelector(SELECTORS.postElements) ||
                node.matches(SELECTORS.postElements))
          )
        ) {
          shouldProcessPosts = true;
        }

        // Check for new comments
        if (
          addedNodes.some(
            (node) =>
              node.nodeType === Node.ELEMENT_NODE &&
              (node.querySelector(SELECTORS.comments) ||
                node.matches(SELECTORS.comments))
          )
        ) {
          shouldProcessComments = true;
        }
      }
    }

    if (shouldProcessPosts) {
      debouncedHandleMainFeedPosts(displayOption);
    }

    if (shouldProcessComments) {
      // Check if comment timestamps are enabled before processing
      chrome.storage.sync.get(["commentTimestamps"], (data) => {
        if (data.commentTimestamps === true) {
          handleCommentTimestamps(displayOption);
        }
      });
    }
  });

  // Start observing the entire document body for changes
  feedObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  // Initial run
  handleMainFeedPosts(displayOption);
  // Also check for any existing comments
  chrome.storage.sync.get(["commentTimestamps"], (data) => {
    if (data.commentTimestamps === true) {
      handleCommentTimestamps(displayOption);
    }
  });
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
  PROCESSED_POSTS.clear();
  // Clear any running intervals
  if (window.urlCheckInterval) {
    clearInterval(window.urlCheckInterval);
  }
}

// Add to extension disable handler
function handleExtensionToggle(enabled, displayOption) {
  if (enabled) {
    PROCESSED_POSTS.clear();
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
      cleanupProcessedPosts(); // Clear processed posts on navigation

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

// Clean up processed posts when navigating
function cleanupProcessedPosts() {
  PROCESSED_POSTS.clear();
  // Restore original comment timestamps
  document.querySelectorAll(SELECTORS.commentTime).forEach((timeElement) => {
    const originalText = timeElement.getAttribute("data-original-text");
    if (originalText) {
      timeElement.textContent = originalText;
    }
  });
}

// Run the replacement initially and set up observers
initializeDateReplacement();

// Start monitoring URL changes
monitorUrlChanges();

function handleCommentTimestamps(displayOption, rootNode = document) {
  const commentElements = rootNode.querySelectorAll(SELECTORS.comments);

  commentElements.forEach((commentElement) => {
    const dataId = commentElement.getAttribute("data-id");
    if (!dataId || PROCESSED_POSTS.has(dataId)) return;

    const commentId = dataId.split(",").pop().replace(")", "");
    const timestampMillis = decodeLinkedInTimestamp(commentId);
    if (!timestampMillis) return;

    const timeElement = commentElement.querySelector(SELECTORS.commentTime);
    if (!timeElement) return;

    // Store original text if not already saved
    if (!timeElement.hasAttribute("data-original-text")) {
      timeElement.setAttribute(
        "data-original-text",
        timeElement.textContent.trim()
      );
    }

    const formattedDate = formatDate(timestampMillis, displayOption);
    const originalText = timeElement.getAttribute("data-original-text");

    // Add formatted date with bullet point separator
    timeElement.textContent = `${formattedDate} • ${originalText}`;

    PROCESSED_POSTS.add(dataId);
  });
}
