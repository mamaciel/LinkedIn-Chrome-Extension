// Shared by every test file. Must be required first: it pins the timezone
// the date assertions are written for.
process.env.TZ = "America/New_York";

const fs = require("fs");
const path = require("path");

const EXT_DIR = path.join(__dirname, "..");
const CONTENT_SCRIPTS = [
  "date-settings.js",
  "linkedin-ids.js",
  "linkedin-jobs.js",
  "content.js",
];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const readExtensionFile = (file) =>
  fs.readFileSync(path.join(EXT_DIR, file), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A LinkedIn ID that decodes to the given time (the top bits are a timestamp).
const idAt = (timestamp) => (BigInt(Math.round(timestamp)) << 22n).toString();

// The encoded form of an ID that LinkedIn puts in a card's comment box key.
// field 1 = activity (publish time), 2 = ugcPost and 3 = share (creation time).
function encodedToken(timestamp, field) {
  let value = BigInt(idAt(timestamp)) * 2n;
  const varint = [];
  while (value >= 0x80n) {
    varint.push(Number((value & 0x7fn) | 0x80n));
    value >>= 7n;
  }
  varint.push(Number(value));
  const inner = [0x08, ...varint];
  return Buffer.from([(field << 3) | 2, inner.length, ...inner])
    .toString("base64")
    .replace(/=+$/, "");
}

// LinkedIn's short label for a post of the given age: "5m", "3h", "2d", "3w", "10mo".
function shortLabel(age) {
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d`;
  if (age < 30 * DAY) return `${Math.floor(age / (7 * DAY))}w`;
  return `${Math.floor(age / (30 * DAY))}mo`;
}

function createReporter(suiteName) {
  let failed = 0;
  let total = 0;
  // Passing checks are only listed with VERBOSE=1; failures always are.
  const expect = (name, condition, detail) => {
    total += 1;
    if (!condition) failed += 1;
    if (!condition || process.env.VERBOSE) {
      const shown = detail === undefined ? "" : `  [${detail}]`;
      console.log(`${condition ? "pass" : "FAIL"} ${name}${shown}`);
    }
  };
  return {
    expect,
    expectEqual(name, got, want) {
      expect(
        name,
        got === want,
        `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
      );
    },
    finish() {
      console.log(
        `${suiteName}: ${failed ? `${failed} of ${total} FAILED` : `${total} passed`}`,
      );
      process.exit(failed ? 1 : 0);
    },
  };
}

// Runs the extension's real content scripts against a page built from `html`,
// with the browser APIs it needs replaced by stand-ins.
function loadExtensionOnPage({ html, url, storedSettings = {}, fetch, cookie }) {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const storageListeners = [];
  const scriptErrors = [];

  window.chrome = {
    runtime: { lastError: undefined, getManifest: () => ({ version: "test" }) },
    storage: {
      sync: { get: (_keys, callback) => callback({ ...storedSettings }) },
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
  };
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (fetch) window.fetch = fetch;
  if (cookie) window.document.cookie = cookie;
  window.addEventListener("error", (event) => scriptErrors.push(event.message));

  CONTENT_SCRIPTS.forEach((file) => window.eval(readExtensionFile(file)));

  const settings = window.LinkedInDateSettings;
  return {
    window,
    document: window.document,
    scriptErrors,
    text: (id) => window.document.getElementById(id).textContent.trim(),
    element: (id) => window.document.getElementById(id),
    // The date as the extension formats it with default settings plus `overrides`.
    formatDate: (timestamp, overrides = {}) =>
      settings.formatAbsoluteDate(new window.Date(timestamp), {
        locale: window.navigator.language,
        timezoneMode: "local",
        showTime: true,
        dateFormat: "numeric",
        use24HourTime: false,
        ...overrides,
      }),
    // What the popup does when the user changes a setting.
    changeSettings(changes) {
      const payload = Object.fromEntries(
        Object.entries(changes).map(([key, value]) => [key, { newValue: value }]),
      );
      storageListeners.forEach((listener) => listener(payload, "sync"));
    },
  };
}

module.exports = {
  EXT_DIR,
  MINUTE,
  HOUR,
  DAY,
  readExtensionFile,
  sleep,
  idAt,
  encodedToken,
  shortLabel,
  createReporter,
  loadExtensionOnPage,
};
