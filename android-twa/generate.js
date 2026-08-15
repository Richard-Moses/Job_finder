// Non-interactive TWA project generator.
// Bypasses Bubblewrap's interactive `init` wizard (which hangs in this
// environment because it uses raw-keypress prompts that don't work over a
// piped, non-TTY stdin) by calling the same underlying @bubblewrap/core
// library functions the wizard calls internally.
const path = require("path");
const CORE_PATH = path.join(
  process.env.USERPROFILE,
  "AppData/Local/npm-cache/_npx/881cef4662d2c421/node_modules/@bubblewrap/core"
);
const {
  TwaManifest,
  TwaGenerator,
  ConsoleLog,
  KeyTool,
  JdkHelper,
} = require(CORE_PATH);

const MANIFEST_URL = "https://aggnes.netlify.app/manifest.json";
const TARGET_DIR = __dirname;

async function main() {
  const twaManifest = await TwaManifest.fromWebManifest(MANIFEST_URL);

  // Clean, explicit package id instead of the auto-generated one.
  twaManifest.packageId = "app.aggnes.twa";
  twaManifest.appVersionName = "1.0.0";
  twaManifest.appVersionCode = 1;
  twaManifest.signingKey = {
    path: path.join(TARGET_DIR, "android.keystore"),
    alias: "aggnes",
  };

  const err = twaManifest.validate();
  if (err) {
    console.error("Manifest validation failed:", err);
    process.exit(1);
  }

  await twaManifest.saveToFile(path.join(TARGET_DIR, "twa-manifest.json"));
  console.log("Wrote twa-manifest.json");
  console.log(JSON.stringify(twaManifest.toJson(), null, 2));

  const log = new ConsoleLog("twa");
  const generator = new TwaGenerator();
  await generator.createTwaProject(TARGET_DIR, twaManifest, log, () => {});
  console.log("Android project generated at", TARGET_DIR);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
