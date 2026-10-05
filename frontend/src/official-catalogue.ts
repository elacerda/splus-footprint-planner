import bundledCsv from "./data/official/tiles_nc.csv?raw";
import provenance from "./data/official/provenance.json";
import { parseCatalogueCsv } from "./science/catalogue";
import type { CatalogueResponse } from "./types";

/** Canonical current catalogue; the synchronized snapshot is only a fallback. */
export const OFFICIAL_CATALOGUE_URL = "https://raw.githubusercontent.com/splus-collab/splus-utilities/main/plot-footprint/tiles_nc.csv";
export const OFFICIAL_CATALOGUE_NAME = "Official S-PLUS tiles";
export const OFFICIAL_CATALOGUE_PROVENANCE = provenance;

/** Validate official UTF-8 CSV with the inherited ICRS parser and all STATUS values.
 * @param csv - CSV containing PID, NAME, RA, DEC, EPOC, STATUS.
 * @returns Nonempty catalogue associated with T80-South, coordinates in degrees.
 * @throws For invalid headers, CSV syntax or coordinates.
 */
export function parseOfficialCatalogue(csv: string): CatalogueResponse {
  const result = parseCatalogueCsv(new TextEncoder().encode(csv), OFFICIAL_CATALOGUE_NAME);
  if (result.needs_mapping || !result.tiles.length ||
      !["PID", "NAME", "RA", "DEC", "EPOC", "STATUS"].every((column) => column in (result.tiles[0].original_values ?? {}))) {
    throw new Error("The official catalogue is empty or has invalid columns.");
  }
  return { ...result, instrument_profile_id: "t80-south" };
}

/** Fetch current survey data with a deadline, using the bundled snapshot on failure.
 * @param signal - Optional lifecycle cancellation; cancelled loads never install data.
 * @param timeoutMs - Deadline in milliseconds, including body download.
 * @returns Parsed catalogue and its source for a nonblocking fallback warning.
 * @throws AbortError on cancellation, or errors in the bundled snapshot.
 */
export async function loadOfficialCatalogue(signal?: AbortSignal, timeoutMs = 8000): Promise<{
  catalogue: CatalogueResponse; source: "upstream" | "fallback";
}> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: ((reason: unknown) => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const cancel = () => {
    controller.abort();
    rejectCancelled?.(new DOMException("Catalogue load cancelled", "AbortError"));
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Catalogue load cancelled", "AbortError");
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Catalogue request timed out")); }, timeoutMs);
    });
    const request = (async () => {
      const response = await fetch(OFFICIAL_CATALOGUE_URL, { signal: controller.signal, cache: "no-cache" });
      if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`);
      return parseOfficialCatalogue(await response.text());
    })();
    return { catalogue: await Promise.race([request, deadline, cancelled]), source: "upstream" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { catalogue: parseOfficialCatalogue(bundledCsv), source: "fallback" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
