// Builds the zip to upload to the Chrome Web Store: only the files the
// extension runs, never tests, tooling or node_modules.
// Usage: npm run zip   ->   dist/linkedin-post-dates-<version>.zip
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// ---- Which files ship --------------------------------------------------------
function collectExtensionFiles() {
  const files = new Set(["manifest.json"]);
  const add = (file) => file && files.add(file.replace(/\\/g, "/"));

  (manifest.content_scripts || []).forEach((script) => {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  });
  Object.values(manifest.icons || {}).forEach(add);

  // The popup, and the scripts and stylesheets it loads.
  const popup = manifest.action && manifest.action.default_popup;
  if (popup) {
    add(popup);
    const html = fs.readFileSync(path.join(ROOT, popup), "utf8");
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

function buildZip(files) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file, "utf8");
    const content = fs.readFileSync(path.join(ROOT, file));
    const compressed = zlib.deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
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
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42); // where the local header starts
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

// ---- Run ----------------------------------------------------------------------
const files = collectExtensionFiles();
const outputDir = path.join(ROOT, "dist");
const outputFile = path.join(outputDir, `linkedin-post-dates-${manifest.version}.zip`);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, buildZip(files));

console.log(`Version ${manifest.version}, ${files.length} files:`);
files.forEach((file) => console.log(`  ${file}`));
console.log(`\nWrote ${path.relative(ROOT, outputFile)} (${Math.round(fs.statSync(outputFile).size / 1024)} KB)`);
