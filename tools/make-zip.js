// Builds the zip to upload to a browser's add-on store: only the files the
// extension runs, never tests, tooling or node_modules.
//
//   npm run zip           ->  dist/linkedin-post-dates-<version>.zip          (Chrome Web Store)
//   npm run zip:firefox   ->  dist/linkedin-post-dates-firefox-<version>.zip  (addons.mozilla.org)
//
// Both come from the same source files. The Firefox build only differs in its
// manifest: manifest.json with the keys in manifest.firefox.json merged in.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const TARGETS = {
  chrome: { suffix: "", manifestOverrides: null },
  firefox: { suffix: "-firefox", manifestOverrides: "manifest.firefox.json" },
};

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

// Objects are merged key by key; anything else in `overrides` replaces the base value.
function mergeManifest(base, overrides) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const bothObjects =
      value && typeof value === "object" && !Array.isArray(value) &&
      merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key]);
    merged[key] = bothObjects ? mergeManifest(merged[key], value) : value;
  }
  return merged;
}

function buildManifest(target) {
  const base = readJson("manifest.json");
  const overridesFile = TARGETS[target].manifestOverrides;
  return overridesFile ? mergeManifest(base, readJson(overridesFile)) : base;
}

// ---- Which files ship --------------------------------------------------------
function collectExtensionFiles(manifest) {
  const files = new Set();
  const add = (file) => file && files.add(file.replace(/\\/g, "/"));

  (manifest.content_scripts || []).forEach((script) => {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  });
  Object.values(manifest.icons || {}).forEach(add);
  const action = manifest.action || {};
  Object.values(action.default_icon || {}).forEach(add);

  // The popup, and the scripts, stylesheets and images it loads.
  if (action.default_popup) {
    add(action.default_popup);
    const html = fs.readFileSync(path.join(ROOT, action.default_popup), "utf8");
    for (const match of html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref|img[^>]*\ssrc)="([^"]+)"/g)) {
      if (!/^[a-z]+:/i.test(match[1])) add(match[1]);
    }
  }

  const missing = [...files].filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (missing.length) {
    throw new Error(`Referenced by the extension but not found: ${missing.join(", ")}`);
  }
  return [...files].sort();
}

// ---- A minimal zip writer (no dependencies) ----------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// entries: [{ name, content: Buffer }]
function buildZip(entries) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = zlib.deflateRawSync(entry.content, { level: 9 });
    const checksum = crc32(entry.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory entry
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42); // where the local header starts
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

// ---- Run ----------------------------------------------------------------------
const target = process.argv[2] || "chrome";
if (!TARGETS[target]) {
  console.error(`Unknown target "${target}". Use: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const manifest = buildManifest(target);
const files = collectExtensionFiles(manifest);
// Chrome gets manifest.json exactly as written; Firefox gets the merged one.
const manifestContent = TARGETS[target].manifestOverrides
  ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  : fs.readFileSync(path.join(ROOT, "manifest.json"));
const entries = [
  { name: "manifest.json", content: manifestContent },
  ...files.map((file) => ({ name: file, content: fs.readFileSync(path.join(ROOT, file)) })),
];

const outputDir = path.join(ROOT, "dist");
const outputFile = path.join(
  outputDir,
  `linkedin-post-dates${TARGETS[target].suffix}-${manifest.version}.zip`,
);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, buildZip(entries));

console.log(`${target}, version ${manifest.version}, ${entries.length} files:`);
entries.forEach((entry) => console.log(`  ${entry.name}`));
console.log(`\nWrote ${path.relative(ROOT, outputFile)} (${Math.round(fs.statSync(outputFile).size / 1024)} KB)`);
