import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
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
  Object.defineProperty(input, "arrayBuffer", { value: async () => new TextEncoder().encode(contents).buffer });
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

  it("manual catalogues replace official data and reload restores the current official catalogue", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file(csv));
    await waitFor(() => expect(captured.map!.datasets[0].filename).toBe("local.csv"));
    expect(captured.map!.datasets).toHaveLength(1);
    expect(captured.map!.datasets[0]).toMatchObject({ instrument_profile_id: "t80-south", inference_role: "auto" });
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file(csv));
    expect(captured.map!.tiles).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Reload official catalogue" })); await loaded();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(captured.map!.datasets[0].filename).toBe("Official S-PLUS tiles");
    expect(captured.map!.tiles).toHaveLength(1);
  });

  it("maps local coordinate columns without exposing instrument configuration", async () => {
    const user = userEvent.setup(); render(<App />); await loaded();
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("east,north\n151,-31\n"));
    await user.selectOptions(screen.getByRole("combobox", { name: "RA column" }), "east");
    await user.selectOptions(screen.getByRole("combobox", { name: "DEC column" }), "north");
    await user.click(screen.getByRole("button", { name: "Load mapped catalogue" }));
    await waitFor(() => expect(captured.map!.tiles[0].ra_deg).toBe(151));
    expect(captured.map!.datasets[0].instrument_profile_id).toBe("t80-south");
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

  it("ignores late startup data after a manual file replaces the working catalogue", async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const user = userEvent.setup(); render(<App />);
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file("RA,DEC\n151,-31\n"));
    await act(async () => { resolve({ ok: true, text: async () => csv }); });
    expect(captured.map!.datasets[0].filename).toBe("local.csv");
    expect(captured.map!.tiles[0].ra_deg).toBe(151);
  });
  it("keeps official reload available after an invalid upload cancels pending startup", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const user = userEvent.setup(); render(<App />);
    await user.upload(screen.getByLabelText("Choose catalogue CSV"), file('RA,DEC\n"broken'));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Reload official catalogue" })).toBeEnabled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => csv }));
    await user.click(screen.getByRole("button", { name: "Reload official catalogue" })); await loaded();
    expect(captured.map!.datasets[0].filename).toBe("Official S-PLUS tiles");
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
