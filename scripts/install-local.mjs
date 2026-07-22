import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vaultRoot = process.env.OBSIDIAN_VAULT;

if (!vaultRoot) {
  throw new Error("Set OBSIDIAN_VAULT to the path of your development vault.");
}

const target = resolve(vaultRoot, ".obsidian/plugins/coupon-scheduler");

await mkdir(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(resolve(projectRoot, file), resolve(target, file));
}

console.log(`Installed to ${target}`);
