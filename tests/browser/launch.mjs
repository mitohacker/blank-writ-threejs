// Shared helper for the browser tests: a headless Edge (WebGL through SwiftShader) with the game's static server.
//   import { open_game, shot, close } from "./launch.mjs";
//   const g = await open_game({ query: "screen=title&fresh=1&lang=en", width: 1920, height: 1080 });
//   await shot(g.page, "shots/title.png");  ... g.page.evaluate(() => window.__bw.run) ...  await close(g);
//
// The server (python serve.py 8712) is started on demand and left running (other test runs share it); stop it with
// `taskkill /f /im python.exe` only if you started it yourself.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.BW_PORT || 8712);

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

async function port_open() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/index.html`, { method: "HEAD" });
    return r.ok;
  } catch (e) {
    return false;
  }
}

export async function ensure_server() {
  if (await port_open()) return null;
  const p = spawn("python", ["serve.py", String(PORT)], { cwd: ROOT, stdio: "ignore", detached: true, env: { ...process.env, SERVE_QUIET: "1" } });
  p.unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await port_open()) return p;
  }
  throw new Error("static server did not start");
}

export async function open_game({ query = "", width = 1920, height = 1080, console_errors = true, sound = false } = {}) {
  const server = await ensure_server();
  const exe = EDGE_PATHS.find((p) => existsSync(p));
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", sound ? "" : "--mute-audio", "--autoplay-policy=no-user-gesture-required"].filter(Boolean),
  });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  if (console_errors) {
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text());
    });
  }
  await page.goto(`http://127.0.0.1:${PORT}/index.html${query ? "?" + query : ""}`);
  // booted when the boot veil is gone
  await page.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 30000 }).catch(() => {});
  return { browser, ctx, page, errors, server };
}

export async function shot(page, path) {
  mkdirSync(dirname(resolve(ROOT, path)), { recursive: true });
  await page.screenshot({ path: resolve(ROOT, path) });
  return path;
}

export async function close(g) {
  await g.browser.close();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
