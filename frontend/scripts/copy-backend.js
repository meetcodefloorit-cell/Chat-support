const { cpSync, existsSync } = require("fs");
const { join } = require("path");

const src = join(__dirname, "..", "..", "backend");
const dest = join(__dirname, "..", "api", "backend_src");

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true, force: true });
  console.log("Copied backend → api/backend_src");
} else {
  console.log("Backend source not found at", src, "- skipping copy");
}
