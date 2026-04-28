import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

function run(command, options = {}) {
  execSync(command, { stdio: "inherit", ...options });
}

const root = process.cwd();
const next = process.argv[2];

if (!next) {
  console.error("Usage: npm run bump -- <major.minor.patch>");
  process.exit(1);
}

if (!VERSION_RE.test(next)) {
  console.error(`Invalid version "${next}". Expected format: major.minor.patch`);
  process.exit(1);
}

// 1) Update package.json + package-lock.json
run(`npm version ${next} --no-git-tag-version --allow-same-version`);

// 2) Sync Tauri bundle version
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
tauriConf.version = next;
fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

// 3) Sync Cargo package version
const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const updatedCargoToml = cargoToml.replace(
  /^version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+"/m,
  `version = "${next}"`
);

if (updatedCargoToml === cargoToml) {
  console.error("Failed to update src-tauri/Cargo.toml version.");
  process.exit(1);
}

fs.writeFileSync(cargoTomlPath, updatedCargoToml);

// 4) Sync README version badge
const readmePath = path.join(root, "README.md");
const readme = fs.readFileSync(readmePath, "utf8");
const updatedReadme = readme.replace(
  /(https:\/\/img\.shields\.io\/badge\/version-)([0-9]+\.[0-9]+\.[0-9]+)(-blue)/,
  `$1${next}$3`
);

if (updatedReadme === readme) {
  console.error("Failed to update README version badge.");
  process.exit(1);
}

fs.writeFileSync(readmePath, updatedReadme);

// 5) Regenerate Cargo.lock so tauri-app package version is synchronized
if (!process.env.SKIP_CARGO_LOCKFILE) {
  run("cargo generate-lockfile", { cwd: path.join(root, "src-tauri") });
} else {
  console.log("Skipping Cargo.lock regeneration (SKIP_CARGO_LOCKFILE is set)");
}

console.log(`Version bumped to ${next}`);
