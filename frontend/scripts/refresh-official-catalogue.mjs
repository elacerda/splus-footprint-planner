import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const directory = fileURLToPath(new URL("../src/data/official/", import.meta.url));
const repository = "splus-collab/splus-utilities";
const path = "plot-footprint/tiles_nc.csv";
const source = `https://raw.githubusercontent.com/${repository}/main/${path}`;

/** Synchronize a verified GitHub blob and its provenance, preserving the old pair on validation errors.
 * @returns Resolves after writing UTF-8 CSV and provenance JSON in the bundled data directory.
 * @throws On HTTP errors, blob mismatch or inherited catalogue parser rejection.
 */
async function refresh() {
  const metadataResponse = await fetch(`https://api.github.com/repos/${repository}/contents/${path}?ref=main`, {
    signal: AbortSignal.timeout(30000), headers: { Accept: "application/vnd.github+json" },
  });
  if (!metadataResponse.ok) throw new Error(`GitHub metadata HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  // Fetch by immutable SHA, so an intervening main update cannot corrupt provenance.
  const response = await fetch(`https://api.github.com/repos/${repository}/git/blobs/${metadata.sha}`, {
    signal: AbortSignal.timeout(30000), headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub blob HTTP ${response.status}`);
  const blob = await response.json();
  const bytes = Buffer.from(blob.content, "base64");
  const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (sha !== metadata.sha) throw new Error("Downloaded bytes do not match the upstream blob SHA");
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), server: { middlewareMode: true } });
  try {
    const { parseOfficialCatalogue } = await vite.ssrLoadModule("/src/official-catalogue.ts");
    const parsed = parseOfficialCatalogue(bytes.toString("utf8"));
    const oldBytes = await readFile(`${directory}tiles_nc.csv`);
    const oldProvenance = await readFile(`${directory}provenance.json`);
    try {
      await writeFile(`${directory}tiles_nc.csv`, bytes);
      await writeFile(`${directory}provenance.json`, `${JSON.stringify({
        repository, path, ref: "main", blob_sha: sha, synchronized_at: new Date().toISOString(), source,
      }, null, 2)}\n`);
    } catch (error) {
      await writeFile(`${directory}tiles_nc.csv`, oldBytes);
      await writeFile(`${directory}provenance.json`, oldProvenance);
      throw error;
    }
    console.log(`Synchronized ${parsed.row_count} official tiles at ${sha}`);
  } finally { await vite.close(); }
}

await refresh();
