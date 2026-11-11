chrome.storage.sync.get(LinkedInDateSettings.STORAGE_KEYS, (storedData) => {
  const initialData = chrome.runtime.lastError ? {} : storedData || {};

  const {
    normalizeDateFormat,
    normalizeSeparatorStyle,
    normalizeTimezoneMode,
    formatAbsoluteDate,
    formatVisibleText,
    applySettingChanges,
    extractRelativeTimeParts,
    isRelativeTimeText,
    isTimestampConsistentWithRelativeText,
    getShortTimeZone,
    localeUses24Hour,
  } = LinkedInDateSettings;

  const {
    COMMENT_ROOT_SELECTOR,
    normalizeText,
    getNumericSnowflakeId,
    decodeLinkedInTimestamp,
    getScopedMatches,
    getPostCardKey,
    extractActivityUrnFromElement,
    extractCommentMetadataFromElement,
  } = LinkedInIds;

  const POST_SELECTORS = [
    '[data-id*="urn:li:activity"]',
    '[data-urn*="urn:li:activity"]',
    '[data-id*="urn:li:ugcPost"]',
    '[data-urn*="urn:li:ugcPost"]',
    '[data-activity-urn*="urn:li:activity"]',
    '[data-attributed-urn*="urn:li:activity"]',
    'a[href*="urn:li:activity"]',
    'a[href*="urn:li:ugcPost"]',
    'a[href*="/feed/update/"]',
    'a[href*="/posts/"]',
    '[data-view-name*="feed-full-update"]',
    '[data-view-name*="feed-mini-update"]',
    ".feed-shared-update-v2",
    ".profile-creator-shared-feed-update__container",
    ".org-update",
    ".org-update-card",
    '[data-view-name*="org-update"]',
  ].join(", ");
  const RELATIVE_TIME_SELECTOR = [
    '.update-components-actor__sub-description span[aria-hidden="true"]',
    '.feed-shared-actor__sub-description span[aria-hidden="true"]',
    ".comments-comment-meta__data",
    "time",
  ].join(", ");
  const VIEWPORT_PRELOAD_PX = 720;
  const STARTUP_RETRY_MS = [400, 1400, 3000];
  const EXPAND_CLICK_REGEX =
    /comment|repl(y|ies)|more comments|see more|load more|previous|activity|posts/i;

  const PAGE_LOADED_AT =
    Date.now() - (typeof performance !== "undefined" ? performance.now() : 0);

  const userLocale =
    navigator.language || navigator.languages?.[0] || "en-US";
  const shortTimeZone = getShortTimeZone(new Date(), userLocale);

  let isActive = false;
  let feedObserver = null;
  let timeElementIntersectionObserver = null;
  let timeElementIoQueued = new WeakSet();
  let scheduledTimeRescanId = 0;
  let scheduledTimeRescanKind = null;
  let pendingTimeRescanForce = false;
  let startupRetryIds = [];
  let navigationRetryId = 0;
  let feedClickRetryId = 0;
  const pendingTimeRescanRoots = new Set();
  let processedPosts = new WeakSet();
  let processedComments = new WeakSet();
  let formatterSettings = null;

  let userDateFormat = normalizeDateFormat(initialData.dateFormat);
  let separatorStyle = normalizeSeparatorStyle(initialData.separatorStyle);
  let timezoneMode = normalizeTimezoneMode(initialData.timezoneMode);
  let use24HourTime =
    initialData.use24HourTime !== undefined
      ? !!initialData.use24HourTime
      : localeUses24Hour(userLocale);
  let showTime = initialData.showTime !== false;

  function currentSettings() {
    return {
      dateFormat: userDateFormat,
      separatorStyle,
      timezoneMode,
      use24HourTime,
      showTime,
    };
  }

  function commitSettings(next) {
    userDateFormat = next.dateFormat;
    separatorStyle = next.separatorStyle;
    timezoneMode = next.timezoneMode;
    use24HourTime = next.use24HourTime;
    showTime = next.showTime;
    if (next.changed) syncFormatterSettings();
    return next.changed;
  }

  function syncFormatterSettings() {
    formatterSettings = {
      dateFormat: userDateFormat,
      timezoneMode,
      use24HourTime,
      showTime,
      locale: userLocale,
      shortTimeZone,
    };
  }

  function formatDate(timestampMillis) {
    if (!formatterSettings) syncFormatterSettings();
    return formatAbsoluteDate(new Date(timestampMillis), formatterSettings);
  }

  function clearProcessed() {
    processedPosts = new WeakSet();
    processedComments = new WeakSet();
  }

  function getCachedTimestamp(element) {
    const raw = element?.getAttribute?.("data-linkedin-ts");
    if (!raw) return null;
    const timestampMillis = Number(raw);
    return Number.isFinite(timestampMillis) && timestampMillis > 0
      ? timestampMillis
      : null;
  }

  function getCardIdentity(element) {
    return (
      getPostCardKey(element) ||
      element.closest?.("[data-id]")?.getAttribute("data-id") ||
      element.closest?.("[data-urn]")?.getAttribute("data-urn") ||
      ""
    );
  }

  function cachedTimestampIsValid(element) {
    const timestampMillis = getCachedTimestamp(element);
    if (!timestampMillis || !element.hasAttribute("data-original-text")) {
      return null;
    }

    const storedKey = element.getAttribute("data-linkedin-card-key") || "";
    const currentKey = getCardIdentity(element);
    if (storedKey && currentKey && storedKey !== currentKey) {
      [
        "data-linkedin-ts",
        "data-linkedin-activity-urn",
        "data-linkedin-comment-id",
        "data-linkedin-card-key",
        "data-original-text",
      ].forEach((name) => element.removeAttribute(name));
      return null;
    }

    return timestampMillis;
  }

  function cacheTimestamp(element, timestampMillis) {
    element.setAttribute?.("data-linkedin-ts", String(timestampMillis));
    const cardKey = getCardIdentity(element);
    if (cardKey) {
      element.setAttribute?.("data-linkedin-card-key", cardKey);
    }
  }

  function getMainContentRoot() {
    return (
      document.querySelector(
        ".scaffold-layout__main, main, [role='main']",
      ) || document.body
    );
  }

  function normalizeRescanRoot(rootNode) {
    if (
      !rootNode ||
      rootNode === document ||
      rootNode.nodeType !== Node.ELEMENT_NODE
    ) {
      return getMainContentRoot();
    }
    return rootNode.isConnected ? rootNode : null;
  }

  function isIgnorableTimeContext(node) {
    const element =
      node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return !!element?.closest?.(
      "aside, footer, nav, [role='complementary'], [role='navigation'], .scaffold-layout__aside, .msg-overlay-list-bubble, .msg-overlay-conversation-bubble",
    );
  }

  function getPrimaryTimeTextNode(element) {
    if (!element) return null;
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && normalizeText(node.textContent)) {
        return node;
      }
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (normalizeText(node.textContent)) return node;
    }
    return null;
  }

  function getOriginalTimeText(timeElement) {
    return (
      timeElement.getAttribute("data-original-text") ||
      getPrimaryTimeTextNode(timeElement)?.textContent ||
      timeElement.textContent
    );
  }

  function findRelativeTimeElements(rootNode = document) {
    const searchRoot =
      rootNode?.nodeType === Node.DOCUMENT_NODE
        ? rootNode.body || document.body
        : rootNode;

    if (!searchRoot || !document.body?.contains(searchRoot)) return [];

    const walker = document.createTreeWalker(
      searchRoot,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (isIgnorableTimeContext(node)) return NodeFilter.FILTER_SKIP;
          return isRelativeTimeText(normalizeText(node.textContent))
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      },
    );

    const results = [];
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);
      results.push(parent);
    }
    return results;
  }

  // Includes timestamps already rewritten (their text no longer looks relative).
  function findTimeElementsIn(rootNode) {
    const found = new Set(findRelativeTimeElements(rootNode));
    rootNode
      ?.querySelectorAll?.("[data-original-text]")
      .forEach((element) => found.add(element));
    return Array.from(found);
  }

  // Never show a date that contradicts LinkedIn's own "2d"/"3w" label.
  function matchesLinkedInLabel(originalText, timestampMillis) {
    const pageLanguage = document.documentElement?.lang || "en";
    if (!/^en\b/i.test(pageLanguage)) return true;
    return isTimestampConsistentWithRelativeText(originalText, timestampMillis, {
      now: Date.now(),
      labelRenderedAfter: PAGE_LOADED_AT,
    });
  }

  function processPostTimeElement(timeElement, force = false) {
    if (!isActive || !timeElement) return;

    if (
      !force &&
      processedPosts.has(timeElement) &&
      cachedTimestampIsValid(timeElement)
    ) {
      return;
    }

    const cachedTimestamp = cachedTimestampIsValid(timeElement);
    if (
      cachedTimestamp &&
      !timeElement.hasAttribute("data-linkedin-comment-id")
    ) {
      updateTimeElement(timeElement, cachedTimestamp);
      processedPosts.add(timeElement);
      return;
    }

    if (extractCommentMetadataFromElement(timeElement)?.commentId) return;

    const originalText = getOriginalTimeText(timeElement);
    if (!isRelativeTimeText(originalText)) return;

    const activityUrn = extractActivityUrnFromElement(timeElement, {
      findTimeElements: findTimeElementsIn,
    });
    if (!activityUrn) return;

    const timestampMillis = decodeLinkedInTimestamp(
      getNumericSnowflakeId(activityUrn),
    );
    if (!timestampMillis) return;
    if (!matchesLinkedInLabel(originalText, timestampMillis)) return;

    cacheTimestamp(timeElement, timestampMillis);
    updateTimeElement(timeElement, timestampMillis);
    processedPosts.add(timeElement);
  }

  function processCommentTimeElement(timeElement, force = false) {
    if (!isActive || !timeElement) return false;

    const validCache = cachedTimestampIsValid(timeElement);
    if (!force && processedComments.has(timeElement) && validCache) return true;
    if (!force && processedPosts.has(timeElement) && validCache) return true;

    if (
      validCache &&
      timeElement.hasAttribute("data-linkedin-comment-id")
    ) {
      updateTimeElement(timeElement, validCache);
      processedComments.add(timeElement);
      return true;
    }

    const originalText = getOriginalTimeText(timeElement);
    if (!isRelativeTimeText(originalText)) return false;

    const commentMetadata = extractCommentMetadataFromElement(timeElement);
    const commentId = commentMetadata?.commentId;
    if (!commentId) return false;

    const timestampMillis = decodeLinkedInTimestamp(commentId);
    if (!timestampMillis) return false;
    if (!matchesLinkedInLabel(originalText, timestampMillis)) return false;

    cacheTimestamp(timeElement, timestampMillis);
    updateTimeElement(timeElement, timestampMillis);

    if (commentMetadata.activityUrn) {
      timeElement.setAttribute(
        "data-linkedin-activity-urn",
        commentMetadata.activityUrn,
      );
    }
    timeElement.setAttribute("data-linkedin-comment-id", commentId);
    processedComments.add(timeElement);
    return true;
  }

  function rewriteTimeElement(timeElement, force = false) {
    if (!processCommentTimeElement(timeElement, force)) {
      processPostTimeElement(timeElement, force);
    }
  }

  function isNodeInPreloadViewport(el) {
    if (!el?.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const margin = VIEWPORT_PRELOAD_PX;
    return rect.top < window.innerHeight + margin && rect.bottom > -margin;
  }

  function resetTimeElementIntersectionObserver() {
    timeElementIntersectionObserver?.disconnect();
    timeElementIntersectionObserver = null;
    timeElementIoQueued = new WeakSet();
  }

  function getTimeElementIntersectionObserver() {
    if (timeElementIntersectionObserver) return timeElementIntersectionObserver;
    timeElementIntersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          if (!(el instanceof Element)) continue;
          timeElementIntersectionObserver.unobserve(el);
          timeElementIoQueued.delete(el);
          if (isActive && el.isConnected) rewriteTimeElement(el, false);
        }
      },
      {
        root: null,
        rootMargin: `${VIEWPORT_PRELOAD_PX}px 0px ${VIEWPORT_PRELOAD_PX}px 0px`,
        threshold: 0,
      },
    );
    return timeElementIntersectionObserver;
  }

  function scheduleOrRunTimeElementPrewrite(timeElement, force = false) {
    if (!isActive || !timeElement) return;
    if (
      !force &&
      (processedPosts.has(timeElement) ||
        processedComments.has(timeElement)) &&
      cachedTimestampIsValid(timeElement)
    ) {
      return;
    }
    if (force || isNodeInPreloadViewport(timeElement)) {
      rewriteTimeElement(timeElement, force);
      return;
    }
    if (timeElementIoQueued.has(timeElement)) return;
    timeElementIoQueued.add(timeElement);
    getTimeElementIntersectionObserver().observe(timeElement);
  }

  function collectTimeCandidates(rootNode, force) {
    const seen = new Set();
    const candidates = [];

    const add = (element) => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      candidates.push(element);
    };

    findRelativeTimeElements(rootNode).forEach(add);

    if (force) {
      getScopedMatches(rootNode, "[data-original-text]").forEach(add);
    }

    if (candidates.length === 0) {
      getScopedMatches(rootNode, POST_SELECTORS).forEach((post) => {
        add(post.querySelector(RELATIVE_TIME_SELECTOR));
      });
    }

    return candidates;
  }

  function handleTimeElements(rootNode = document, force = false) {
    if (!isActive || !rootNode) return;
    collectTimeCandidates(rootNode, force).forEach((timeElement) => {
      scheduleOrRunTimeElementPrewrite(timeElement, force);
    });
  }

  const hoverDateByElement = new WeakMap();
  const HOVER_HIT_PAD = 6;

  function rememberHoverDate(element, formattedDate) {
    hoverDateByElement.set(element, formattedDate);
    element.setAttribute("data-linkedin-hover-date", formattedDate);
  }

  function clearHoverDate(element) {
    hoverDateByElement.delete(element);
    element.removeAttribute?.("data-linkedin-hover-date");
  }

  function hoverTextFrom(node) {
    if (!node) return null;
    return (
      hoverDateByElement.get(node) ||
      node.getAttribute?.("data-linkedin-hover-date") ||
      (node.getAttribute?.("data-linkedin-ts")
        ? formatDate(Number(node.getAttribute("data-linkedin-ts")))
        : null)
    );
  }

  function isPointerOverElement(element, clientX, clientY) {
    let rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      const parent = element.parentElement;
      if (!parent) return false;
      rect = parent.getBoundingClientRect();
      if (rect.height > 40 || rect.width > 400) return false;
    }
    return (
      clientX >= rect.left - HOVER_HIT_PAD &&
      clientX <= rect.right + HOVER_HIT_PAD &&
      clientY >= rect.top - HOVER_HIT_PAD &&
      clientY <= rect.bottom + HOVER_HIT_PAD
    );
  }

  function findHoverInfo(_start, clientX, clientY) {
    const root = getMainContentRoot() || document.body;
    if (!root?.querySelectorAll) return null;
    const marked = root.querySelectorAll(
      "[data-linkedin-hover-date], [data-original-text][data-linkedin-ts]",
    );
    for (const el of marked) {
      const text = hoverTextFrom(el);
      if (text && isPointerOverElement(el, clientX, clientY)) {
        return { text, host: el };
      }
    }
    return null;
  }

  let hoverTooltipHost = null;
  let hoverTooltipEl = null;

  function hideHoverTooltip() {
    if (hoverTooltipHost) hoverTooltipHost.style.display = "none";
  }

  function showHoverTooltip(text, clientX, clientY) {
    if (!hoverTooltipHost?.isConnected) {
      hoverTooltipHost = document.createElement("div");
      hoverTooltipHost.setAttribute("data-linkedin-dates-tooltip", "true");
      Object.assign(hoverTooltipHost.style, {
        all: "initial",
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        display: "none",
      });
      const shadow = hoverTooltipHost.attachShadow({ mode: "closed" });
      hoverTooltipEl = document.createElement("div");
      hoverTooltipEl.setAttribute("role", "tooltip");
      Object.assign(hoverTooltipEl.style, {
        maxWidth: "260px",
        padding: "6px 8px",
        borderRadius: "6px",
        background: "#1e1e1e",
        color: "#e8e8e8",
        font: "12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
        whiteSpace: "nowrap",
      });
      shadow.appendChild(hoverTooltipEl);
      document.documentElement.appendChild(hoverTooltipHost);
    }

    hoverTooltipEl.textContent = text;
    hoverTooltipHost.style.display = "block";
    const tipWidth = hoverTooltipEl.offsetWidth || 160;
    const tipHeight = hoverTooltipEl.offsetHeight || 28;
    let top = clientY + 18;
    let left = clientX + 12;
    if (top + tipHeight > window.innerHeight - 8) top = clientY - tipHeight - 12;
    if (left + tipWidth > window.innerWidth - 8) {
      left = window.innerWidth - tipWidth - 8;
    }
    hoverTooltipHost.style.top = `${Math.max(8, top)}px`;
    hoverTooltipHost.style.left = `${Math.max(8, left)}px`;
  }

  function removeHoverTooltip() {
    hideHoverTooltip();
    hoverTooltipHost?.remove();
    hoverTooltipHost = null;
    hoverTooltipEl = null;
  }

  function updateTimeElement(element, timestampMillis) {
    const timeNode = getPrimaryTimeTextNode(element);
    let originalText;
    if (element.hasAttribute("data-original-text")) {
      originalText = element.getAttribute("data-original-text");
    } else {
      originalText = normalizeText(
        timeNode?.textContent || element.textContent,
      );
      element.setAttribute("data-original-text", originalText);
    }

    const formattedDate = formatDate(timestampMillis);
    const relativeParts = extractRelativeTimeParts(originalText);
    const visibleText = formatVisibleText({
      absoluteDate: formattedDate,
      relativeText: relativeParts?.token || originalText,
      metadataSuffix: relativeParts?.suffix || "",
      separatorStyle,
      originalText,
    });

    if (separatorStyle === "hover") {
      rememberHoverDate(element, formattedDate);
    } else {
      clearHoverDate(element);
    }

    if (timeNode) {
      timeNode.textContent = visibleText;
    } else {
      element.insertBefore(
        document.createTextNode(visibleText),
        element.firstChild,
      );
    }
  }

  function scheduleTimeRescan(rootNode = document, force = false) {
    if (!isActive) return;
    const normalizedRoot = normalizeRescanRoot(rootNode);
    if (!normalizedRoot) return;
    pendingTimeRescanForce = pendingTimeRescanForce || force;
    pendingTimeRescanRoots.add(normalizedRoot);

    if (scheduledTimeRescanId) {
      if (!force || scheduledTimeRescanKind !== "idle") return;
      window.cancelIdleCallback?.(scheduledTimeRescanId);
      scheduledTimeRescanId = 0;
      scheduledTimeRescanKind = null;
    }

    const runScan = () => {
      scheduledTimeRescanId = 0;
      scheduledTimeRescanKind = null;
      const shouldForce = pendingTimeRescanForce;
      pendingTimeRescanForce = false;

      const roots = Array.from(pendingTimeRescanRoots);
      pendingTimeRescanRoots.clear();
      if (roots.length === 0) return;

      const mainRoot = getMainContentRoot();
      if (roots.length > 4 || roots.includes(mainRoot)) {
        handleTimeElements(mainRoot, shouldForce);
        return;
      }

      roots.forEach((root) => handleTimeElements(root, shouldForce));
    };

    if (force || !window.requestIdleCallback) {
      scheduledTimeRescanKind = "frame";
      scheduledTimeRescanId = requestAnimationFrame(runScan);
    } else {
      scheduledTimeRescanKind = "idle";
      scheduledTimeRescanId = window.requestIdleCallback(runScan, {
        timeout: 1200,
      });
    }
  }

  function observeFeedContainer() {
    feedObserver?.disconnect();
    if (!document.body) return;

    feedObserver = new MutationObserver((mutations) => {
      checkNavigation();
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scheduleTimeRescan(node);
          } else if (
            node.nodeType === Node.TEXT_NODE &&
            isRelativeTimeText(normalizeText(node.textContent))
          ) {
            scheduleTimeRescan(node.parentElement || getMainContentRoot());
          }
        }
      }
    });
    feedObserver.observe(document.body, { childList: true, subtree: true });
  }

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

  function initializeDateReplacement() {
    if (!isExtensionContextValid() || !isActive) return;
    resetTimeElementIntersectionObserver();
    observeFeedContainer();
    rerenderAllTimes();
    startupRetryIds.forEach(clearTimeout);
    startupRetryIds = STARTUP_RETRY_MS.map((delay) =>
      setTimeout(() => {
        if (isActive) rerenderAllTimes();
      }, delay),
    );
  }

  function cleanup() {
    feedObserver?.disconnect();
    feedObserver = null;

    if (scheduledTimeRescanId) {
      if (scheduledTimeRescanKind === "idle") {
        window.cancelIdleCallback?.(scheduledTimeRescanId);
      } else {
        cancelAnimationFrame(scheduledTimeRescanId);
      }
      scheduledTimeRescanId = 0;
      scheduledTimeRescanKind = null;
    }
    pendingTimeRescanForce = false;
    pendingTimeRescanRoots.clear();
    resetTimeElementIntersectionObserver();
    removeHoverTooltip();
    startupRetryIds.forEach(clearTimeout);
    startupRetryIds = [];
    clearTimeout(navigationRetryId);
    clearTimeout(feedClickRetryId);
    clearProcessed();
  }

  function restoreOriginalTimes() {
    document.querySelectorAll("[data-original-text]").forEach((element) => {
      const originalText = element.getAttribute("data-original-text");
      const timeNode = getPrimaryTimeTextNode(element);
      if (timeNode) {
        timeNode.textContent = originalText;
      } else {
        element.insertBefore(
          document.createTextNode(originalText),
          element.firstChild,
        );
      }
      element.removeAttribute("data-original-text");
      clearHoverDate(element);
    });
    document.querySelectorAll("[data-linkedin-hover-date]").forEach(clearHoverDate);
  }

  function rerenderAllTimes() {
    clearProcessed();
    resetTimeElementIntersectionObserver();
    hideHoverTooltip();
    handleTimeElements(getMainContentRoot(), true);
  }

  function applyIncomingSettings(changes) {
    return commitSettings(applySettingChanges(currentSettings(), changes));
  }

  function startExtension() {
    syncFormatterSettings();
    if (isActive) {
      rerenderAllTimes();
      return;
    }
    isActive = true;
    initializeDateReplacement();
  }

  function stopExtension() {
    isActive = false;
    cleanup();
    restoreOriginalTimes();
  }

  function handleExtensionToggle(enabled) {
    if (enabled) startExtension();
    else stopExtension();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionContextValid() || area !== "sync") return;

    if (changes.extensionEnabled) {
      handleExtensionToggle(changes.extensionEnabled.newValue !== false);
      if (changes.extensionEnabled.newValue === false) return;
    }

    if (applyIncomingSettings(changes) && isActive) {
      rerenderAllTimes();
    }
  });

  // LinkedIn navigates without reloading. A content script cannot see the
  // page's own history.pushState calls, so the URL is compared whenever the
  // page changes (see observeFeedContainer) and on back/forward.
  let currentHref = window.location.href;
  function checkNavigation() {
    const nextHref = window.location.href;
    if (nextHref === currentHref) return;
    currentHref = nextHref;
    clearProcessed();
    if (!isActive) return;
    clearTimeout(navigationRetryId);
    navigationRetryId = setTimeout(() => {
      if (isActive) initializeDateReplacement();
    }, 500);
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!isActive || separatorStyle !== "hover") {
        hideHoverTooltip();
        return;
      }
      const info = findHoverInfo(event.target, event.clientX, event.clientY);
      if (!info) {
        hideHoverTooltip();
        return;
      }
      showHoverTooltip(info.text, event.clientX, event.clientY);
    },
    true,
  );
  window.addEventListener("scroll", hideHoverTooltip, true);

  document.addEventListener(
    "click",
    (event) => {
      if (!isActive) return;
      if (event.target.closest('a[href="/feed/"]')) {
        clearTimeout(feedClickRetryId);
        feedClickRetryId = setTimeout(() => {
          if (isActive) rerenderAllTimes();
        }, 500);
        return;
      }
      const commentRoot = event.target.closest(COMMENT_ROOT_SELECTOR);
      if (commentRoot) {
        scheduleTimeRescan(commentRoot);
        return;
      }

      const expandTarget = event.target.closest(
        'button, [role="button"], a, [aria-expanded]',
      );
      if (!expandTarget) return;
      const label = `${expandTarget.textContent || ""} ${
        expandTarget.getAttribute("aria-label") || ""
      }`;
      if (!EXPAND_CLICK_REGEX.test(label)) return;
      clearTimeout(feedClickRetryId);
      feedClickRetryId = setTimeout(() => {
        if (isActive) scheduleTimeRescan(getMainContentRoot());
      }, 400);
    },
    true,
  );

  if (initialData.extensionEnabled !== false) {
    startExtension();
  }
  window.addEventListener("popstate", checkNavigation);
});
