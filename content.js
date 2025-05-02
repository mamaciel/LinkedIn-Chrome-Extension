let feedObserver = null;
let currentUrl = window.location.href;

// Global comment observer
let commentObserver = null;

// Add at the top of the file, after the initial variables
const SELECTORS = {
  postElements:
    'div[data-id*="urn:li:activity"], div[data-urn*="urn:li:activity"], a[href*="urn:li:activity"]',
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
const DEBOUNCE_DELAY = 300; // increased from 100ms to reduce processing frequency
const THROTTLE_DELAY = 1000; // added throttle delay
const PROCESSED_POSTS = new Set(); // Track which posts we've already processed
const PROCESSED_REPOSTS = new Set(); // Track which reposts we've already processed

// Function to get the user's preferred date format
let userDateFormat = "browser"; // default
let dateFormatter = null;
let timeFormatter = null;
let use24HourTime = false;

function updateFormatters() {
  if (userDateFormat === "iso") {
    dateFormatter = null; // not used
    timeFormatter = null; // not used
  } else {
    // Use browser locale
    const locale = navigator.language || "en-US";
    dateFormatter = new Intl.DateTimeFormat(locale, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    });
    timeFormatter = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: !use24HourTime ? undefined : false,
    });
  }
}

// Function to format the date
function formatDate(timestampMillis) {
  const date = new Date(timestampMillis);
  if (userDateFormat === "iso") {
    // ISO 8601, but only date part (YYYY-MM-DD)
    const isoDate = date.toISOString().slice(0, 10); // YYYY-MM-DD
    // Local time, 24h, with short timezone
    const localTime = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${isoDate}, ${localTime} ${shortTimeZone}`;
  } else {
    // Browser locale
    const formattedDate = dateFormatter.format(date);
    // Use 24-hour or locale time based on use24HourTime
    let formattedTime;
    if (use24HourTime) {
      formattedTime = date.toLocaleTimeString(navigator.language, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } else {
      formattedTime = timeFormatter.format(date);
    }
    return `${formattedDate}, ${formattedTime} ${shortTimeZone}`;
  }
}

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

// Add new throttle function to limit the frequency of function calls
function throttle(func, wait) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall < wait) return;
    lastCall = now;
    return func(...args);
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

  try {
    // Ensure postID is a string and clean it thoroughly
    const cleanID = String(postID).replace(/[^0-9]/g, "");
    if (!cleanID) return null;

    return Number(BigInt(cleanID) >> 22n);
  } catch (error) {
    return null;
  }
}

// Simplify date formatting by caching timezone
const shortTimeZone = new Date()
  .toLocaleTimeString("en-us", { timeZoneName: "short" })
  .split(" ")
  .pop();

// Improved post processing function with better performance
function handleMainFeedPosts(rootNode = document, force = false) {
  // Use a more specific root node if possible
  if (!rootNode) return;

  // Only process main posts, not all potential post elements
  const posts = Array.from(
    rootNode.querySelectorAll(SELECTORS.postElements)
  ).filter((post) => {
    const id =
      post.getAttribute("data-id") ||
      post.getAttribute("data-urn") ||
      (post.tagName === "A"
        ? post.href
            .split("/")
            .find((part) => part.startsWith("urn:li:activity"))
        : null);
    return force ? true : id && !PROCESSED_POSTS.has(id);
  });

  if (posts.length === 0) {
    // Even if no main posts were found, we should still check for shared/quoted posts
    processSharedPosts(rootNode);
    return;
  }

  // Process the regular posts
  posts.forEach((post) => {
    const dataId =
      post.getAttribute("data-id") ||
      post.getAttribute("data-urn") ||
      (post.tagName === "A"
        ? post.href
            .split("/")
            .find((part) => part.startsWith("urn:li:activity"))
        : null);
    if (!dataId) return;

    try {
      // Skip if already processed
      if (PROCESSED_POSTS.has(dataId)) return;

      // Process the post
      const postID = dataId.split(":").pop().replace(/\D/g, "");
      const timestampMillis = decodeLinkedInTimestamp(postID);
      if (!timestampMillis) {
        return;
      }

      const relativeTimeElement = post.querySelector(SELECTORS.relativeTime);
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
      const originalText =
        relativeTimeElement.getAttribute("data-original-text");

      // Remove all existing text nodes to prepare for new timestamp
      Array.from(relativeTimeElement.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          relativeTimeElement.removeChild(node);
        }
      });

      // Create the new timestamp format: "MM/DD/YY • original relative time"
      const formattedDate = formatDate(timestampMillis);
      const newText = `${formattedDate} • ${originalText}`;
      // Insert the new timestamp at the beginning of the element
      const insertionPoint =
        relativeTimeElement.firstChild ||
        relativeTimeElement.querySelector(".visually-hidden") ||
        relativeTimeElement;
      relativeTimeElement.insertBefore(
        document.createTextNode(newText),
        insertionPoint
      );

      PROCESSED_POSTS.add(dataId);
    } catch (error) {
      // Silent error handling to improve performance
    }
  });

  // Process shared posts (quoted posts) from parent feed
  processSharedPosts(rootNode);

  // Process reposts more efficiently
  const repostedContent = Array.from(
    rootNode.querySelectorAll(
      ".update-components-mini-update-v2, .feed-shared-mini-update-v2, .jYxwoDPICzGnzPlhvawkGRVRIAwOdWbZeLLqv, .feed-shared-update-v2__update-content-wrapper"
    )
  ).filter((repost) => {
    // Generate a unique identifier for this repost element
    const repostId =
      repost.getAttribute("data-id") ||
      repost.getAttribute("data-urn") ||
      repost.innerHTML.slice(0, 100); // Use content hash as fallback

    // Skip if already processed
    return !PROCESSED_REPOSTS.has(repostId);
  });

  if (repostedContent.length > 0) {
    repostedContent.forEach((repost) => {
      // Generate repost identifier for tracking
      const repostId =
        repost.getAttribute("data-id") ||
        repost.getAttribute("data-urn") ||
        repost.innerHTML.slice(0, 100);

      // Mark as processed right away to prevent repeated processing
      PROCESSED_REPOSTS.add(repostId);

      // Find the timestamp element inside the repost
      const innerTimeElement = repost.querySelector(
        '.update-components-actor__sub-description span[aria-hidden="true"]'
      );
      if (!innerTimeElement) return;

      // Skip if this element already has our date format (to avoid reprocessing)
      if (
        innerTimeElement.textContent.match(
          /\w{3} \d{1,2}(?:st|nd|rd|th), \d{4}/
        )
      ) {
        return;
      }

      // Try to find the activity ID from the repost
      let activityId = null;

      // First try to find it in a link
      const activityLink = repost.querySelector(
        'a[href*="urn:li:activity"], a[href*="/feed/update/"]'
      );
      if (activityLink && activityLink.href) {
        // Check URL-based activity ID (/feed/update/urn:li:activity:123456)
        const hrefActivityMatch = activityLink.href.match(
          /\/feed\/update\/(urn:li:activity:[0-9]+)/
        );
        if (hrefActivityMatch && hrefActivityMatch[1]) {
          activityId = hrefActivityMatch[1];
        } else {
          // Try the previous method
          activityId = activityLink.href
            .split("/")
            .find((part) => part.startsWith("urn:li:activity"));
        }
      }

      // If no link, try looking for data attributes directly on the container
      if (!activityId) {
        const container = repost.closest("[data-id], [data-urn]");
        if (container) {
          activityId =
            container.getAttribute("data-id") ||
            container.getAttribute("data-urn");
        }
      }

      // If still no ID, try to get from the original post (parent of repost)
      if (!activityId) {
        const parentPost = repost.closest(".feed-shared-update-v2");
        if (parentPost) {
          activityId =
            parentPost.getAttribute("data-id") ||
            parentPost.getAttribute("data-urn");
        }
      }

      // Last resort: try to extract from the timestamp text
      if (!activityId && innerTimeElement) {
        // Most reposts include a text timestamp, which we can use (though it's less precise)
        const textMatch =
          innerTimeElement.textContent.match(/(\d+)(w|mo|h|d|m)/);
        if (textMatch) {
          // Create a rough timestamp based on current time minus the relative time
          const amount = parseInt(textMatch[1], 10);
          const unit = textMatch[2];

          let timestamp = Date.now();

          switch (unit) {
            case "w": // weeks
              timestamp -= amount * 7 * 24 * 60 * 60 * 1000;
              break;
            case "d": // days
              timestamp -= amount * 24 * 60 * 60 * 1000;
              break;
            case "h": // hours
              timestamp -= amount * 60 * 60 * 1000;
              break;
            case "m": // minutes
              timestamp -= amount * 60 * 1000;
              break;
            case "mo": // months (approximate)
              timestamp -= amount * 30 * 24 * 60 * 60 * 1000;
              break;
          }

          // Use this timestamp directly
          const formattedDate = formatDate(timestamp);
          const originalText = innerTimeElement.textContent.trim();

          // Update the element
          innerTimeElement.setAttribute("data-original-text", originalText);

          // Clear any existing text nodes
          Array.from(innerTimeElement.childNodes).forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              innerTimeElement.removeChild(node);
            }
          });

          // Insert new timestamp
          innerTimeElement.insertBefore(
            document.createTextNode(`${formattedDate} • ${originalText}`),
            innerTimeElement.firstChild
          );

          return;
        }
      }

      if (!activityId) {
        return;
      }

      // Extract the timestamp
      const postID = activityId.split(":").pop().replace(/\D/g, "");
      const timestampMillis = decodeLinkedInTimestamp(postID);

      if (!timestampMillis) {
        return;
      }

      // Store original text
      if (!innerTimeElement.hasAttribute("data-original-text")) {
        const originalText = innerTimeElement.textContent.trim();
        innerTimeElement.setAttribute("data-original-text", originalText);
      }

      // Format date and set text
      const formattedDate = formatDate(timestampMillis);
      const originalText = innerTimeElement.getAttribute("data-original-text");

      // Update the text content
      // First clear any text nodes
      Array.from(innerTimeElement.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          innerTimeElement.removeChild(node);
        }
      });

      // Insert new timestamp at beginning
      innerTimeElement.insertBefore(
        document.createTextNode(`${formattedDate} • ${originalText}`),
        innerTimeElement.firstChild
      );
    });
  }
}

// New function to process shared/quoted posts
function processSharedPosts(rootNode = document) {
  // This selector specifically targets the time elements in quoted/shared posts
  const sharedPostTimeElements = rootNode.querySelectorAll(
    '.update-components-actor__sub-description span[aria-hidden="true"], ' +
      '.feed-shared-update-v2__update-content-wrapper .update-components-actor__sub-description span[aria-hidden="true"]'
  );

  if (sharedPostTimeElements.length === 0) return;

  sharedPostTimeElements.forEach((timeElement) => {
    // Check if this is a shared/quoted post by finding its container
    const isSharedPost = timeElement.closest(
      ".feed-shared-update-v2__update-content-wrapper, .cuuDdRdBaBNVooHntvuKRWxGnKdpmjgCxs"
    );

    // Skip if already processed (contains a formatted date)
    // For each format type we might use
    if (
      timeElement.textContent.match(/\d{2}\/\d{2}\/\d{2}, \d{2}:\d{2}/) || // MM/DD/YY format
      timeElement.textContent.match(/\d{4}-\d{2}-\d{2}, \d{2}:\d{2}/) || // ISO format (YYYY-MM-DD)
      timeElement.textContent.match(/\w{3} \d{1,2}, \d{4}/) // Month D, YYYY format
    ) {
      return;
    }

    // Generate a more specific unique identifier for this time element
    const parentContainer = isSharedPost
      ? timeElement.closest(
          ".feed-shared-update-v2__update-content-wrapper, .cuuDdRdBaBNVooHntvuKRWxGnKdpmjgCxs"
        )
      : timeElement.closest(".feed-shared-update-v2, .ember-view");

    // Include container path in ID to ensure unique processing
    const containerPath = parentContainer
      ? parentContainer.className.substring(0, 20)
      : "";
    const timeId = `${containerPath}_${timeElement.textContent}_${Date.now()}`;

    if (PROCESSED_POSTS.has(timeId)) return;

    // Mark as processed immediately to prevent reprocessing
    PROCESSED_POSTS.add(timeId);

    // Find the activity ID specifically for this post or shared post
    let activityId = null;

    // For shared posts, look for the link to the original post first
    if (isSharedPost) {
      // Try to find link to original post in the shared content
      const sharedPostLink = parentContainer.querySelector(
        'a[href*="/feed/update/"]'
      );
      if (sharedPostLink && sharedPostLink.href) {
        const match = sharedPostLink.href.match(
          /\/feed\/update\/(urn:li:activity:[0-9]+)/
        );
        if (match && match[1]) {
          activityId = match[1];
        }
      }

      // Alternative: check for embedded data-id or data-urn attribute
      if (!activityId) {
        const nearestDataElement = parentContainer.querySelector(
          "[data-id], [data-urn]"
        );
        if (nearestDataElement) {
          activityId =
            nearestDataElement.getAttribute("data-id") ||
            nearestDataElement.getAttribute("data-urn");
        }
      }
    } else {
      // For main post, check containing element with data-id or data-urn
      const container = timeElement.closest("[data-id], [data-urn]");
      if (container) {
        activityId =
          container.getAttribute("data-id") ||
          container.getAttribute("data-urn");
      }
    }

    // If still no activity ID, try to find nearby link with activity ID
    if (!activityId) {
      // Look in the immediate vicinity of this specific time element
      const nearbyLink = timeElement
        .closest(".update-components-actor__meta")
        ?.querySelector('a[href*="urn:li:activity"], a[href*="/feed/update/"]');

      if (nearbyLink && nearbyLink.href) {
        const match = nearbyLink.href.match(
          /\/feed\/update\/(urn:li:activity:[0-9]+)/
        );
        if (match && match[1]) {
          activityId = match[1];
        } else {
          activityId = nearbyLink.href
            .split("/")
            .find((part) => part.startsWith("urn:li:activity"));
        }
      }
    }

    // Fall back to time-based approximation if no activity ID found
    if (!activityId) {
      const textMatch = timeElement.textContent.match(/(\d+)(w|mo|h|d|m)/);
      if (textMatch) {
        const amount = parseInt(textMatch[1], 10);
        const unit = textMatch[2];

        let timestamp = Date.now();

        switch (unit) {
          case "w": // weeks
            timestamp -= amount * 7 * 24 * 60 * 60 * 1000;
            break;
          case "d": // days
            timestamp -= amount * 24 * 60 * 60 * 1000;
            break;
          case "h": // hours
            timestamp -= amount * 60 * 60 * 1000;
            break;
          case "m": // minutes
            timestamp -= amount * 60 * 1000;
            break;
          case "mo": // months (approximate)
            timestamp -= amount * 30 * 24 * 60 * 60 * 1000;
            break;
        }

        // Format and update
        updateTimeElement(timeElement, timestamp);
        return;
      }
    }

    // If we have an activity ID, use it to get the timestamp
    if (activityId) {
      const postID = activityId.split(":").pop().replace(/\D/g, "");
      const timestamp = decodeLinkedInTimestamp(postID);

      if (timestamp) {
        updateTimeElement(timeElement, timestamp);
      }
    }
  });
}

// Helper function to update a time element with formatted date
function updateTimeElement(element, timestampMillis) {
  // Always use the original text for reformatting
  let originalText;
  if (element.hasAttribute("data-original-text")) {
    originalText = element.getAttribute("data-original-text");
  } else {
    originalText = element.textContent.trim();
    element.setAttribute("data-original-text", originalText);
  }

  // Format date
  const formattedDate = formatDate(timestampMillis);

  // Clear existing text nodes
  Array.from(element.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      element.removeChild(node);
    }
  });

  // Insert new timestamp
  element.insertBefore(
    document.createTextNode(`${formattedDate} • ${originalText}`),
    element.firstChild
  );
}

// Throttled version to prevent excessive processing
const throttledHandleMainFeedPosts = throttle(
  handleMainFeedPosts,
  THROTTLE_DELAY
);

// Debounced version with longer delay to reduce processing frequency
const debouncedHandleMainFeedPosts = debounce(
  handleMainFeedPosts,
  DEBOUNCE_DELAY
);

// Main function that calls the appropriate handler based on URL
function replaceRelativeTimes(rootNode = document) {
  handleMainFeedPosts(rootNode);
  handleCommentTimestamps(rootNode);
}

// Improved observer with better performance
function observeFeedContainer() {
  if (feedObserver) feedObserver.disconnect();

  // Use a more specific container when possible
  const feedContainer =
    document.querySelector(".scaffold-layout__main") || document.body;

  feedObserver = new MutationObserver((mutations) => {
    // Batch processing instead of per-mutation
    let shouldProcess = false;
    let nodeRemoved = false;

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        // Check if any relevant nodes were added
        if (mutation.addedNodes.length) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this is a post or contains posts
              if (
                node.matches?.(SELECTORS.postElements) ||
                node.querySelector?.(SELECTORS.postElements)
              ) {
                shouldProcess = true;
                break;
              }
            }
          }
        }

        // Check if any posts were removed
        if (mutation.removedNodes.length) {
          nodeRemoved = true;
        }
      }

      if (shouldProcess) break;
    }

    // Only process if necessary
    if (shouldProcess) {
      throttledHandleMainFeedPosts();
    } else if (nodeRemoved) {
      // Just clean up the set without reprocessing
      setTimeout(() => {
        cleanupInvalidPostReferences();
      }, 500);
    }
  });

  // More targeted observation parameters
  feedObserver.observe(feedContainer, {
    childList: true,
    subtree: true,
    attributes: false, // Don't observe attribute changes to improve performance
  });

  // Initial processing
  handleMainFeedPosts();
  handleCommentTimestamps();
}

// Update the isExtensionContextValid function
function isExtensionContextValid() {
  try {
    return (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      !!chrome.runtime.getManifest()
    );
  } catch (error) {
    return false;
  }
}

// Function to initialize date replacement
function initializeDateReplacement() {
  if (!isExtensionContextValid()) return;

  chrome.storage.sync
    .get(["extensionEnabled", "dateFormat", "use24HourTime"])
    .then((data) => {
      const extensionEnabled = data.extensionEnabled !== false;
      userDateFormat = data.dateFormat || "browser";
      use24HourTime = !!data.use24HourTime;
      updateFormatters();
      if (extensionEnabled) {
        replaceRelativeTimes();
        observeFeedContainer();
        observeComments();
        setTimeout(() => {
          handleMainFeedPosts();
          handleCommentTimestamps();
        }, 2000);
      } else {
        if (feedObserver) {
          feedObserver.disconnect();
          feedObserver = null;
        }
        if (commentObserver) {
          commentObserver.disconnect();
          commentObserver = null;
        }
      }
    })
    .catch((error) => {
      // Silent error handling
    });
}

// Add cleanup function
function cleanup() {
  if (feedObserver) {
    feedObserver.disconnect();
    feedObserver = null;
  }

  if (commentObserver) {
    commentObserver.disconnect();
    commentObserver = null;
  }

  // Clear processed posts set
  PROCESSED_POSTS.clear();
  PROCESSED_REPOSTS.clear();
}

// New function to clean up invalid references without reprocessing
function cleanupInvalidPostReferences() {
  // Remove entries for posts that no longer exist in DOM
  for (const id of PROCESSED_POSTS) {
    let postExists = false;
    if (window.CSS && CSS.escape) {
      try {
        postExists = document.querySelector(
          `[data-id="${CSS.escape(id)}"], [data-urn="${CSS.escape(id)}"]`
        );
      } catch (e) {
        // If the selector is still invalid, skip this id
        continue;
      }
    } else {
      // Fallback: check manually
      const all = [
        ...document.querySelectorAll("[data-id]"),
        ...document.querySelectorAll("[data-urn]"),
      ];
      postExists = all.some(
        (el) =>
          el.getAttribute("data-id") === id ||
          el.getAttribute("data-urn") === id
      );
    }
    if (!postExists) {
      PROCESSED_POSTS.delete(id);
    }
  }
}

// Add to extension disable handler
function handleExtensionToggle(enabled) {
  if (enabled) {
    PROCESSED_POSTS.clear();
    initializeDateReplacement();
  } else {
    // Disconnect all observers
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }
    if (commentObserver) {
      commentObserver.disconnect();
      commentObserver = null;
    }
    if (profileObserver) {
      profileObserver.disconnect();
      profileObserver = null;
    }

    // Reset any global state
    window.lastProfileProcessTime = null;

    // Force page reload to ensure all timestamps revert to original state
    location.reload();
  }
}

// Listen for popup changes to dateFormat
const messageListener = (request, sender, sendResponse) => {
  if (!isExtensionContextValid()) {
    chrome.runtime.onMessage.removeListener(messageListener);
    return;
  }

  if (request.action === "updateDisplayOption") {
    const { enabled, dateFormat, use24HourTime: msgUse24HourTime } = request;
    let shouldRerender = false;
    if (typeof dateFormat === "string" && dateFormat !== userDateFormat) {
      userDateFormat = dateFormat;
      shouldRerender = true;
    }
    if (
      typeof msgUse24HourTime === "boolean" &&
      msgUse24HourTime !== use24HourTime
    ) {
      use24HourTime = msgUse24HourTime;
      shouldRerender = true;
    }
    if (shouldRerender) {
      updateFormatters();
      PROCESSED_POSTS.clear();
      PROCESSED_REPOSTS.clear();
      replaceRelativeTimes();
    }
    handleExtensionToggle(enabled);
  }
};
chrome.runtime.onMessage.addListener(messageListener);

// One-time storage listener at the top-level
chrome.storage.onChanged.addListener((changes, area) => {
  if (!isExtensionContextValid()) return;
  if (area === "sync") {
    // Check if extension was disabled
    if (
      changes.extensionEnabled &&
      changes.extensionEnabled.newValue === false
    ) {
      if (feedObserver) {
        feedObserver.disconnect();
        feedObserver = null;
      }
      if (commentObserver) {
        commentObserver.disconnect();
        commentObserver = null;
      }
      if (profileObserver) {
        profileObserver.disconnect();
        profileObserver = null;
      }
      window.lastProfileProcessTime = null;
      location.reload();
      return;
    }

    // Rerun replacement after changes to update display formatting
    chrome.storage.sync
      .get(["extensionEnabled"])
      .then((data) => {
        if (!isExtensionContextValid()) return;
        const displayOption = "datetime"; // Always use datetime format
        const extensionEnabled = data.extensionEnabled !== false;

        if (extensionEnabled) {
          replaceRelativeTimes();
          observeComments();
        } else {
          if (feedObserver) {
            feedObserver.disconnect();
            feedObserver = null;
          }
          if (commentObserver) {
            commentObserver.disconnect();
            commentObserver = null;
          }
        }
      })
      .catch((error) => {
        // Silent error handling
      });
  }
});

// Simplified URL change monitoring
function monitorUrlChanges() {
  let currentPath = window.location.pathname;

  const checkPathChange = () => {
    const newPath = window.location.pathname;
    if (newPath !== currentPath) {
      currentPath = newPath;
      cleanupProcessedPosts();

      // Force reinitialization with a single check
      setTimeout(() => {
        initializeDateReplacement();
      }, 500);
    }
  };

  // Use the History API for better performance
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function () {
    originalPushState.apply(this, arguments);
    checkPathChange();
  };

  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    checkPathChange();
  };

  window.addEventListener("popstate", checkPathChange);
}

// Clean up processed posts when navigating
function cleanupProcessedPosts() {
  PROCESSED_POSTS.clear();
  PROCESSED_REPOSTS.clear();
}

// Run the replacement initially and set up observers
initializeDateReplacement();

// Start monitoring URL changes
monitorUrlChanges();

// Optimized comment handling
function handleCommentTimestamps(rootNode = document) {
  const commentElements = rootNode.querySelectorAll(SELECTORS.comments);
  if (commentElements.length === 0) return;

  commentElements.forEach((commentElement) => {
    try {
      // Skip processing if already handled
      const dataId = commentElement.getAttribute("data-id");
      if (!dataId || PROCESSED_POSTS.has(dataId)) {
        return;
      }

      // Extract the numeric part using regex
      const numericMatch = dataId.match(/(\d+)[^\d]*$/);
      const commentId = numericMatch ? numericMatch[1] : null;

      if (!commentId) {
        return;
      }

      const timestampMillis = decodeLinkedInTimestamp(commentId);
      if (!timestampMillis) {
        return;
      }

      const timeElement = commentElement.querySelector(SELECTORS.commentTime);
      if (!timeElement) return;

      // Always use the original text for reformatting
      let originalText;
      if (timeElement.hasAttribute("data-original-text")) {
        originalText = timeElement.getAttribute("data-original-text");
      } else {
        originalText = timeElement.textContent.trim();
        timeElement.setAttribute("data-original-text", originalText);
      }

      // Clear all text nodes
      Array.from(timeElement.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          timeElement.removeChild(node);
        }
      });

      const formattedDate = formatDate(timestampMillis);
      timeElement.textContent = `${formattedDate} • ${originalText}`;

      PROCESSED_POSTS.add(dataId);
    } catch (err) {
      // Silent error handling
    }
  });
}

// More efficient comment observer
function observeComments() {
  // Disconnect existing observer if any
  if (commentObserver) {
    commentObserver.disconnect();
  }

  // First, process any existing comments
  handleCommentTimestamps();

  // Set up a mutation observer specifically for comments with better targeting
  commentObserver = new MutationObserver((mutations) => {
    let shouldProcess = false;

    // Scan mutations more efficiently
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check specifically for comment additions
            if (
              node.matches &&
              (node.matches(SELECTORS.comments) ||
                node.querySelector(SELECTORS.comments))
            ) {
              shouldProcess = true;
              break;
            }
          }
        }
      }
      if (shouldProcess) break;
    }

    // Only process when necessary
    if (shouldProcess) {
      throttledHandleComments();
    }
  });

  // More targeted observation to improve performance
  const commentsContainer =
    document.querySelector(".scaffold-layout__main") || document.body;
  commentObserver.observe(commentsContainer, {
    childList: true,
    subtree: true,
    attributes: false,
  });

  // Throttled comment handling
  const throttledHandleComments = throttle(() => {
    handleCommentTimestamps();
  }, 1000);
}

// Add manual refresh detection for LinkedIn logo click
document.addEventListener("click", (e) => {
  if (e.target.closest('a[href="/feed/"]')) {
    setTimeout(() => {
      PROCESSED_POSTS.clear();
      handleMainFeedPosts();
    }, 500);
  }
});

// More efficient periodic check as fallback
setInterval(() => {
  if (document.querySelector(SELECTORS.postElements) && !feedObserver) {
    initializeDateReplacement();
  }
}, 10000); // Reduced frequency: now 10 seconds instead of 5

// Replace the existing profileObserver with a more targeted version
const profileObserver = new MutationObserver(
  debounce(() => {
    if (window.location.pathname.includes("/in/")) {
      // Only process if we haven't recently processed
      if (
        !window.lastProfileProcessTime ||
        Date.now() - window.lastProfileProcessTime > 5000
      ) {
        window.lastProfileProcessTime = Date.now();
        handleMainFeedPosts(document, false);
      }
    }
  }, 1000) // Increased debounce to further reduce processing
);

// Use a more targeted selector for the profile observer
const profileContainer =
  document.querySelector(".scaffold-layout__main") || document.body;
profileObserver.observe(profileContainer, {
  childList: true,
  subtree: true,
  attributes: false, // Don't observe attributes
});

// Efficient memory management - clean up less frequently
setInterval(() => {
  // If too many items are in the sets, clear older ones
  if (PROCESSED_REPOSTS.size > 500) {
    PROCESSED_REPOSTS.clear();
  }

  if (PROCESSED_POSTS.size > 500) {
    PROCESSED_POSTS.clear();
  }
}, 60000); // Every 60 seconds instead of 30
