(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LinkedInDateSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEYS = [
    "extensionEnabled",
    "dateFormat",
    "separatorStyle",
    "timezoneMode",
    "use24HourTime",
    "showTime",
    "showJobDates",
  ];

  function normalizeDateFormat(value) {
    if (value === "browser") return "numeric";
    return ["compact", "friendly", "numeric", "iso"].includes(value)
      ? value
      : "numeric";
  }

  function normalizeSeparatorStyle(value) {
    return ["bullet", "paren", "date-only", "hover"].includes(value)
      ? value
      : "bullet";
  }

  function normalizeTimezoneMode(value) {
    return ["local", "utc", "hidden"].includes(value) ? value : "local";
  }

  function getDefaultLocale(locale) {
    return locale || "en-US";
  }

  function localeUses24Hour(locale) {
    const cycle = new Intl.DateTimeFormat(getDefaultLocale(locale), {
      hour: "numeric",
    }).resolvedOptions().hourCycle;
    return cycle === "h23" || cycle === "h24";
  }

  function getShortTimeZone(now = new Date(), locale, timeZone) {
    const zone = new Intl.DateTimeFormat(getDefaultLocale(locale), {
      timeZoneName: "short",
      timeZone,
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    return zone && !/^(AM|PM)$/i.test(zone) ? zone : "";
  }

  function normalizeTimeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(
        /^\(?(?:edited|modifié|modifie|bearbeitet|editado|modificato)\)?\s*[•·|]?\s*/i,
        "",
      )
      .replace(
        /\s*[•·|]?\s*\(?(?:edited|modifié|modifie|bearbeitet|editado|modificato)\)?$/i,
        "",
      );
  }

  const RELATIVE_TIME_PARTS_REGEX =
    /^(now|just now|yesterday|ahora|ayer|agora|ontem|ora|ieri|nu|gisteren|jetzt|gerade eben|gestern|hier|à l['’]instant|maintenant|剛剛|刚刚|방금|今|昨日|昨天|어제|\d+\s?(?:months?|minutes?|hours?|days?|weeks?|years?|mins?|hrs?|std|mo|yr|y|w|d|h|m|s|t|j|g|sem|wo)\.?(?:\s*(?:ago|vor|hace))?|\d+\s*(?:日|天|小时|小時|時間|分|分钟|分鐘|분|시간|일))(\s*[•·|].*)?$/i;

  function extractRelativeTimeParts(value) {
    const match = normalizeTimeText(value).match(RELATIVE_TIME_PARTS_REGEX);
    return match
      ? {
          token: match[1],
          suffix: match[2] || "",
        }
      : null;
  }

  function isRelativeTimeText(value) {
    return !!extractRelativeTimeParts(value);
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  // [shortest, longest] real duration that one unit of a LinkedIn label covers.
  const RELATIVE_UNIT_RANGE_MS = {
    m: [60 * 1000, 60 * 1000],
    h: [60 * 60 * 1000, 60 * 60 * 1000],
    d: [DAY_MS, DAY_MS],
    w: [7 * DAY_MS, 7 * DAY_MS],
    mo: [28 * DAY_MS, 31 * DAY_MS],
    yr: [365 * DAY_MS, 366 * DAY_MS],
  };

  const RELATIVE_UNIT_ALIASES = {
    m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
    h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
    d: "d", day: "d", days: "d",
    w: "w", week: "w", weeks: "w",
    mo: "mo", month: "mo", months: "mo",
    yr: "yr", year: "yr", years: "yr",
  };

  // Sanity check: false only when LinkedIn's own label ("2d", "3w") clearly
  // contradicts the decoded timestamp. That means the ID found is not this
  // post's publish time (another card's ID, a repost, a post drafted or
  // scheduled days earlier), so no exact date should be shown for it.
  // Only English short labels are checked; anything else passes.
  function isTimestampConsistentWithRelativeText(
    value,
    timestampMillis,
    { now = Date.now(), labelRenderedAfter = now } = {},
  ) {
    const token = extractRelativeTimeParts(value)?.token;
    const match =
      token &&
      token.match(
        /^(\d+)\s?(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|mo|months?|yr|years?)(?:\s+ago)?$/i,
      );
    if (!match) return true;

    const count = Number(match[1]);
    const [unitMin, unitMax] =
      RELATIVE_UNIT_RANGE_MS[RELATIVE_UNIT_ALIASES[match[2].toLowerCase()]];
    // Allows for a device clock that is off and for LinkedIn's rounding
    // (23 months can read "2yr"; below one unit it uses the smaller unit).
    const slack = Math.max(unitMax * 0.1, 30 * 60 * 1000);
    const youngest = (count <= 1 ? count : count - 0.6) * unitMin - slack;
    const oldest = (count + 1) * unitMax + slack;

    // The label was written at some point between page load and now.
    return (
      now - timestampMillis >= youngest &&
      labelRenderedAfter - timestampMillis <= oldest
    );
  }

  function resolveTimeZone(settings) {
    if (settings.timeZone) return settings.timeZone;
    return settings.timezoneMode === "utc" ? "UTC" : undefined;
  }

  // The label must match the date being shown, not today: a July post is
  // "EDT" even when it is read in December ("EST").
  function getZoneLabel(date, settings) {
    if (settings.timezoneMode === "utc") return "UTC";
    if (settings.timezoneMode === "hidden") return "";
    try {
      const zone = getShortTimeZone(date, settings.locale, settings.timeZone);
      if (zone) return zone;
    } catch (error) {
      // Fall through to the label computed at startup.
    }
    return settings.shortTimeZone || "";
  }

  function getOrdinalSuffix(day) {
    const remainder100 = day % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return "th";

    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  }

  function getDateParts(date, monthStyle, timeZone, locale) {
    const parts = new Intl.DateTimeFormat(getDefaultLocale(locale), {
      month: monthStyle,
      day: "numeric",
      year: "numeric",
      timeZone,
    }).formatToParts(date);

    return {
      month: parts.find((part) => part.type === "month")?.value || "",
      day: Number(parts.find((part) => part.type === "day")?.value || 0),
      year: Number(parts.find((part) => part.type === "year")?.value || 0),
    };
  }

  function formatLocalizedDate(date, locale, timeZone, now, monthStyle) {
    const resolved = getDefaultLocale(locale);
    const currentYear = new Intl.DateTimeFormat(resolved, {
      year: "numeric",
      timeZone,
    }).format(now);
    const dateYear = new Intl.DateTimeFormat(resolved, {
      year: "numeric",
      timeZone,
    }).format(date);
    const options = {
      month: monthStyle,
      day: "numeric",
      timeZone,
    };
    if (dateYear !== currentYear) {
      options.year = "numeric";
    }
    return new Intl.DateTimeFormat(resolved, options).format(date);
  }

  function formatIsoDate(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "01";
    const day = parts.find((part) => part.type === "day")?.value || "01";
    return `${year}-${month}-${day}`;
  }

  function formatFriendlyDate(date, timeZone, now, locale) {
    const resolved = getDefaultLocale(locale);
    if (/^en-US\b/i.test(resolved)) {
      const { month, day, year } = getDateParts(date, "long", timeZone, resolved);
      const currentYear = getDateParts(now, "long", timeZone, resolved).year;
      const baseDate = `${month} ${day}${getOrdinalSuffix(day)}`;
      return year === currentYear ? baseDate : `${baseDate}, ${year}`;
    }
    return formatLocalizedDate(date, resolved, timeZone, now, "long");
  }

  function formatCompactDate(date, timeZone, now, locale) {
    return formatLocalizedDate(date, locale, timeZone, now, "short");
  }

  function formatTime(date, settings, timeZone) {
    const locale = getDefaultLocale(settings.locale);
    if (settings.dateFormat === "iso" || settings.use24HourTime === true) {
      return date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone,
      });
    }

    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(date);
  }

  function formatNumericDate(date, timeZone, locale) {
    return new Intl.DateTimeFormat(getDefaultLocale(locale), {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(date);
  }

  function formatAbsoluteDate(date, settings) {
    const timeZone = resolveTimeZone(settings);
    const now = settings.now || new Date();
    const dateFormat = normalizeDateFormat(settings.dateFormat);
    let formattedDate;

    switch (dateFormat) {
      case "iso":
        formattedDate = formatIsoDate(date, timeZone);
        break;
      case "compact":
        formattedDate = formatCompactDate(date, timeZone, now, settings.locale);
        break;
      case "friendly":
        formattedDate = formatFriendlyDate(date, timeZone, now, settings.locale);
        break;
      case "numeric":
        formattedDate = formatNumericDate(date, timeZone, settings.locale);
        break;
      default:
        formattedDate = formatNumericDate(date, timeZone, settings.locale);
        break;
    }

    if (settings.showTime === false) {
      return formattedDate;
    }

    const formattedTime = formatTime(date, { ...settings, dateFormat }, timeZone);
    const zoneLabel = getZoneLabel(date, settings);
    return `${formattedDate}, ${formattedTime}${zoneLabel ? ` ${zoneLabel}` : ""}`;
  }

  function formatVisibleText({
    absoluteDate,
    relativeText,
    metadataSuffix = "",
    separatorStyle,
    originalText,
  }) {
    switch (normalizeSeparatorStyle(separatorStyle)) {
      case "hover":
        return originalText;
      case "paren":
        return `${absoluteDate} (${relativeText})${metadataSuffix}`;
      case "date-only":
        return `${absoluteDate}${metadataSuffix}`;
      case "bullet":
      default:
        return `${absoluteDate} • ${relativeText}${metadataSuffix}`;
    }
  }

  function formatPreviewText(date, settings) {
    const absoluteDate = formatAbsoluteDate(date, settings);
    return formatVisibleText({
      absoluteDate,
      relativeText: "2d",
      metadataSuffix: "",
      separatorStyle: settings.separatorStyle,
      originalText:
        normalizeSeparatorStyle(settings.separatorStyle) === "hover"
          ? `2d (hover: ${absoluteDate})`
          : "2d",
    });
  }

  const SETTING_NORMALIZERS = {
    dateFormat: normalizeDateFormat,
    separatorStyle: normalizeSeparatorStyle,
    timezoneMode: normalizeTimezoneMode,
    use24HourTime: (value) => !!value,
    showTime: (value) => value !== false,
    showJobDates: (value) => value !== false,
  };

  function applySettingChanges(current, changes = {}) {
    const next = { changed: false };

    for (const [key, normalize] of Object.entries(SETTING_NORMALIZERS)) {
      next[key] = normalize(current[key]);
      const incoming = changes[key];
      if (!incoming || incoming.newValue === undefined) continue;
      const value = normalize(incoming.newValue);
      if (value !== next[key]) {
        next[key] = value;
        next.changed = true;
      }
    }

    return next;
  }

  return {
    STORAGE_KEYS,
    normalizeDateFormat,
    normalizeSeparatorStyle,
    normalizeTimezoneMode,
    getDefaultLocale,
    localeUses24Hour,
    getShortTimeZone,
    extractRelativeTimeParts,
    isRelativeTimeText,
    isTimestampConsistentWithRelativeText,
    formatAbsoluteDate,
    formatVisibleText,
    formatPreviewText,
    applySettingChanges,
  };
});
