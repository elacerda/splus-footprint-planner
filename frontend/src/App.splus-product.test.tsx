import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";
import golden from "./data/golden.json";
import plannerContract from "./data/planner-contract.json";
import referenceCsv from "./science/fixtures/tiles_nc.csv?raw";
import { readCsv } from "./science/catalogue";
import { OFFICIAL_CATALOGUE_URL } from "./official-catalogue";
import type { CatalogueDataset, SkyPolygon, TileRecord } from "./types";

interface MapProps {
  datasets: CatalogueDataset[]; tiles: TileRecord[]; selectedPolygon: SkyPolygon | null;
  focusRequest: number; regionFocusRequest: number;
  onRegionSelect: (polygon: SkyPolygon) => void; onSkyClick: (ra: number, dec: number) => void;
}
const captured = vi.hoisted(() => ({ map: null as MapProps | null }));
vi.mock("./AladinMap", () => ({ default: (props: MapProps) => {
  captured.map = props;
  return <div>
    <button onClick={() => props.onRegionSelect({ vertices: [
      { ra_deg: 149.9, dec_deg: -30.1 }, { ra_deg: 150.1, dec_deg: -30.1 },
      { ra_deg: 150.1, dec_deg: -29.9 }, { ra_deg: 149.9, dec_deg: -29.9 },
    ] })}>Covered region</button>
    <button onClick={() => props.onRegionSelect({ vertices: [
      { ra_deg: 150, dec_deg: 40 }, { ra_deg: 154, dec_deg: 40 },
      { ra_deg: 154, dec_deg: 44 }, { ra_deg: 150, dec_deg: 44 },
    ] })}>Uncovered region</button>
    <button onClick={() => props.onSkyClick(150.5, -24.25)}>Place sky center</button>
  </div>;
} }));

const csv = "PID,NAME,RA,DEC,EPOC,STATUS\nSPLUS,A,150,-30,2000,0\n";
function file(contents: string, name = "local.csv") {
  const input = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(input, "arrayBuffer", { configurable: true, value: async () => new TextEncoder().encode(contents).buffer });
  return input;
}
async function loaded() {
  await waitFor(() => expect(captured.map?.datasets).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reload official catalogue" })).toBeEnabled());
}
beforeEach(() => {
  captured.map = null;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => csv }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("S-PLUS product workflows", () => {
  it("opens with official tiles visible, T80 association and automatic inference participation", async () => {
    render(<App />); await loaded();
    expect(fetch).toHaveBeenCalledWith(OFFICIAL_CATALOGUE_URL, expect.any(Object));
    expect(captured.map!.datasets[0]).toMatchObject({ filename: "Official S-PLUS tiles", instrument_profile_id: "t80-south", inference_role: "auto", visible: true });
    expect(captured.map!.tiles[0]).toMatchObject({ instrument_profile_id: "t80-south", inference_role: "auto" });
    expect(screen.getByRole("heading", { name: "S-PLUS Footprint Planner" })).toBeTruthy();
    expect(screen.queryByText(/Using bundled official/)).toBeNull();
  });

  it("uses automatically loaded official tiles in ordinary S-PLUS region coverage", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.click(screen.getByRole("button", { name: "Covered region" }));
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    await screen.findByRole("heading", { name: "Proposal preview" });
    expect(screen.getByText("Existing contributors").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Already covered").parentElement).toHaveTextContent("100.0%");
  });

  it("infers the existing grid from automatically loaded official tiles with frozen holdout results", async () => {
    const fixture = golden.historical_holdout;
    const rows = readCsv(referenceCsv);
    const names = new Set(fixture.surrounding_names);
    const subset = [rows[0], ...rows.slice(1).filter((row) => names.has(row[1]))].map((row) => row.join(",")).join("\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => subset }));
    const user = userEvent.setup(); render(<App />); await loaded();
    act(() => { captured.map!.onRegionSelect(fixture.polygon); });
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    await screen.findByText("Existing grid extended", {}, { timeout: 10000 });
    expect(screen.getByText("New tiles").parentElement).toHaveTextContent(String(plannerContract.plans.historical_holdout.new_tiles));
    await user.click(screen.getByRole("button", { name: "Accept proposal" }));
    expect(captured.map!.tiles.filter((tile) => tile.source === "proposed")).toHaveLength(plannerContract.plans.historical_holdout.new_tiles);
  }, 20000);

  it.each(["network", "malformed"])("warns without blocking planning when %s activates fallback", async (failure) => {
    vi.stubGlobal("fetch", failure === "network" ? vi.fn().mockRejectedValue(new Error("Offline"))
      : vi.fn().mockResolvedValue({ ok: true, text: async () => "not CSV" }));
    const user = userEvent.setup(); render(<App />); await loaded();
    expect(screen.getByText(/Using bundled official/)).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Uncovered region" }));
    await user.click(screen.getByRole("radio", { name: /Efficient coverage/ }));
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    await screen.findByRole("heading", { name: "Proposal preview" }, { timeout: 10000 });
    expect(screen.getByRole("button", { name: "Accept proposal" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Accept proposal" }));
    expect(captured.map!.tiles.some((tile) => tile.source === "proposed")).toBe(true);
  }, 20000);

  it("adds independent catalogues, skips repeated content, and refreshes only the official reference", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    const official = captured.map!.datasets[0];
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file(csv));
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC,quality\n151,-31,good\n", "extension.csv"));
    expect(captured.map!.datasets).toHaveLength(3);
    const [reference, local, extension] = captured.map!.datasets;
    expect(reference).toEqual(official);
    expect(new Set(captured.map!.datasets.map((dataset) => dataset.id)).size).toBe(3);
    expect(new Set(captured.map!.datasets.map((dataset) => dataset.color)).size).toBe(3);
    expect(new Set(captured.map!.tiles.map((tile) => tile.id)).size).toBe(3);
    expect(new Set(captured.map!.tiles.map((tile) => tile.group_id)).size).toBe(3);
    expect(extension.tiles[0].original_values).toEqual({ RA: "151", DEC: "-31", quality: "good" });
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file(csv, "renamed.csv"));
    expect(screen.getByRole("status")).toHaveTextContent("identical imported content was skipped");
    expect(captured.map!.datasets).toHaveLength(3);
    await user.click(screen.getByText("More tools", { exact: true }));
    expect(screen.queryByRole("button", { name: "Remove Official S-PLUS tiles" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Show local.csv" }));
    expect(captured.map!.datasets[1]).toMatchObject({ visible: false, color: local.color });
    expect(captured.map!.tiles).toHaveLength(2);
    expect(captured.map!.datasets[0].visible).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Show local.csv" }));
    fireEvent.change(screen.getByLabelText("Color for local.csv"), { target: { value: "#d44890" } });
    fireEvent.change(screen.getByLabelText("Color for Official S-PLUS tiles"), { target: { value: "#45aaff" } });
    await user.click(screen.getByRole("checkbox", { name: "Show Official S-PLUS tiles" }));
    const localStyled = captured.map!.datasets[1];
    expect(localStyled).toMatchObject({ visible: true, color: "#d44890" });
    await user.click(screen.getByRole("button", { name: "Remove extension.csv" }));
    expect(captured.map!.datasets).toHaveLength(2);
    expect(captured.map!.datasets[1]).toEqual(localStyled);
    for (let reload = 0; reload < 2; reload += 1) {
      await user.click(screen.getByRole("button", { name: "Reload official catalogue" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Reload official catalogue" })).toBeEnabled());
      expect(captured.map!.datasets).toHaveLength(2);
      expect(captured.map!.datasets[0]).toMatchObject({ id: official.id, provenance: "official", color: "#45aaff", visible: false });
      expect(captured.map!.datasets[1]).toEqual(localStyled);
    }
  });

  it("distinguishes different content with identical filenames and never grants official status by name", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n151,-31\n"));
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n152,-32\n"));
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n153,-33\n", "Official S-PLUS tiles.csv"));
    expect(captured.map!.datasets).toHaveLength(4);
    expect(new Set(captured.map!.datasets.map((dataset) => dataset.id)).size).toBe(4);
    expect(captured.map!.datasets.slice(1).every((dataset) => dataset.provenance === "imported")).toBe(true);
    await user.click(screen.getByText("More tools", { exact: true }));
    expect(screen.getByRole("button", { name: "Remove Official S-PLUS tiles.csv" })).toBeEnabled();
    const [official, first, second] = captured.map!.datasets;
    await user.click(screen.getAllByRole("button", { name: "Remove local.csv" })[0]);
    expect(captured.map!.datasets.slice(0, 2)).toEqual([official, second]);
    expect(captured.map!.tiles.some((tile) => tile.dataset_id === first.id)).toBe(false);
  });

  it("uses every loaded catalogue in coverage even when all source layers are hidden", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n150.1,-30\n", "high_latitude.csv"));
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n150.2,-30\n", "extension.csv"));
    await user.click(screen.getByText("More tools", { exact: true }));
    for (const dataset of captured.map!.datasets) await user.click(screen.getByRole("checkbox", { name: `Show ${dataset.filename}` }));
    expect(captured.map!.tiles).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Covered region" }));
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    await screen.findByRole("heading", { name: "Proposal preview" });
    expect(screen.getByText("Existing contributors").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Already covered").parentElement).toHaveTextContent("100.0%");
    const preview = screen.getByRole("heading", { name: "Proposal preview" });
    await user.click(screen.getByRole("checkbox", { name: "Show high_latitude.csv" }));
    fireEvent.change(screen.getByLabelText("Color for extension.csv"), { target: { value: "#e6419c" } });
    expect(preview).toBeInTheDocument();
    expect(screen.getByText("Existing contributors").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Already covered").parentElement).toHaveTextContent("100.0%");
    await user.click(screen.getByRole("button", { name: "Remove extension.csv" }));
    expect(screen.queryByRole("heading", { name: "Proposal preview" })).toBeNull();
  });

  it("retains accepted proposals and export, and avoids science recomputation for display changes", async () => {
    const coverage = vi.spyOn(api, "measureCoverage");
    const download = vi.spyOn(api, "downloadCatalogue").mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n151,-31\n"));
    await user.click(screen.getByRole("button", { name: "Covered region" }));
    await user.click(screen.getByText("More tools", { exact: true }));
    await user.click(screen.getByRole("button", { name: "Single tile" }));
    await user.click(screen.getByRole("button", { name: "Place sky center" }));
    await user.click(await screen.findByRole("button", { name: "Accept proposal" }));
    await waitFor(() => expect(coverage).toHaveBeenCalled());
    const accepted = captured.map!.tiles.filter((tile) => tile.source === "proposed");
    const calls = coverage.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Download new_tiles.csv" }));
    const exportBefore = download.mock.calls.at(-1);
    for (const name of ["local.csv", "Official S-PLUS tiles"]) {
      await user.click(screen.getByRole("checkbox", { name: `Show ${name}` }));
      fireEvent.change(screen.getByLabelText(`Color for ${name}`), { target: { value: "#b83ad5" } });
    }
    expect(coverage).toHaveBeenCalledTimes(calls);
    expect(captured.map!.tiles.filter((tile) => tile.source === "proposed")).toEqual(accepted);
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n153,-32\n", "extension.csv"));
    await waitFor(() => expect(coverage.mock.calls.length).toBeGreaterThan(calls));
    expect(coverage.mock.calls.at(-1)![1]).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Remove extension.csv" }));
    await user.click(screen.getByRole("button", { name: "Reload official catalogue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload official catalogue" })).toBeEnabled());
    expect(captured.map!.tiles.filter((tile) => tile.source === "proposed")).toEqual(accepted);
    await user.click(screen.getByRole("button", { name: "Download new_tiles.csv" }));
    expect(download.mock.calls.at(-1)).toEqual(exportBefore);
  });

  it("maps local coordinate columns without exposing instrument configuration", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("east,north\n151,-31\n"));
    await user.selectOptions(screen.getByRole("combobox", { name: "RA column" }), "east");
    await user.selectOptions(screen.getByRole("combobox", { name: "DEC column" }), "north");
    await user.click(screen.getByRole("button", { name: "Load mapped catalogue" }));
    await waitFor(() => expect(captured.map!.datasets[1].tiles[0].ra_deg).toBe(151));
    expect(captured.map!.datasets[1].instrument_profile_id).toBe("t80-south");
  });

  it("starts fresh and can reload official tiles", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.click(screen.getByRole("button", { name: "New plan" }));
    await user.click(screen.getByRole("button", { name: "Discard and start new" }));
    expect(captured.map!.datasets).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Reload official catalogue" })); await loaded();
    expect(captured.map!.datasets[0].filename).toBe("Official S-PLUS tiles");
  });

  it("shows the planning sequence and tucks alternative tools behind a disclosure", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    const steps = screen.getByRole("list", { name: "Planning steps" });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain("Area");
    expect(document.querySelector(".advanced-tools")?.hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("More tools", { exact: true }));
    expect(screen.getByRole("button", { name: "Single tile" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Import centers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Map layers" })).toBeTruthy();
    expect(document.querySelector(".advanced-layers")?.hasAttribute("open")).toBe(false);
    await user.click(screen.getByText("Scientific overlays", { exact: true }));
    expect(screen.getByRole("checkbox", { name: "Show Inference anchors" })).toBeEnabled();
  });

  it("retains Single tile and Import centers with reversible proposals", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    expect(screen.getByRole("radio", { name: /Complete coverage/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Efficient coverage/ })).toBeEnabled();
    await user.click(screen.getByText("More tools", { exact: true }));
    expect(screen.getByRole("heading", { name: "Import centers" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Single tile" }));
    await user.click(screen.getByRole("button", { name: "Place sky center" }));
    await screen.findByRole("button", { name: "Accept proposal" });
    await user.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(captured.map!.tiles.filter((tile) => tile.source === "proposed")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Place sky center" }));
    await user.click(await screen.findByRole("button", { name: "Accept proposal" }));
    await user.click(screen.getByRole("button", { name: "Disable all" }));
    expect(screen.getByRole("button", { name: "Download new_tiles.csv" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Restore all" }));
    expect(screen.getByRole("button", { name: "Download new_tiles.csv" })).toBeEnabled();
  });

  it("exposes no generic survey, instrument, profile or placement controls", async () => {
    render(<App />); await loaded();
    for (const label of ["Output profile", "Create profile", "Import profile", "Export strategy JSON", "Import project", "Export project", "Regional mosaic", "Preview lattice", "Catalogue instrument", "Inference participation", "Plan/session PA", "Coverage geometry basis"]) {
      expect(screen.queryByText(label, { exact: false })).toBeNull();
    }
    expect(screen.queryByRole("combobox", { name: /instrument|profile|inference|epoch/i })).toBeNull();
  });

  it("retains imports when official startup completes late", async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const user = userEvent.setup(); render(<App />);
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n151,-31\n"));
    await act(async () => { resolve({ ok: true, text: async () => csv }); });
    expect(captured.map!.datasets.map((dataset) => dataset.filename)).toEqual(["Official S-PLUS tiles", "local.csv"]);
    expect(captured.map!.datasets[1].tiles[0].ra_deg).toBe(151);
  });
  it("appends a slow upload even when official startup finishes during parsing", async () => {
    let resolveOfficial!: (response: unknown) => void;
    let resolveUpload!: (bytes: ArrayBuffer) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolveOfficial = done; })));
    const input = file("RA,DEC\n151,-31\n");
    Object.defineProperty(input, "arrayBuffer", { configurable: true, value: () => new Promise<ArrayBuffer>((done) => { resolveUpload = done; }) });
    const user = userEvent.setup(); render(<App />);
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), input);
    await act(async () => { resolveOfficial({ ok: true, text: async () => csv }); });
    expect(captured.map!.datasets).toHaveLength(1);
    await act(async () => { resolveUpload(new TextEncoder().encode("RA,DEC\n151,-31\n").buffer); });
    expect(captured.map!.datasets.map((dataset) => dataset.filename)).toEqual(["Official S-PLUS tiles", "local.csv"]);
  });

  it("retains imports added while an official reload is pending", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    const official = captured.map!.datasets[0];
    let resolve!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    await user.click(screen.getByRole("button", { name: "Reload official catalogue" }));
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n151,-31\n"));
    const imported = captured.map!.datasets[1];
    await act(async () => { resolve({ ok: true, text: async () => csv.replace("150,-30", "154,-32") }); });
    expect(captured.map!.datasets).toHaveLength(2);
    expect(captured.map!.datasets[0]).toMatchObject({ id: official.id, color: official.color, provenance: "official" });
    expect(captured.map!.datasets[0].tiles[0].ra_deg).toBe(154);
    expect(captured.map!.datasets[1]).toEqual(imported);
  });

  it("preserves existing datasets on invalid coordinates and malformed CSV", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n151,-31\n"));
    const previous = captured.map!.datasets;
    for (const invalid of ['RA,DEC\n"broken', "RA,DEC\n151,100\n"]) {
      await user.upload(screen.getByLabelText("Choose catalogue CSV"), file(invalid));
      await screen.findByRole("alert");
      expect(captured.map!.datasets).toEqual(previous);
    }
  });

  it("does not cancel official startup when an upload fails", async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const user = userEvent.setup(); render(<App />);
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file('RA,DEC\n"broken'));
    await screen.findByRole("alert");
    await act(async () => { resolve({ ok: true, text: async () => csv }); }); await loaded();
    expect(captured.map!.datasets[0].filename).toBe("Official S-PLUS tiles");
  });

  it("rejects stale startup after New plan, including when a new official reload finishes first", async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole("button", { name: "New plan" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => csv }));
    await user.click(screen.getByRole("button", { name: "Reload official catalogue" })); await loaded();
    const current = captured.map!.datasets;
    await act(async () => { resolve({ ok: true, text: async () => csv.replace("150,-30", "20,10") }); });
    expect(captured.map!.datasets).toEqual(current);
  });

  it("keeps selected-region viewport priority when startup catalogue data arrive late", async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole("button", { name: "Covered region" }));
    await act(async () => { resolve({ ok: true, text: async () => csv }); }); await loaded();
    expect(captured.map!.focusRequest).toBe(0);
    expect(captured.map!.regionFocusRequest).toBe(1);
    expect(captured.map!.selectedPolygon).not.toBeNull();
  });

});
