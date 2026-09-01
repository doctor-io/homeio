#!/usr/bin/env node
/**
 * Applies this repo's Android customisations on top of a generated `android/`
 * project.
 *
 * `android/` is git-ignored and regenerated with `cap add android`, so anything
 * edited in place — the back-button activity, the launcher icons, the splash,
 * the manifest flags — is lost on a fresh clone. This copies the tracked
 * overlay in `native/android/` over it, generates the icon densities from
 * `public/icon.png`, and patches the two manifest attributes Capacitor does not
 * write. Safe to run repeatedly; `npm run sync` calls it for you.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(root, "android");

if (!existsSync(android)) {
  console.log("[native] no android/ project yet — run `npm run add:android` first");
  process.exit(0);
}

cpSync(join(root, "native/android"), android, { recursive: true });
console.log("[native] copied native/android overlay");

// Launcher icons at every density. The adaptive foreground is the full 108dp
// canvas; ic_launcher_foreground_inset.xml shrinks it into the 72dp safe zone.
const icon = join(root, "public/icon.png");
const densities = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
];

for (const [density, legacy, adaptive] of densities) {
  const dir = join(android, "app/src/main/res", `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });

  for (const [name, size] of [
    ["ic_launcher.png", legacy],
    ["ic_launcher_round.png", legacy],
    ["ic_launcher_foreground.png", adaptive],
  ]) {
    execFileSync("sips", ["-z", String(size), String(size), icon, "--out", join(dir, name)], {
      stdio: "ignore",
    });
  }
}
console.log(`[native] generated icons for ${densities.length} densities`);

// Capacitor writes neither of these, and both are load-bearing: cleartext
// because Homeio speaks plain HTTP over the tailnet, and adjustResize so the
// WebView shrinks for the keyboard instead of being covered by it.
const manifestPath = join(android, "app/src/main/AndroidManifest.xml");
let manifest = readFileSync(manifestPath, "utf8");
let patched = false;

if (!manifest.includes("android:usesCleartextTraffic")) {
  manifest = manifest.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
  patched = true;
}

// DownloadManager writes into the public Downloads folder. That needs no
// permission from API 29, but minSdk is 23 and older phones still refuse
// without it — hence the maxSdkVersion, so nothing is asked for on modern ones.
if (!manifest.includes("WRITE_EXTERNAL_STORAGE")) {
  manifest = manifest.replace(
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission\n        android:name="android.permission.WRITE_EXTERNAL_STORAGE"\n        android:maxSdkVersion="28" />',
  );
  patched = true;
}

if (!manifest.includes("android:windowSoftInputMode")) {
  manifest = manifest.replace(
    'android:name=".MainActivity"',
    'android:name=".MainActivity"\n            android:windowSoftInputMode="adjustResize"',
  );
  patched = true;
}

if (patched) {
  writeFileSync(manifestPath, manifest);
  console.log("[native] patched AndroidManifest");
} else {
  console.log("[native] AndroidManifest already patched");
}
