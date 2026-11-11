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

  function getShortTimeZone(now = new Date(), locale) {
    const zone = new Intl.DateTimeFormat(getDefaultLocale(locale), {
      timeZoneName: "short",
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

  function resolveTimeZone(settings) {
    if (settings.timeZone) return settings.timeZone;
    return settings.timezoneMode === "utc" ? "UTC" : undefined;
  }

  function getZoneLabel(settings) {
    if (settings.timezoneMode === "utc") return "UTC";
    if (settings.timezoneMode === "hidden") return "";
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
    const zoneLabel = getZoneLabel(settings);
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
    formatAbsoluteDate,
    formatVisibleText,
    formatPreviewText,
    applySettingChanges,
  };
});
