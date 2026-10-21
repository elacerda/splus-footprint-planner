import type { CatalogueDataset, CatalogueResponse } from "./types";
import { profileRegistry, type ProfileRegistry } from "./profiles";

const BASE_HUES = [188, 270, 115, 325, 215, 70, 155, 295];

/** Assign a stable, distinguishable layer color by insertion order.
 *
 * @param index - Zero-based dataset position in the session.
 * @returns CSS hex color, also suitable for a native color input.
 */
export function datasetColor(index: number): string {
  const hue = index < BASE_HUES.length
    ? BASE_HUES[index]
    : (188 + index * 137.50776405003785) % 360;
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (0.43 - 0.3096 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Identify identical parsed content without filenames or session-scoped IDs.
 * @param result - Validated CSV rows, ICRS coordinates in degrees and detected mapping.
 * @returns Lossless signature including source fields and mapping; no hash collisions.
 */
export function catalogueContentKey(result: CatalogueResponse): string {
  return JSON.stringify([result.ra_column, result.dec_column, result.tiles.map((tile) => [
    tile.ra_deg, tile.dec_deg, tile.original_values, tile.metadata,
  ])]);
}

/** Attach a stable layer identity and instrument association to every imported dataset.
 *
 * @param result - Catalogue parsed in the browser.
 * @param index - Zero-based insertion order for deterministic color selection.
 * @param id - Stable session identifier for this upload.
 * @param instrumentProfileId - Optional explicit instrument override. A profile
 *   declared by the catalogue wins when no override is supplied. If the registry
 *   has one instrument, it remains the convenient default; multiple available
 *   instruments require an explicit choice.
 * @param registry - Session registry used to validate the instrument association.
 * @returns Independent dataset with source origins and collision-free row IDs.
 * @throws If the selected instrument profile is not registered.
 */
export function createDataset(
  result: CatalogueResponse,
  index: number,
  id: string,
  instrumentProfileId?: string,
  registry: ProfileRegistry = profileRegistry,
): CatalogueDataset {
  const registeredInstruments = registry.listAnyInstrumentProfiles();
  const associatedInstrumentId = instrumentProfileId
    ?? result.instrument_profile_id
    ?? (registeredInstruments.length === 1 ? registeredInstruments[0].id : null);
  if (associatedInstrumentId) registry.resolveInstrumentProfile(associatedInstrumentId);
  return {
    id,
    provenance: "imported",
    content_key: catalogueContentKey(result),
    filename: result.filename,
    color: datasetColor(index),
    ra_column: result.ra_column ?? "RA",
    dec_column: result.dec_column ?? "DEC",
    instrument_profile_id: associatedInstrumentId,
    inference_role: "auto",
    visible: true,
    tiles: result.tiles.map((tile) => ({
      ...tile,
      id: `${id}:${tile.id}`,
      dataset_id: id,
      dataset_name: result.filename,
      // Namespace the legacy inference group without merging independent uploads.
      group_id: `${id}:${tile.group_id ?? "catalogue"}`,
    })),
  };
}
