import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = join(frontendDirectory, "dist");
const indexPath = join(distDirectory, "index.html");
const viteCliPath = join(frontendDirectory, "node_modules", "vite", "bin", "vite.js");
const appBase = "/splus-cloud/tools/footprint-planner/";

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine an available preview port.");
  }

  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

async function waitForPreview(previewProcess, previewUrl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (previewProcess.exitCode !== null) {
      throw new Error(`Vite preview exited with code ${previewProcess.exitCode}.`);
    }

    try {
      const response = await fetch(`${previewUrl}${appBase}`);
      if (response.ok) return;
    } catch {
      // Vite may need a moment to bind its preview port.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error("Vite preview did not become ready within 10 seconds.");
}

async function assertPreviewAsset(previewUrl, assetUrl, extension) {
  const parsedAssetUrl = new URL(assetUrl, `${previewUrl}${appBase}`);
  if (!parsedAssetUrl.pathname.startsWith(appBase)) {
    throw new Error(`Built asset URL is outside the deployment base: ${assetUrl}`);
  }

  const relativePath = decodeURIComponent(parsedAssetUrl.pathname.slice(appBase.length));
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error(`Invalid built asset path: ${assetUrl}`);
  }

  const expectedPath = resolve(distDirectory, relativePath);
  if (!expectedPath.startsWith(`${distDirectory}${sep}`)) {
    throw new Error(`Built asset path escapes the dist directory: ${assetUrl}`);
  }

  const expectedBytes = await readFile(expectedPath);
  const response = await fetch(parsedAssetUrl);
  if (response.status !== 200) {
    throw new Error(`${assetUrl} returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const expectedContentType = extension === ".js" ? "javascript" : "text/css";
  if (!contentType.includes(expectedContentType)) {
    throw new Error(`${assetUrl} returned Content-Type ${contentType || "(missing)"}.`);
  }

  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (/^\s*<!doctype html/i.test(responseBytes.toString("utf8", 0, 128))) {
    throw new Error(`${assetUrl} returned the SPA HTML fallback instead of an asset.`);
  }
  if (!responseBytes.equals(expectedBytes)) {
    throw new Error(`${assetUrl} did not return the emitted ${extension} file.`);
  }
}

const indexBytes = await readFile(indexPath);
const indexHtml = indexBytes.toString("utf8");
const assetUrls = [...indexHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
  .map((match) => match[1])
  .filter((assetUrl) => new URL(assetUrl, `http://127.0.0.1${appBase}`).pathname.startsWith(`${appBase}assets/`));
// Verify worker chunks as well as the entry points at an arbitrary nested mount.
for (const name of await readdir(join(distDirectory, "assets"))) {
  if (name.endsWith(".js") && !assetUrls.some((url) => url.endsWith(`/assets/${name}`))) assetUrls.push(`./assets/${name}`);
}
const library = JSON.parse(await readFile(join(frontendDirectory, "src/science/fixtures/production-v3.json"), "utf8"));
const genericIds = [...library.instruments, ...library.strategies].map(({ id }) => id);
for (const assetUrl of assetUrls.filter((url) => url.endsWith(".js"))) {
  const bytes = await readFile(join(distDirectory, "assets", assetUrl.split("/").at(-1)));
  for (const id of genericIds) {
    if (bytes.includes(id)) throw new Error(`Generic library profile ${id} leaked into ${assetUrl}`);
  }
}
const jsAssets = assetUrls.filter((assetUrl) => new URL(assetUrl, `http://127.0.0.1${appBase}`).pathname.endsWith(".js"));
const cssAssets = assetUrls.filter((assetUrl) => new URL(assetUrl, `http://127.0.0.1${appBase}`).pathname.endsWith(".css"));

if (jsAssets.length === 0 || cssAssets.length === 0) {
  throw new Error("dist/index.html must emit at least one JavaScript and one CSS asset under the relative assets directory.");
}

const port = await findAvailablePort();
const previewUrl = `http://127.0.0.1:${port}`;
const previewProcess = spawn(
  process.execPath,
  [viteCliPath, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--base", appBase],
  { cwd: frontendDirectory, stdio: "ignore" },
);

try {
  await waitForPreview(previewProcess, previewUrl);

  const pageResponse = await fetch(`${previewUrl}${appBase}`);
  if (pageResponse.status !== 200 || !(pageResponse.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error(`Preview route ${appBase} did not return the production HTML document.`);
  }
  const pageBytes = Buffer.from(await pageResponse.arrayBuffer());
  if (!pageBytes.equals(indexBytes)) {
    throw new Error(`Preview route ${appBase} did not return dist/index.html.`);
  }

  for (const assetUrl of assetUrls) {
    const pathname = new URL(assetUrl, `${previewUrl}${appBase}`).pathname;
    const extension = pathname.endsWith(".js") ? ".js" : ".css";
    await assertPreviewAsset(previewUrl, assetUrl, extension);
  }

  console.log(`Production preview smoke check passed: ${jsAssets.length} JS and ${cssAssets.length} CSS assets served from ${appBase}.`);
} finally {
  if (previewProcess.exitCode === null && previewProcess.signalCode === null) {
    previewProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => previewProcess.once("exit", resolveExit)),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
    ]);
  }
}
