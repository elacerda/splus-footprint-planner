import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOfficialCatalogue, OFFICIAL_CATALOGUE_URL, parseOfficialCatalogue } from "./official-catalogue";
import { createBundledProfileRegistry } from "./profiles/registry";
import bundledCsv from "./data/official/tiles_nc.csv?raw";

const csv = "PID,NAME,RA,DEC,EPOC,STATUS\nSPLUS,A,10:00:00,-30:00:00,2000,0\nSPLUS,B,151.4,-30,2000,1\nSPLUS,C,152.8,-30,2000,2\n";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("S-PLUS runtime and automatic official data", () => {
  it("registers only the unchanged protected instrument and survey", () => {
    const registry = createBundledProfileRegistry();
    expect(registry.listAnyInstrumentProfiles().map(({ id }) => id)).toEqual(["t80-south"]);
    expect(registry.listAnySurveyProfiles().map(({ id }) => id)).toEqual(["splus-t80-south"]);
    expect(registry.resolveInstrumentProfile("t80-south").footprint).toEqual({ type: "rectangle", width_deg: 1.4, height_deg: 1.4 });
    expect(registry.resolveSurveyProfile("splus-t80-south").tiling).toMatchObject({ type: "legacy_splus", effective_overlap_arcsec: 120 });
  });

  it("requests upstream main and parses all STATUS values without filtering", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => csv }); vi.stubGlobal("fetch", fetch);
    const result = await loadOfficialCatalogue();
    expect(fetch).toHaveBeenCalledWith(OFFICIAL_CATALOGUE_URL, { signal: expect.any(AbortSignal), cache: "no-cache" });
    expect(result.source).toBe("upstream");
    expect(result.catalogue.instrument_profile_id).toBe("t80-south");
    expect(result.catalogue.tiles.map(({ ra_deg }) => ra_deg)).toEqual([150, 151.4, 152.8]);
    expect(result.catalogue.tiles.map((tile) => tile.metadata.STATUS)).toEqual(["0", "1", "2"]);
  });

  it.each([
    ["network", () => Promise.reject(new Error("Offline"))],
    ["HTTP", async () => ({ ok: false, status: 503 })],
    ["invalid coordinates", async () => ({ ok: true, text: async () => csv.replace("10:00:00", "invalid") })],
    ["ambiguous columns", async () => ({ ok: true, text: async () => "RA,ra_deg,DEC\n150,150,-30\n" })],
    ["empty catalogue", async () => ({ ok: true, text: async () => "PID,NAME,RA,DEC,EPOC,STATUS\n" })],
    ["malformed quotes", async () => ({ ok: true, text: async () => 'PID,NAME,RA,DEC,EPOC,STATUS\n"invalid' })],
    ["HTML", async () => ({ ok: true, text: async () => "<html>Unavailable</html>" })],
  ])("uses the verified bundled snapshot on %s failure", async (_, response) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response));
    const result = await loadOfficialCatalogue();
    expect(result.source).toBe("fallback");
    expect(result.catalogue).toEqual(parseOfficialCatalogue(bundledCsv));
  });

  it.each(["request", "body"])("times out a hanging %s and still permits fallback", async (stage) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => stage === "request"
      ? new Promise(() => {}) : Promise.resolve({ ok: true, text: () => new Promise(() => {}) })));
    const loading = loadOfficialCatalogue(undefined, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect((await loading).source).toBe("fallback");
  });

  it("cancels a superseded load without installing fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    const controller = new AbortController();
    const loading = loadOfficialCatalogue(controller.signal);
    const assertion = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await assertion;
  });


});
