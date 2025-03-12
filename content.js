let feedObserver = null;
let currentUrl = window.location.href;

// Global comment observer
let commentObserver = null;

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

  try {
    // Ensure postID is a string and clean it thoroughly
    const cleanID = String(postID).replace(/[^0-9]/g, "");
    if (!cleanID) return null;

    return Number(BigInt(cleanID) >> 22n);
  } catch (error) {
    // Avoid console logging to prevent infinite loops
    // Just return null on any error
    return null;
  }
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
function handleMainFeedPosts(
  displayOption,
  rootNode = document,
  force = false
) {
  const posts = Array.from(
    rootNode.querySelectorAll(SELECTORS.postElements)
  ).filter((post) => {
    const id = post.getAttribute("data-id") || post.getAttribute("data-urn");
    return force ? true : id && !PROCESSED_POSTS.has(id);
  });

  if (posts.length === 0) return;

  posts.forEach((post) => {
    const dataId =
      post.getAttribute("data-id") || post.getAttribute("data-urn");
    if (!dataId) return;

    try {
      // Process the post
      const postID = dataId.split(":").pop();
      const timestampMillis = decodeLinkedInTimestamp(postID);
      if (!timestampMillis) {
        PROCESSED_POSTS.delete(dataId); // Allow retry for failed decodes
        return;
      }

      const relativeTimeElement = post.querySelector(SELECTORS.relativeTime);
      if (!relativeTimeElement) return;

      // Log post processing with timestamp info
      console.log(`%c🕒 Processing Post: ${dataId}`, "color: #4CAF50");
      console.log(
        `   Original time: ${relativeTimeElement.textContent.trim()}`
      );

      // Format the timestamp according to user preferences
      const formattedDate = formatDate(timestampMillis, displayOption);
      console.log(`   Converted to: ${formattedDate}`);

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
      const newText = `${formattedDate} • ${originalText}`;
      // Insert the new timestamp at the beginning of the element
      relativeTimeElement.insertBefore(
        document.createTextNode(newText),
        relativeTimeElement.firstChild
      );

      PROCESSED_POSTS.add(dataId);
    } catch (error) {
      console.error("Error processing post:", error);
      PROCESSED_POSTS.delete(dataId); // Remove from processed to retry
    }
  });

  // Add a retry loop for any missed posts
  setTimeout(() => {
    const unprocessed = Array.from(
      rootNode.querySelectorAll(SELECTORS.postElements)
    ).filter((post) => {
      const id = post.getAttribute("data-id") || post.getAttribute("data-urn");
      return id && !PROCESSED_POSTS.has(id);
    });

    if (unprocessed.length > 0) {
      handleMainFeedPosts(displayOption, rootNode, force);
    }
  }, 1000);
}

// Debounced version of the handler
const debouncedHandleMainFeedPosts = debounce(
  handleMainFeedPosts,
  DEBOUNCE_DELAY
);

// Main function that calls the appropriate handler based on URL
function replaceRelativeTimes(displayOption, rootNode = document) {
  handleMainFeedPosts(displayOption, rootNode);

  // Convert to Promise chain
  chrome.storage.sync
    .get(["commentTimestamps"])
    .then((data) => {
      const showComments = data.commentTimestamps ?? true;
      if (showComments) {
        handleCommentTimestamps(displayOption, rootNode);
      } else {
        revertCommentTimestamps(rootNode);
      }
    })
    .catch((error) => {
      console.error("Error getting comment settings:", error);
    });
}

// Function to observe the feed container and profile content
function observeFeedContainer(displayOption) {
  if (feedObserver) feedObserver.disconnect();

  const feedContainer =
    document.querySelector(".scaffold-layout__main") || document.body;

  feedObserver = new MutationObserver((mutations) => {
    let postsRemoved = false;

    mutations.forEach((mutation) => {
      // Handle removed posts
      if (mutation.removedNodes.length > 0) {
        Array.from(mutation.removedNodes).forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const posts = node.querySelectorAll(SELECTORS.postElements);
            posts.forEach((post) => {
              const id =
                post.getAttribute("data-id") || post.getAttribute("data-urn");
              if (id) PROCESSED_POSTS.delete(id);
            });
          }
        });
        postsRemoved = true;
      }

      // Handle new posts
      if (mutation.addedNodes.length > 0) {
        handleMainFeedPosts(displayOption);
        debouncedHandleMainFeedPosts(displayOption);
      }
    });

    if (postsRemoved) {
      // Force immediate reprocess after post removal
      setTimeout(() => handleMainFeedPosts(displayOption), 50);
    }
  });

  // More sensitive observation parameters
  feedObserver.observe(feedContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-id", "data-urn", "class"],
  });

  // Aggressive initial processing
  const process = () => {
    PROCESSED_POSTS.clear();
    handleMainFeedPosts(displayOption);

    // Also check for comments whenever feed content changes
    chrome.storage.sync.get(["commentTimestamps"], (data) => {
      const commentTimestampsEnabled = data.commentTimestamps ?? true;
      if (commentTimestampsEnabled) {
        handleCommentTimestamps(displayOption);
      }
    });
  };

  if (document.readyState === "complete") process();
  else document.addEventListener("DOMContentLoaded", process);

  // Add logging to track how often this runs
  const timestamp = new Date().toISOString();
  console.log(
    `%c👁️ Feed observer initialized at ${timestamp}`,
    "color: #9C27B0"
  );
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

  // Convert to Promise chain
  chrome.storage.sync
    .get(["displayOption", "extensionEnabled", "commentTimestamps"])
    .then((data) => {
      const displayOption = data.displayOption || "date";
      const extensionEnabled = data.extensionEnabled !== false;
      const commentTimestampsEnabled = data.commentTimestamps ?? true;

      if (extensionEnabled) {
        replaceRelativeTimes(displayOption);
        observeFeedContainer(displayOption);

        // Handle comment timestamps if enabled
        if (commentTimestampsEnabled) {
          // Start observing comments
          observeComments(displayOption);
        } else if (commentObserver) {
          // Stop observing if disabled
          commentObserver.disconnect();
          commentObserver = null;
        }

        // Add a delayed second pass to catch late-loading posts
        setTimeout(() => {
          handleMainFeedPosts(displayOption);
          // Only process comment timestamps if enabled
          if (commentTimestampsEnabled) {
            handleCommentTimestamps(displayOption);
          }
        }, 2000);

        setTimeout(() => {
          handleMainFeedPosts(displayOption);
          // Only process comment timestamps if enabled
          if (commentTimestampsEnabled) {
            handleCommentTimestamps(displayOption);
          }
        }, 5000);
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
      console.log("Storage access failed:", error);
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
    const { enabled, displayOption, commentTimestamps } = request;

    // Handle comment timestamps setting
    if (typeof commentTimestamps !== "undefined") {
      if (!commentTimestamps) {
        if (commentObserver) {
          commentObserver.disconnect();
          commentObserver = null;
        }
        revertCommentTimestamps();
      } else if (enabled) {
        observeComments(displayOption);
        handleCommentTimestamps(displayOption);
      }
    }

    handleExtensionToggle(enabled, displayOption);
  }
};

chrome.runtime.onMessage.addListener(messageListener);

// One-time storage listener at the top-level
chrome.storage.onChanged.addListener((changes, area) => {
  if (!isExtensionContextValid()) return;
  if (area === "sync") {
    // Rerun replacement after changes to update display formatting
    chrome.storage.sync
      .get(["displayOption", "extensionEnabled", "commentTimestamps"])
      .then((data) => {
        if (!isExtensionContextValid()) return;
        const displayOption = data.displayOption || "date";
        const extensionEnabled = data.extensionEnabled !== false;
        const commentTimestampsEnabled = data.commentTimestamps ?? true;

        if (extensionEnabled) {
          replaceRelativeTimes(displayOption);

          // Handle comment timestamps setting changes
          if (changes.commentTimestamps) {
            if (commentTimestampsEnabled) {
              // Re-apply comment timestamps if enabled
              observeComments(displayOption);
              handleCommentTimestamps(displayOption);
            } else {
              // Revert comment timestamps if disabled
              if (commentObserver) {
                commentObserver.disconnect();
                commentObserver = null;
              }
              revertCommentTimestamps();
            }
          }
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
        console.log("Storage access failed:", error);
      });
  }
});

// Function to monitor URL changes
function monitorUrlChanges() {
  console.log("%c🔄 URL change monitoring started", "color: #E91E63");

  let currentPath = window.location.pathname;

  const checkPathChange = () => {
    const newPath = window.location.pathname;
    if (newPath !== currentPath) {
      console.log(
        `%c📍 URL changed: ${currentPath} → ${newPath}`,
        "color: #E91E63"
      );
      currentPath = newPath;
      cleanupProcessedPosts();

      // Force reinitialization with multiple checks
      setTimeout(() => {
        initializeDateReplacement();
        replaceRelativeTimes();
      }, 300);

      setTimeout(initializeDateReplacement, 1000);
    }
  };

  // Existing history state monitoring...
}

// Clean up processed posts when navigating
function cleanupProcessedPosts() {
  PROCESSED_POSTS.clear();
}

// Run the replacement initially and set up observers
initializeDateReplacement();

// Start monitoring URL changes
monitorUrlChanges();

function handleCommentTimestamps(displayOption, rootNode = document) {
  console.log("%c🔍 Comment timestamp processing started", "color: #2196F3");

  // Convert to Promise chain
  chrome.storage.sync
    .get(["commentTimestamps"])
    .then((data) => {
      if (!data.commentTimestamps) {
        console.log("   Comment timestamps disabled, skipping");
        return;
      }

      const commentElements = rootNode.querySelectorAll(SELECTORS.comments);
      console.log(
        `   Found ${commentElements.length} comment elements to process`
      );

      let processedCount = 0;
      let skippedCount = 0;

      commentElements.forEach((commentElement) => {
        try {
          // Skip processing if already handled
          const dataId = commentElement.getAttribute("data-id");
          if (!dataId || PROCESSED_POSTS.has(dataId)) {
            skippedCount++;
            return;
          }

          // Extract the numeric part using regex
          const numericMatch = dataId.match(/(\d+)[^\d]*$/);
          const commentId = numericMatch ? numericMatch[1] : null;

          if (!commentId) {
            console.warn(`   Could not extract comment ID from: ${dataId}`);
            return;
          }

          const timestampMillis = decodeLinkedInTimestamp(commentId);
          if (!timestampMillis) {
            console.warn(
              `   Failed to decode timestamp for comment ID: ${commentId}`
            );
            return;
          }

          const timeElement = commentElement.querySelector(
            SELECTORS.commentTime
          );
          if (!timeElement) return;

          // Store original text if not already saved
          const originalText = timeElement.textContent.trim();
          if (!timeElement.hasAttribute("data-original-text")) {
            timeElement.setAttribute("data-original-text", originalText);
          }

          const formattedDate = formatDate(timestampMillis, displayOption);
          timeElement.textContent = `${formattedDate} • ${originalText}`;

          console.log(`   📝 Comment processed: ${dataId.substring(0, 15)}...`);
          console.log(`      Original: ${originalText}, New: ${formattedDate}`);

          processedCount++;
          PROCESSED_POSTS.add(dataId);
        } catch (err) {
          console.warn(`   Error processing comment:`, err);
        }
      });

      console.log(
        `%c🔍 Comment processing complete: ${processedCount} processed, ${skippedCount} skipped`,
        "color: #2196F3"
      );
    })
    .catch((error) => {
      console.error("Error in comment timestamp processing:", error);
    });
}

// Enhanced revert function
function revertCommentTimestamps(rootNode = document) {
  // Target ALL comment elements regardless of expansion state
  const commentElements = rootNode.querySelectorAll(
    "article.comments-comment-entity"
  );

  commentElements.forEach((commentElement) => {
    const dataId = commentElement.getAttribute("data-id");
    const timeElement = commentElement.querySelector(SELECTORS.commentTime);

    if (timeElement && timeElement.hasAttribute("data-original-text")) {
      // Restore original text and remove tracking
      timeElement.textContent = timeElement.getAttribute("data-original-text");
      if (dataId) {
        PROCESSED_POSTS.delete(dataId); // Remove from processed to allow reprocessing
      }
    }
  });
}

// Add manual refresh detection for LinkedIn logo click
document.addEventListener("click", (e) => {
  if (e.target.closest('a[href="/feed/"]')) {
    setTimeout(() => {
      PROCESSED_POSTS.clear();
      replaceRelativeTimes();
      handleMainFeedPosts(displayOption, document, true);
    }, 300);
  }
});

// Add periodic check as fallback (lightweight)
setInterval(() => {
  if (document.querySelector(SELECTORS.postElements) && !feedObserver) {
    initializeDateReplacement();
  }
}, 5000); // Check every 5 seconds

// Add a secondary observer for profile updates
const profileObserver = new MutationObserver(() => {
  if (window.location.pathname.includes("/in/")) {
    chrome.storage.sync.get(["displayOption", "dateFormat"], (data) => {
      const displayOption = data.displayOption || "date";
      handleMainFeedPosts(displayOption, document, true);
    });
  }
});

profileObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// Function to observe comments and apply timestamps
function observeComments(displayOption) {
  // Add logging to track comment observer initialization
  const timestamp = new Date().toISOString();
  console.log(
    `%c👁️ Comment observer initialized at ${timestamp}`,
    "color: #FF9800"
  );

  // Disconnect existing observer if any
  if (commentObserver) {
    commentObserver.disconnect();
  }

  // First, process any existing comments
  handleCommentTimestamps(displayOption);

  // Set up a mutation observer specifically for comments
  commentObserver = new MutationObserver((mutations) => {
    let shouldProcess = false;

    // Check if any mutations involve comments
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this node or its children contain comments
            if (
              node.querySelector("article.comments-comment-entity") ||
              node.closest("article.comments-comment-entity")
            ) {
              shouldProcess = true;
              break;
            }
          }
        }
      }
      if (shouldProcess) break;
    }

    // Process comments if needed
    if (shouldProcess) {
      handleCommentTimestamps(displayOption);
    }
  });

  // Start observing the entire document for comment changes
  commentObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
  });

  // Inside the mutation callback:
  const debouncedHandleComments = debounce(() => {
    console.log(
      `%c⚡ Comment mutation detected at ${new Date().toISOString()}`,
      "color: #FF9800"
    );
    handleCommentTimestamps(displayOption);
  }, 500);
}
