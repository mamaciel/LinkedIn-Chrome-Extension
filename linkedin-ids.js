(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LinkedInIds = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ANCESTOR_SCAN_MAX_DEPTH = 24;
  const PROTO_SNOWFLAKE_TOKEN_REGEX = /[CEGI]gsI[A-Za-z0-9+/]{10,28}/g;
  const PROTO_SNOWFLAKE_MIN_TS = Date.UTC(2012, 0, 1);
  const CACHE_LIMIT = 500;

  const COMMENT_ROOT_SELECTOR = [
    "article.comments-comment-entity",
    ".comments-comment-entity",
    ".comments-comment-item",
    ".comments-reply-item",
    '[data-id*="comment"]',
    '[data-urn*="comment"]',
    '[data-id*="fsd_comment"]',
    '[data-urn*="fsd_comment"]',
    '[componentkey*="replaceableComment_urn:li:comment"]',
    '[componentkey*="replaceableComment_urn:li:fsd_comment"]',
    '[data-view-name*="comment"]',
  ].join(", ");

  const POST_ROOT_SELECTOR = [
    '[role="listitem"]',
    '[componentkey*="FeedType_"]',
    '[data-id*="urn:li:activity"]',
    '[data-urn*="urn:li:activity"]',
    '[data-id*="urn:li:ugcPost"]',
    '[data-urn*="urn:li:ugcPost"]',
    '[data-id*="urn:li:share"]',
    '[data-urn*="urn:li:share"]',
    '[data-view-name*="feed-full-update"]',
    '[data-view-name*="feed-mini-update"]',
    ".feed-shared-update-v2",
    ".profile-creator-shared-feed-update__container",
    ".update-components-update",
    ".org-update",
    ".org-update-card",
    '[data-view-name*="org-update"]',
  ].join(", ");

  function createBoundedMap(maxSize) {
    const map = new Map();
    return {
      get: (key) => map.get(key),
      has: (key) => map.has(key),
      set(key, value) {
        if (map.has(key)) map.delete(key);
        map.set(key, value);
        if (map.size > maxSize) {
          map.delete(map.keys().next().value);
        }
      },
    };
  }

  const timestampById = createBoundedMap(CACHE_LIMIT);
  const protoUrnCache = createBoundedMap(CACHE_LIMIT);

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function getNumericSnowflakeId(urnOrId) {
    if (!urnOrId) return "";
    return String(urnOrId).split(":").pop().replace(/\D/g, "");
  }

  function decodeLinkedInTimestamp(postID) {
    const cleanID = getNumericSnowflakeId(postID);
    if (!cleanID) return null;

    const cached = timestampById.get(cleanID);
    if (cached) return cached;

    try {
      const timestampMillis = Number(BigInt(cleanID) >> 22n);
      if (!timestampMillis) return null;
      timestampById.set(cleanID, timestampMillis);
      return timestampMillis;
    } catch (error) {
      return null;
    }
  }

  function getScopedMatches(rootNode, selector) {
    if (!rootNode) return [];

    const matches = [];
    if (
      rootNode.nodeType === Node.ELEMENT_NODE &&
      rootNode.matches(selector)
    ) {
      matches.push(rootNode);
    }

    if (rootNode.querySelectorAll) {
      matches.push(...rootNode.querySelectorAll(selector));
    }

    return matches;
  }

  function collectElementCandidateStrings(
    element,
    { includeDescendants = false, descendantScope = null } = {},
  ) {
    const values = [];
    const seen = new Set();
    const scannedDescendantRoots = new Set();

    const pushValue = (value) => {
      const normalized = normalizeText(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      values.push(normalized);
    };

    const addElementValues = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      for (const attribute of node.attributes || []) {
        pushValue(attribute.value);
      }
      if (node.href) pushValue(node.href);
    };

    let current = element;
    let depth = 0;
    while (current && depth < ANCESTOR_SCAN_MAX_DEPTH) {
      addElementValues(current);

      // Scanning descendants of ancestors above the post card would pick up
      // IDs from sibling cards (e.g. every card on the Reactions tab got the
      // first post link anywhere in the list).
      const withinScope =
        !descendantScope || descendantScope.contains(current);
      if (
        includeDescendants &&
        withinScope &&
        current.querySelectorAll &&
        !scannedDescendantRoots.has(current)
      ) {
        scannedDescendantRoots.add(current);
        current
          .querySelectorAll(
            "a[href], [id], [data-id], [data-urn], [data-activity-urn], [data-attributed-urn], [data-testid], [componentkey]",
          )
          .forEach(addElementValues);
      }

      current = current.parentElement;
      depth += 1;
    }

    return values;
  }

  function extractActivityUrnFromString(value) {
    if (!value) return null;

    const decodedValue = safeDecodeURIComponent(String(value));
    const directMatch = decodedValue.match(/urn:li:activity:(\d+)/i);
    if (directMatch) return `urn:li:activity:${directMatch[1]}`;

    const postsMatch = decodedValue.match(
      /(?:[-_]|%2D)activity(?:[-_]|%2D)(\d+)/i,
    );
    return postsMatch ? `urn:li:activity:${postsMatch[1]}` : null;
  }

  function extractShareUrnFromString(value) {
    if (!value) return null;
    const decodedValue = safeDecodeURIComponent(String(value));
    const match = decodedValue.match(/urn:li:share:(\d+)/i);
    return match ? `urn:li:share:${match[1]}` : null;
  }

  function extractUgcPostUrnFromString(value) {
    if (!value) return null;
    const decodedValue = safeDecodeURIComponent(String(value));
    const match = decodedValue.match(/urn:li:ugcPost:(\d+)/i);
    return match ? `urn:li:ugcPost:${match[1]}` : null;
  }

  function decodeBase64UrlBytes(value) {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const pad =
      normalized.length % 4 === 0
        ? ""
        : "=".repeat(4 - (normalized.length % 4));
    try {
      const binary = atob(normalized + pad);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (error) {
      return null;
    }
  }

  function readProtobufVarint(bytes, start) {
    let value = 0n;
    let shift = 0n;
    let index = start;
    while (index < bytes.length) {
      const byte = BigInt(bytes[index]);
      index += 1;
      value |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) {
        return { value, index };
      }
      shift += 7n;
      if (shift > 70n) break;
    }
    return null;
  }

  function zigzagDecode(value) {
    return (value >> 1n) ^ -(value & 1n);
  }

  function snowflakeIdToUrn(id, outerField) {
    if (outerField === 2) return `urn:li:ugcPost:${id}`;
    if (outerField === 3) return `urn:li:share:${id}`;
    return `urn:li:activity:${id}`;
  }

  function isPlausibleLinkedInSnowflake(id) {
    const timestampMillis = Number(id >> 22n);
    return (
      Number.isFinite(timestampMillis) &&
      timestampMillis >= PROTO_SNOWFLAKE_MIN_TS &&
      timestampMillis <= Date.now() + 2 * 24 * 60 * 60 * 1000
    );
  }

  function decodeLinkedInProtoSnowflakeTokenUncached(token) {
    const bytes = decodeBase64UrlBytes(token);
    if (!bytes || bytes.length < 3) return null;

    const outerTag = readProtobufVarint(bytes, 0);
    if (!outerTag || Number(outerTag.value & 7n) !== 2) return null;

    const outerField = Number(outerTag.value >> 3n);
    const outerLength = readProtobufVarint(bytes, outerTag.index);
    if (!outerLength) return null;

    const innerStart = outerLength.index;
    const innerEnd = innerStart + Number(outerLength.value);
    if (innerEnd > bytes.length) return null;

    const innerTag = readProtobufVarint(bytes, innerStart);
    if (!innerTag || Number(innerTag.value & 7n) !== 0) return null;

    const innerValue = readProtobufVarint(bytes, innerTag.index);
    if (!innerValue || innerValue.index > innerEnd) return null;

    const snowflakeId = zigzagDecode(innerValue.value);
    if (snowflakeId <= 0n || !isPlausibleLinkedInSnowflake(snowflakeId)) {
      return null;
    }

    return snowflakeIdToUrn(snowflakeId.toString(), outerField);
  }

  function decodeLinkedInProtoSnowflakeToken(token) {
    if (protoUrnCache.has(token)) return protoUrnCache.get(token);
    const urn = decodeLinkedInProtoSnowflakeTokenUncached(token);
    protoUrnCache.set(token, urn);
    return urn;
  }

  function extractEncodedUrnFromString(value) {
    if (!value) return null;
    const matches = String(value).match(PROTO_SNOWFLAKE_TOKEN_REGEX);
    if (!matches) return null;

    for (const token of matches) {
      const urn = decodeLinkedInProtoSnowflakeToken(token);
      if (urn) return urn;
    }
    return null;
  }

  function getContainingPostRoot(element) {
    return element?.closest?.(POST_ROOT_SELECTOR) || null;
  }

  function getPostCardKey(element) {
    const raw =
      getContainingPostRoot(element)?.getAttribute?.("componentkey") || "";
    if (!raw) return "";
    const feedTypeIndex = raw.indexOf("FeedType_");
    const withoutFeedType =
      feedTypeIndex === -1 ? raw : raw.slice(0, feedTypeIndex);
    return withoutFeedType.replace(/^(?:expanded|update-card-focus)/i, "");
  }

  function extractPostUrnFromAncestorAttributes(element) {
    let activityUrn = null;
    let shareUrn = null;
    let ugcUrn = null;
    let encodedUrn = null;
    let current = element;
    let depth = 0;

    while (current && depth < ANCESTOR_SCAN_MAX_DEPTH) {
      for (const attribute of current.attributes || []) {
        const value = attribute.value;
        if (!activityUrn) activityUrn = extractActivityUrnFromString(value);
        if (!shareUrn) shareUrn = extractShareUrnFromString(value);
        if (!ugcUrn) ugcUrn = extractUgcPostUrnFromString(value);
        if (!encodedUrn) encodedUrn = extractEncodedUrnFromString(value);
        if (activityUrn) return activityUrn;
      }
      current = current.parentElement;
      depth += 1;
    }

    return activityUrn || shareUrn || ugcUrn || encodedUrn;
  }

  function extractEncodedUrnFromNearbyDom(element) {
    const root =
      getContainingPostRoot(element) ||
      element.closest?.("[role='listitem']") ||
      element;
    if (!root) return null;

    const cardKey = getPostCardKey(element);
    const candidates = [];

    const consider = (value, priority) => {
      const matches = String(value).match(PROTO_SNOWFLAKE_TOKEN_REGEX);
      if (!matches) return;
      matches.forEach((token) => {
        const urn = decodeLinkedInProtoSnowflakeToken(token);
        if (urn) candidates.push({ urn, priority });
      });
    };

    const scoreValue = (value) => {
      let priority = 0;
      if (/replaceableCommentTools|commentList|commentBox/i.test(value)) {
        priority += 2;
      }
      if (cardKey && value.includes(cardKey)) priority += 3;
      return priority;
    };

    const rootKey = root.getAttribute?.("componentkey") || "";
    consider(rootKey, scoreValue(rootKey) + 1);

    if (root.querySelectorAll) {
      root
        .querySelectorAll(
          "[componentkey], [id], [data-testid], [data-id], [data-urn]",
        )
        .forEach((node) => {
          for (const attribute of node.attributes || []) {
            consider(attribute.value, scoreValue(attribute.value) + 1);
          }
        });
    }

    if (candidates.length === 0) return null;
    candidates.sort((left, right) => right.priority - left.priority);
    const topPriority = candidates[0].priority;
    const topTier = candidates.filter(
      (candidate) => candidate.priority === topPriority,
    );
    return (
      topTier.find((candidate) =>
        candidate.urn.startsWith("urn:li:activity:"),
      )?.urn || topTier[0].urn
    );
  }

  function entityUrn(entityType, id) {
    const type = String(entityType || "").toLowerCase();
    if (type === "ugcpost") return `urn:li:ugcPost:${id}`;
    if (type === "share") return `urn:li:share:${id}`;
    return `urn:li:activity:${id}`;
  }

  function extractCommentMetadataFromString(value) {
    if (!value) return null;

    const decodedValue = safeDecodeURIComponent(String(value));
    const patterns = [
      [
        /urn:li:fsd_comment:\((\d+),\s*urn:li:(activity|ugcPost|share):(\d+)\)/i,
        (match) => ({
          commentId: match[1],
          activityUrn: entityUrn(match[2], match[3]),
        }),
      ],
      [
        /urn:li:comment:\(urn:li:activity:(\d+),\s*(\d+)\)/i,
        (match) => ({
          commentId: match[2],
          activityUrn: `urn:li:activity:${match[1]}`,
        }),
      ],
      [
        /urn:li:commentary:\(urn:li:activity:(\d+),\s*(\d+)\)/i,
        (match) => ({
          commentId: match[2],
          activityUrn: `urn:li:activity:${match[1]}`,
        }),
      ],
      [
        /urn:li:comment:\((?:urn:li:)?(activity|ugcPost|share):(\d+),\s*(\d+)\)/i,
        (match) => ({
          commentId: match[3],
          activityUrn: entityUrn(match[1], match[2]),
        }),
      ],
      [
        /urn:li:comment:\((\d+),\s*(\d+)\)/i,
        (match) => ({
          commentId: match[2],
          activityUrn: `urn:li:activity:${match[1]}`,
        }),
      ],
    ];

    for (const [pattern, toMetadata] of patterns) {
      const match = decodedValue.match(pattern);
      if (match) return toMetadata(match);
    }
    return null;
  }

  function extractCommentMetadataFromAncestorAttributes(element) {
    let current = element;
    let depth = 0;
    while (current && depth < ANCESTOR_SCAN_MAX_DEPTH) {
      for (const attribute of current.attributes || []) {
        const metadata = extractCommentMetadataFromString(attribute.value);
        if (metadata?.commentId) return metadata;
      }
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function extractActivityUrnFromExpandedCommentRoots(element) {
    const postRoot = getContainingPostRoot(element);
    if (!postRoot) return null;

    for (const commentRoot of getScopedMatches(
      postRoot,
      COMMENT_ROOT_SELECTOR,
    )) {
      for (const attribute of commentRoot.attributes || []) {
        const metadata = extractCommentMetadataFromString(attribute.value);
        if (metadata?.activityUrn) return metadata.activityUrn;
      }
    }
    return null;
  }

  const POST_LINK_SELECTOR = [
    'a[href*="urn:li:activity"]',
    'a[href*="urn:li:ugcPost"]',
    'a[href*="urn:li:share"]',
    'a[href*="activity-"]',
  ].join(", ");

  function extractPostUrnFromHref(href) {
    return (
      extractActivityUrnFromString(href) ||
      extractShareUrnFromString(href) ||
      extractUgcPostUrnFromString(href)
    );
  }

  // The card's own comment box is keyed "<token>-replaceableCommentTools<cardKey>",
  // where <token> encodes the ID of the post this card is about.
  function extractCardOwnEncodedUrn(postRoot, cardKey) {
    if (!cardKey || !postRoot?.querySelectorAll) return null;
    for (const node of postRoot.querySelectorAll(
      '[componentkey*="replaceableCommentTools"]',
    )) {
      const key = node.getAttribute("componentkey") || "";
      if (!key.includes(cardKey)) continue;
      const urn = extractEncodedUrnFromString(key);
      if (urn) return urn;
    }
    return null;
  }

  // Resolves a post timestamp using only IDs inside its own card. A post link
  // only counts for this timestamp when no other timestamp sits closer to it,
  // so a reshare's outer time and its embedded original each get their own ID.
  function extractCardScopedPostUrn(
    element,
    postRoot,
    findTimeElements,
    { tokenOnly = false } = {},
  ) {
    const cardUrn = extractCardOwnEncodedUrn(postRoot, getPostCardKey(element));
    if (tokenOnly || typeof findTimeElements !== "function") return cardUrn;

    const isSameTime = (other) =>
      other === element || other.contains(element) || element.contains(other);
    const otherPostTimesIn = (root) =>
      findTimeElements(root).filter(
        (other) => !isSameTime(other) && !other.closest?.(COMMENT_ROOT_SELECTOR),
      );
    const otherCardTimes = otherPostTimesIn(postRoot);
    const cardTimestamp = cardUrn ? decodeLinkedInTimestamp(cardUrn) : null;

    for (const link of postRoot.querySelectorAll(POST_LINK_SELECTOR)) {
      if (link.closest(COMMENT_ROOT_SELECTOR)) continue;
      const urn = extractPostUrnFromHref(link.getAttribute("href"));
      if (!urn) continue;

      let shared = element;
      while (shared && shared !== postRoot && !shared.contains(link)) {
        shared = shared.parentElement;
      }
      if (!shared || otherPostTimesIn(shared).length > 0) continue;

      // Inside an embedded (reshared) post: the link is that post's own.
      if (otherCardTimes.some((other) => !shared.contains(other))) return urn;

      // Sole timestamp in the card: a link to an older post is something the
      // post links to, not the post itself (its activity is never older).
      if (!cardTimestamp || decodeLinkedInTimestamp(urn) >= cardTimestamp) {
        return urn;
      }
    }
    return cardUrn;
  }

  const REPOST_HEADER_REGEX = /\brepost|republi/i;

  // "X reposted this" cards show the original post's time, but apart from the
  // card's comment-tools token they only carry the ID of the repost itself.
  function hasRepostHeader(element, postRoot) {
    const legacyHeader = element
      .closest?.(".feed-shared-update-v2")
      ?.querySelector(".update-components-header");
    if (legacyHeader) {
      return REPOST_HEADER_REGEX.test(legacyHeader.textContent || "");
    }
    if (!postRoot || !element.ownerDocument?.createRange) return false;
    try {
      const range = element.ownerDocument.createRange();
      range.setStart(postRoot, 0);
      range.setEndBefore(element);
      return REPOST_HEADER_REGEX.test(range.toString().slice(0, 160));
    } catch (error) {
      return false;
    }
  }

  function rememberActivityUrn(element, urn) {
    if (urn) element.setAttribute?.("data-linkedin-activity-urn", urn);
    return urn || null;
  }

  function extractFirstUrn(values, extractors) {
    for (const extract of extractors) {
      for (const value of values) {
        const urn = extract(value);
        if (urn) return urn;
      }
    }
    return null;
  }

  function extractActivityUrnFromElement(element, { findTimeElements } = {}) {
    const cachedActivityUrn =
      element.getAttribute?.("data-linkedin-activity-urn") ||
      element
        .closest?.("[data-linkedin-activity-urn]")
        ?.getAttribute("data-linkedin-activity-urn");
    if (cachedActivityUrn) return cachedActivityUrn;

    const postRoot = getContainingPostRoot(element);
    const isRepost = hasRepostHeader(element, postRoot);

    const fromAncestors = extractPostUrnFromAncestorAttributes(element);
    if (fromAncestors) {
      return isRepost ? null : rememberActivityUrn(element, fromAncestors);
    }

    if (postRoot) {
      const fromCard = extractCardScopedPostUrn(
        element,
        postRoot,
        findTimeElements,
        { tokenOnly: isRepost },
      );
      if (fromCard) return rememberActivityUrn(element, fromCard);
    }
    // Every other source on a repost card is the repost's ID, not the post's.
    if (isRepost) return null;

    // After the card lookup: comments name the outer post, which would be
    // wrong for the timestamp of an embedded (reshared) post.
    const fromExpandedComments =
      extractActivityUrnFromExpandedCommentRoots(element);
    if (fromExpandedComments) {
      return rememberActivityUrn(element, fromExpandedComments);
    }

    const candidateValues = [
      ...collectElementCandidateStrings(element, {
        includeDescendants: true,
        descendantScope: postRoot,
      }),
      typeof window !== "undefined" ? window.location.href : "",
    ];

    const fromCandidates = extractFirstUrn(candidateValues, [
      extractActivityUrnFromString,
      extractShareUrnFromString,
      extractUgcPostUrnFromString,
    ]);
    if (fromCandidates) return rememberActivityUrn(element, fromCandidates);

    // Newer layouts (e.g. profile Reactions tab) only carry the post ID as an
    // encoded token on the card's own comment tools; prefer the card-matched one.
    const fromNearbyDom = extractEncodedUrnFromNearbyDom(element);
    if (fromNearbyDom) return rememberActivityUrn(element, fromNearbyDom);

    return rememberActivityUrn(
      element,
      extractFirstUrn(candidateValues, [extractEncodedUrnFromString]),
    );
  }

  function rememberCommentMetadata(commentRoot, metadata) {
    commentRoot.setAttribute?.("data-linkedin-comment-id", metadata.commentId);
    if (metadata.activityUrn) {
      commentRoot.setAttribute?.(
        "data-linkedin-activity-urn",
        metadata.activityUrn,
      );
    }
    return metadata;
  }

  function extractCommentMetadataFromElement(commentElement) {
    const commentRoot = commentElement?.matches?.(COMMENT_ROOT_SELECTOR)
      ? commentElement
      : commentElement?.closest?.(COMMENT_ROOT_SELECTOR);
    if (!commentRoot) return null;

    // The nearest ancestor carrying a comment URN is this comment's own. Check
    // it before any cached value: replies are nested inside their parent
    // comment, so a cached ID found on an ancestor would be the parent's.
    const fromAncestors =
      extractCommentMetadataFromAncestorAttributes(commentRoot);
    if (fromAncestors) return fromAncestors;

    const cachedCommentId = commentRoot.getAttribute?.(
      "data-linkedin-comment-id",
    );
    if (cachedCommentId) {
      return {
        commentId: cachedCommentId,
        activityUrn:
          commentRoot.getAttribute?.("data-linkedin-activity-urn") || null,
      };
    }

    const candidateValues = [
      ...collectElementCandidateStrings(commentRoot, {
        includeDescendants: true,
        descendantScope: commentRoot,
      }),
    ];

    for (const value of candidateValues) {
      const metadata = extractCommentMetadataFromString(value);
      if (metadata?.commentId) {
        return rememberCommentMetadata(commentRoot, metadata);
      }
    }

    const fallbackValue =
      commentRoot.getAttribute("data-id") ||
      commentRoot.getAttribute("data-urn");
    if (fallbackValue) {
      const numericMatch = fallbackValue.match(/(\d+)[^\d]*$/);
      if (numericMatch) {
        return {
          commentId: numericMatch[1],
          activityUrn: extractActivityUrnFromElement(commentRoot),
        };
      }
    }

    return null;
  }

  return {
    COMMENT_ROOT_SELECTOR,
    POST_ROOT_SELECTOR,
    normalizeText,
    getNumericSnowflakeId,
    decodeLinkedInTimestamp,
    decodeLinkedInProtoSnowflakeToken,
    getScopedMatches,
    getPostCardKey,
    extractActivityUrnFromString,
    extractShareUrnFromString,
    extractUgcPostUrnFromString,
    extractEncodedUrnFromString,
    extractCommentMetadataFromString,
    extractActivityUrnFromElement,
    extractCommentMetadataFromElement,
  };
});
