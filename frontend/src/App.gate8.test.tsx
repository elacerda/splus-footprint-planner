import { measureResolvedCoverage } from "./science/test-support/resolved-coverage";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { cases } from "./data/gate8/fixtures";
import type { ProfileRegistry } from "./profiles/registry";
import { createBundledProfileRegistry } from "./science/fixtures/legacy-registry";
import { buildExportCsv } from "./science/export";
import { readCsv } from "./science/catalogue";
import type { CatalogueDataset, SkyPolygon, TileRecord, TilingProfile } from "./types";
import golden from "./data/golden.json";
import plannerContract from "./data/planner-contract.json";
import referenceCsv from "./science/fixtures/tiles_nc.csv?raw";

interface MapModel {
  tiles: TileRecord[];
  datasets: CatalogueDataset[];
  profile: TilingProfile;
  onRegionSelect: (polygon: SkyPolygon) => void;
  onSkyClick: (ra: number, dec: number) => void;
}
const session = vi.hoisted(() => ({ registry: null as ProfileRegistry | null, map: null as MapModel | null, region: null as SkyPolygon | null, origin: { ra_deg: 0, dec_deg: 0 } }));

// Keep the actual API, planner, coverage, catalogue and export. Only isolate the
// browser-memory registry and replace Aladin's remote renderer with its props.
vi.mock("./profiles/registry", async (importOriginal) => {
  const original = await importOriginal<typeof import("./profiles/registry")>();
  const proxy = new Proxy({} as ProfileRegistry, { get: (_, key) => {
    const value = Reflect.get(session.registry!, key);
    return typeof value === "function" ? value.bind(session.registry) : value;
  } });
  return { ...original, profileRegistry: proxy };
});
vi.mock("./AladinMap", async () => {
  const React = await import("react");
  return { default: (props: MapModel) => {
    session.map = props;
    return React.createElement("div", {},
      React.createElement("button", { onClick: () => props.onRegionSelect(session.region!) }, "Select G8 region"),
      React.createElement("button", { onClick: () => props.onSkyClick(session.origin.ra_deg, session.origin.dec_deg) }, "G8 sky click"));
  } };
});

/** Browser file bytes, without depending on jsdom's incomplete File.arrayBuffer. */
function inputFile(text: string, name: string): File {
  const file = new File([text], name);
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
  return file;
}

/** Read the exact CSV Blob emitted by the real browser download API. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error); reader.readAsText(blob);
  });
}

describe("Gate 8 real App workflow matrix", () => {
  let downloads: Blob[];
  beforeEach(() => {
    session.registry = createBundledProfileRegistry(); session.map = null; downloads = [];
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((blob: Blob) => { downloads.push(blob); return "blob:g8"; });
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("T80 user-upload browser workflow retains frozen holdout coverage and export ordering", async () => {
    const fixture = golden.historical_holdout;
    // Upload the S-PLUS regression fixture as a user file, excluding held-out rows.
    const referenceRows = readCsv(referenceCsv);
    const names = new Set(fixture.surrounding_names);
    const subset = [referenceRows[0], ...referenceRows.slice(1).filter((row) => names.has(row[1]))].map((row) => row.join(",")).join("\n");
    session.region = fixture.polygon;
    const user = userEvent.setup(); render(<App />);
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), inputFile(subset, "tiles_nc.csv"));
    await waitFor(() => expect(session.map!.datasets[0]?.instrument_profile_id).toBe("t80-south"));
    const sources = structuredClone(session.map!.tiles);
    await user.click(screen.getByRole("button", { name: "Select G8 region" }));
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    await user.click(await screen.findByRole("button", { name: "Accept proposal" }));
    const accepted = session.map!.tiles.filter((t) => t.source === "proposed");
    expect(accepted).toHaveLength(plannerContract.plans.historical_holdout.new_tiles);
    expect(measureResolvedCoverage(fixture.polygon, sources, accepted).selected_region_coverage)
      .toBe(plannerContract.plans.historical_holdout.selected_region_coverage);
    await user.click(screen.getByRole("button", { name: /Download new_tiles.csv/ }));
    expect(await blobText(downloads.at(-1)!)).toBe(buildExportCsv(accepted, cases[0].document.survey));
    expect(session.map!.tiles.filter((t) => t.source === "original")).toEqual(sources);
  }, 20000);
});
