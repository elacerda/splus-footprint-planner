import { planningGeometryContext } from "./science/planning-operation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import splusLogo from "./assets/splus-logo.png";
import AladinMap, { type MapMode } from "./AladinMap";
import { RegionAuthoring } from "./RegionAuthoring";
import { ReferenceCoordinate } from "./ReferenceCoordinate";
import { validatePolygon } from "./science/geometry";
import { buildRegionPlanRequest, downloadCatalogue, measureCoverage, parseCenters, planRegion, proposeCenters, uploadCatalogue } from "./api";
import { createDataset } from "./datasets";
import { DEFAULT_PROFILE, profileRegistry, SPLUS_SURVEY_V2, T80_SOUTH_INSTRUMENT_V2 } from "./profiles";
import { loadOfficialCatalogue, OFFICIAL_CATALOGUE_NAME } from "./official-catalogue";
import type { PointingGeometryContext } from "./science/pointing-geometry";
import { CoverageUnavailableError } from "./science/coverage";
import { CoverageReadout as MetricsPanel } from "./CoverageReadout";
import type { AnyInstrumentProfile } from "./profiles/registry";
import type { CenterInput, CatalogueDataset, CatalogueResponse, CoverageStrategy, InferenceDiagnostics, CoverageResult, SkyPolygon, RegionPlanResponse, TileRecord } from "./types";
interface ProposalPreview {
  coverageStrategy: CoverageStrategy | null;
  tiles: TileRecord[];
  candidateCenters: CenterInput[];
  inference: InferenceDiagnostics | null;
  diagnostics: string[];
  metrics: CoverageResult | null;
  solution: string;
}

interface ColumnMapping {
  file: File;
  columns: string[];
  raColumn: string;
  decColumn: string;
  raUnit: "auto" | "degrees" | "hours";
}

const EMPTY_CENTERS: CenterInput[] = [];
const EMPTY_IDS: string[] = [];
const PREVIEW_PAGE_SIZE = 25;
const WORKFLOW_STEPS: ReadonlyArray<readonly [number, string]> = [
  [1, "Area"],
  [2, "Coverage"],
  [3, "Generate"],
  [4, "Review"],
];
type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "splus-footprint-planner-theme";

/** Render the fixed S-PLUS catalogue, planning, proposal and export workspace.
 * @returns Browser-only T80-South workspace with an automatic official catalogue.
 */
export default function App() {
  const activeSurvey = SPLUS_SURVEY_V2;
  const activeInstrument = T80_SOUTH_INSTRUMENT_V2;
  const profile = DEFAULT_PROFILE;
  const activePointingGeometryContext = useMemo(() => planningGeometryContext({
    coverageBasis: "single_exposure", outputInstrumentId: activeInstrument.id,
    outputStrategyId: activeSurvey.id,
  }, profileRegistry), [activeInstrument.id, activeSurvey.id]);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try { return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  const [datasets, setDatasets] = useState<CatalogueDataset[]>([]);
  const [catalogueSource, setCatalogueSource] = useState<"loading" | "upstream" | "fallback" | "manual" | "empty">("loading");
  const [fallbackWarning, setFallbackWarning] = useState(false);
  const catalogueAbortRef = useRef<AbortController | null>(null);
  const catalogueRevisionRef = useRef(0);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);
  const [coverageStrategy, setCoverageStrategy] = useState<CoverageStrategy>("complete");
  const [proposals, setProposals] = useState<TileRecord[]>([]);
  const [pending, setPending] = useState<ProposalPreview | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [proposalContext, setProposalContext] = useState<ProposalPreview | null>(null);
  const [activeMetrics, setActiveMetrics] = useState<CoverageResult | null>(null);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [referenceMarker, setReferenceMarker] = useState<Pick<CenterInput, "ra_deg" | "dec_deg"> | null>(null);
  const [projectSession, setProjectSession] = useState(0);
  const [regionPolygon, setRegionPolygon] = useState<SkyPolygon | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("idle");
  const [selectionRequest, setSelectionRequest] = useState(0);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [regionFocusRequest, setRegionFocusRequest] = useState(0);
  const [planningLayers, setPlanningLayers] = useState({ proposals: true, region: true, anchors: false, lattice: false });
  const [importText, setImportText] = useState("");
  const [parsedCenters, setParsedCenters] = useState<CenterInput[] | null>(null);
  const [scientificRefusal, setScientificRefusal] = useState<CoverageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [planningActive, setPlanningActive] = useState(false);
  const planningAbortRef = useRef<AbortController | null>(null);
  const busyRunRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingNewProject, setConfirmingNewProject] = useState(false);
  const [debugRequestJson, setDebugRequestJson] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProjectButtonRef = useRef<HTMLButtonElement>(null);
  const cancelNewProjectRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLElement>(null);
  const proposalBatchRef = useRef(0);
  const regionRevisionRef = useRef(0);
  const selectedRegionRef = useRef<SkyPolygon | null>(null);
  const originalTiles = useMemo(() => datasets.flatMap((dataset) => dataset.tiles.map((tile) => ({
    ...tile, instrument_profile_id: activeInstrument.id, inference_role: "auto" as const,
  }))), [datasets, activeInstrument.id]);
  const planningOriginalTiles = originalTiles;
  const activeOutputProposals = proposals;
  const enabledProposals = useMemo(() => proposals.filter((tile) => tile.enabled !== false), [proposals]);
  const visibleTiles = useMemo(() => [
    ...originalTiles.filter((tile) => datasets.find((dataset) => dataset.id === tile.dataset_id)?.visible),
    ...(planningLayers.proposals ? proposals : []),
  ], [datasets, originalTiles, planningLayers.proposals, proposals]);
  const planningTiles = useMemo(() => [...originalTiles, ...enabledProposals], [originalTiles, enabledProposals]);
  const mapTiles = useMemo(() => pending && planningLayers.proposals ? [...visibleTiles, ...pending.tiles] : visibleTiles,
    [pending, planningLayers.proposals, visibleTiles]);
  const activeContext = pending ?? proposalContext;
  const selectedTile = mapTiles.find((tile) => tile.id === selectedTileId) ?? null;
  const anchors = useMemo(() => {
    const ids = new Set(activeContext?.inference?.anchor_tile_ids ?? []);
    return planningTiles.filter((tile) => ids.has(tile.id));
  }, [activeContext, planningTiles]);
  const hasCatalogue = datasets.length > 0;
  const hasProjectContent = Boolean(datasets.length || columnMapping || proposals.length || pending || regionPolygon || referenceMarker || importText || parsedCenters);
  const currentWorkflowStep = pending || proposals.length > 0 ? 4 : planningActive ? 3 : regionPolygon ? 2 : 1;
  const previewPageCount = Math.max(1, Math.ceil((pending?.tiles.length ?? 0) / PREVIEW_PAGE_SIZE));
  const currentPreviewPage = Math.min(previewPage, previewPageCount - 1);
  const previewStart = currentPreviewPage * PREVIEW_PAGE_SIZE;
  const previewEnd = Math.min(previewStart + PREVIEW_PAGE_SIZE, pending?.tiles.length ?? 0);

  useEffect(() => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Session theme remains usable. */ }
  }, [theme]);

  useEffect(() => setPreviewPage(0), [pending]);

  useEffect(() => {
    const controller = new AbortController();
    const revision = ++catalogueRevisionRef.current;
    catalogueAbortRef.current = controller;
    void loadOfficialCatalogue(controller.signal).then(({ catalogue, source }) => {
      if (controller.signal.aborted || revision !== catalogueRevisionRef.current) return;
      setDatasets([createDataset(catalogue, 0, crypto.randomUUID(), "t80-south")]);
      if (!selectedRegionRef.current) setFocusRequest((previous) => previous + 1);
      setCatalogueSource(source); setFallbackWarning(source === "fallback");
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load official tiles.");
    });
    return () => { catalogueAbortRef.current?.abort(); planningAbortRef.current?.abort(); };
  }, []);

  useEffect(() => () => { planningAbortRef.current?.abort(); }, [regionPolygon, planningTiles, coverageStrategy]);

  useEffect(() => {
    if (!regionPolygon || !activeOutputProposals.length) { setActiveMetrics(null); return; }
    const controller = new AbortController();
    setActiveMetrics(null);
    void measureCoverage(regionPolygon, planningOriginalTiles, activeOutputProposals, activeSurvey.id,
      undefined, activePointingGeometryContext, controller.signal)
      .then((metrics) => { if (!controller.signal.aborted) setActiveMetrics(metrics); })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof CoverageUnavailableError) setScientificRefusal(caught.result);
        else setError(caught instanceof Error ? caught.message : "Could not update coverage.");
      });
    return () => controller.abort();
  }, [regionPolygon, planningOriginalTiles, activeOutputProposals, activeSurvey.id, activePointingGeometryContext]);
  useEffect(() => {
    if (confirmingNewProject) cancelNewProjectRef.current?.focus();
  }, [confirmingNewProject]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (confirmingNewProject) {
          setConfirmingNewProject(false);
          newProjectButtonRef.current?.focus();
          return;
        }
        setMapMode("idle");
        setSelectingRegion(false);
        setNotice(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmingNewProject]);

  async function runBusy<T>(work: () => Promise<T>, success?: (result: T) => void, isCurrent = () => true) {
    const run = ++busyRunRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    setScientificRefusal(null);
    try {
      const result = await work();
      if (isCurrent()) success?.(result);
    } catch (caught) {
      if (!isCurrent()) return;
      if (caught instanceof CoverageUnavailableError) setScientificRefusal(caught.result);
      else setError(caught instanceof Error ? caught.message : "The request could not be completed.");
    } finally {
      if (run === busyRunRef.current) setBusy(false);
    }
  }

  /** Replace the working catalogue atomically; alternate files never stack on official data. */
  function applyCatalogue(result: CatalogueResponse) {
    if (result.needs_mapping) return;
    regionRevisionRef.current += 1;
    planningAbortRef.current?.abort();
    setColumnMapping(null);
    setDatasets([createDataset(result, 0, crypto.randomUUID(), activeInstrument.id)]);
    if (!regionPolygon) setFocusRequest((previous) => previous + 1);
    setPending(null); setProposalContext(null); setActiveMetrics(null);
    setScientificRefusal(null); setSelectedTileId(null); setDebugRequestJson("");
    setNotice(`${result.row_count.toLocaleString()} catalogue rows loaded from ${result.filename}.`);
    setError(null);
  }

  /** Fetch fresh official data; a revision guard prevents late startup responses replacing uploads. */
  async function reloadOfficialCatalogue() {
    const revision = ++catalogueRevisionRef.current;
    catalogueAbortRef.current?.abort();
    const controller = new AbortController();
    catalogueAbortRef.current = controller;
    setCatalogueSource("loading");
    try {
      const result = await loadOfficialCatalogue(controller.signal);
      if (controller.signal.aborted || revision !== catalogueRevisionRef.current) return;
      applyCatalogue(result.catalogue);
      setCatalogueSource(result.source); setFallbackWarning(result.source === "fallback");
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load the official catalogue.");
    }
  }

  async function handleUpload(file?: File) {
    if (!file) return;
    catalogueRevisionRef.current += 1;
    catalogueAbortRef.current?.abort();
    // Failed uploads must not leave a cancelled startup marked as still loading.
    if (catalogueSource === "loading") setCatalogueSource(datasets.length
      ? datasets[0].filename === OFFICIAL_CATALOGUE_NAME ? fallbackWarning ? "fallback" : "upstream" : "manual"
      : "empty");
    const revision = catalogueRevisionRef.current;
    await runBusy(() => uploadCatalogue(file), (result) => {
      if (result.needs_mapping) {
        setColumnMapping({ file, columns: result.columns ?? [], raColumn: "", decColumn: "", raUnit: "auto" });
        setNotice("Choose the RA and DEC columns for this catalogue.");
      } else { applyCatalogue(result); setFallbackWarning(false); setCatalogueSource("manual"); }
    }, () => revision === catalogueRevisionRef.current);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  async function applyColumnMapping() {
    if (!columnMapping || !columnMapping.raColumn || !columnMapping.decColumn) return;
    await runBusy(
      () => uploadCatalogue(columnMapping.file, columnMapping),
      (result) => { applyCatalogue(result); setFallbackWarning(false); setCatalogueSource("manual"); },
    );
  }

  async function stageCenters(centers: CenterInput[], method: "manual" | "imported_centers"): Promise<boolean> {
    const revision = regionRevisionRef.current;
    let staged = false;
    await runBusy(() => proposeCenters(centers, method), (tiles) => {
      staged = true;
      setPending({ coverageStrategy: null,
        tiles: tiles.map((tile) => ({ ...tile, instrument_profile_id: activeInstrument.id, output_strategy_id: activeSurvey.id })),
        candidateCenters: centers, inference: null, diagnostics: [method === "manual" ? "Manual sky positions are ready for review." : "Imported centers are ready for review."], metrics: null, solution: method });
      setMapMode("idle"); setSelectedTileId(null);
      setNotice(`${tiles.length} centers staged for review.`);
    }, () => revision === regionRevisionRef.current);
    return staged;
  }
  async function handleParseCenters() {
    await runBusy(() => parseCenters(importText), (result) => {
      setParsedCenters(result);
      setNotice(`${result.length} valid center${result.length === 1 ? "" : "s"} parsed. Review the list, then stage it.`);
    });
  }

  async function handleStageImported() {
    if (!parsedCenters) return;
    if (await stageCenters(parsedCenters, "imported_centers")) setParsedCenters(null);
  }

  async function handlePlanRegion() {
    if (!regionPolygon) return;
    const regionRevision = regionRevisionRef.current;
    planningAbortRef.current?.abort();
    const controller = new AbortController();
    planningAbortRef.current = controller;
    setPlanningActive(true);
    setPending(null);
    setSelectingRegion(false);
    if (import.meta.env.DEV) {
      setDebugRequestJson(JSON.stringify(buildRegionPlanRequest(regionPolygon, planningTiles, activeSurvey.id, undefined, coverageStrategy)));
    }
    await runBusy(
      () => planRegion(regionPolygon, planningTiles, activeSurvey.id, undefined, coverageStrategy, activePointingGeometryContext, undefined, controller.signal),
      (result: RegionPlanResponse) => {
        if (regionRevision !== regionRevisionRef.current) return;
        setPending({
          coverageStrategy: result.coverage_strategy,
          tiles: result.tiles.map((tile) => ({ ...tile, instrument_profile_id: activeInstrument.id, output_strategy_id: activeSurvey.id })),
          candidateCenters: result.candidate_centers,
          inference: result.inference,
          diagnostics: result.diagnostics,
          metrics: result.metrics,
          solution: result.solution,
        });
        setSelectedTileId(null);
        setNotice(
          `${result.tiles.length} S-PLUS tile${result.tiles.length === 1 ? "" : "s"} selected. Sampled coverage: ${Math.round(result.metrics.selected_region_coverage * 100)}%.`,
        );
      },
      () => regionRevision === regionRevisionRef.current && planningAbortRef.current === controller && !controller.signal.aborted,
    );
    if (planningAbortRef.current === controller) { planningAbortRef.current = null; setPlanningActive(false); }
  }

  /** Terminate the current operation without publishing a partial plan or editing inputs. */
  function cancelPlanningRun() {
    planningAbortRef.current?.abort();
    planningAbortRef.current = null;
    busyRunRef.current += 1;
    setPlanningActive(false);
    setBusy(false);
    setNotice("Planning cancelled; selected region retained.");
  }

  function changeCoverageStrategy(strategy: CoverageStrategy) {
    if (strategy === coverageStrategy) return;
    regionRevisionRef.current += 1;
    setCoverageStrategy(strategy);
    setPending((current) => current?.coverageStrategy ? null : current);
    setDebugRequestJson("");
  }

  function acceptPreview() {
    if (!pending) return;
    const batch = ++proposalBatchRef.current;
    const proposalsToAdd = pending.tiles.map((tile) => ({
      ...tile,
      id: `proposal-${batch}-${tile.id}`,
      instrument_profile_id: activeInstrument.id,
      output_strategy_id: activeSurvey.id,
      source: "proposed" as const,
      enabled: true,
    }));
    setProposals((previous) => [...previous, ...proposalsToAdd]);
    setProposalContext(pending);
    setPending(null);
    setSelectedTileId(null);
    setNotice(`${proposalsToAdd.length} proposed tile${proposalsToAdd.length === 1 ? "" : "s"} accepted.`);
  }

  function cancelPreview() {
    setPending(null);
    setNotice("Proposal preview cancelled.");
  }

  function toggleProposal(id: string) {
    setProposals((previous) => previous.map((tile) => tile.id === id
      ? { ...tile, enabled: tile.enabled === false }
      : tile));
  }

  function clearProposals() {
    const activeIds = new Set(activeOutputProposals.map((tile) => tile.id));
    setProposals((previous) => previous.filter((tile) => !activeIds.has(tile.id)));
    setPending(null);
    setProposalContext(null);
    setSelectedTileId(null);
    setActiveMetrics(null);
    setNotice("Accepted proposals cleared.");
  }

  /** Clear the working catalogue, region and proposals; keep official catalogue reload available. */
  function startNewProject() {
    if (busy && !planningActive) return;
    planningAbortRef.current?.abort();
    planningAbortRef.current = null;
    if (planningActive) {
      busyRunRef.current += 1;
      setBusy(false);
      setPlanningActive(false);
    }
    regionRevisionRef.current += 1;
    proposalBatchRef.current = 0;
    catalogueRevisionRef.current += 1;
    catalogueAbortRef.current?.abort();
    setDatasets([]); setCatalogueSource("empty"); setFallbackWarning(false);
    setColumnMapping(null);
    setProposals([]);
    setPending(null);
    setProposalContext(null);
    setActiveMetrics(null);
    setScientificRefusal(null);
    setSelectedTileId(null);
    selectedRegionRef.current = null;
    setRegionPolygon(null);
    setMapMode("idle");
    setSelectingRegion(false);
    setImportText("");
    setParsedCenters(null);
    setCoverageStrategy("complete");
    setDebugRequestJson("");
    setConfirmingNewProject(false);
    setError(null);
    setReferenceMarker(null);
    setProjectSession((previous) => previous + 1);
    setNotice("Fresh S-PLUS plan started. Reload official tiles when needed.");
    if (fileInputRef.current) fileInputRef.current.value = "";
    newProjectButtonRef.current?.focus();
  }

  function requestNewProject() {
    if (busy && !planningActive) return;
    if (hasProjectContent) {
      setConfirmingNewProject(true);
      return;
    }
    startNewProject();
  }

  /** Apply canonical region input and invalidate its derived previews/diagnostics.
   * @param region - Validated ICRS polygon, or null when clearing/redrawing.
   * @throws Before mutation if a non-null polygon violates the frozen contract.
   * Accepted pointings remain explicit user data; their coverage is recomputed.
   */
  function applySelectedRegion(region: SkyPolygon | null) {
    if (region) validatePolygon(region);
    regionRevisionRef.current += 1;
    selectedRegionRef.current = region;
    setRegionPolygon(region);
    if (region) setRegionFocusRequest((previous) => previous + 1);
    setSelectingRegion(false);
    setMapMode("idle");
    setPending(null);
    setProposalContext(null);
    setActiveMetrics(null);
    setScientificRefusal(null);
    setDebugRequestJson("");
    setSelectedTileId((current) => pending?.tiles.some((tile) => tile.id === current) ? null : current);
    setError(null);
    setNotice(region ? "Sky polygon finalized. Generate a plan when ready." : "Selected polygon cleared; catalogues and proposals remain.");
  }

  function beginRegionSelection() {
    applySelectedRegion(null);
    setSelectingRegion(true);
    setSelectionRequest((previous) => previous + 1);
    setNotice("Click successive sky points, then finish the polygon.");
  }

  function cancelRegionDrawing() {
    setSelectingRegion(false);
    setNotice("Polygon drawing cancelled.");
  }

  function clearRegionSelection() {
    applySelectedRegion(null);
  }

  function setAllProposals(enabled: boolean) {
    const activeIds = new Set(activeOutputProposals.map((tile) => tile.id));
    setProposals((previous) => previous.map((tile) => activeIds.has(tile.id) ? { ...tile, enabled } : tile));
    setNotice(enabled ? "All pointings were restored." : "All pointings were disabled.");
  }

  async function exportFile() {
    await runBusy(() => downloadCatalogue(enabledProposals, activeSurvey.id, "2000", profileRegistry, activePointingGeometryContext, "nominal"),
      () => setNotice("new_tiles.csv downloaded."));
  }
  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-logo" src={splusLogo} alt="S-PLUS" width={42} height={42} />
          <div className="brand-copy">
            <h1 className="brand-title">S-PLUS Footprint Planner</h1>
            <span className="brand-profile">T80-South pointing &amp; coverage planning</span>
          </div>
        </div>
        <div className="topbar-state">
          <span className="topbar-state-copy">
            <span className={`status-dot ${activeInstrument ? "is-ready" : ""}`} />
            <span className="topbar-state-label">{catalogueSource === "loading" ? "Loading official S-PLUS tiles…" : datasets[0]?.filename ?? "Ready for a fresh plan"}</span>
          </span>
          {hasCatalogue && <span className="topbar-count">{originalTiles.length.toLocaleString()} original tiles</span>}
        </div>
        <div className="topbar-actions">
          <button
            className="button theme-toggle"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-pressed={theme === "dark"}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
            <span className="theme-toggle-label">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <button ref={newProjectButtonRef} className="button button-quiet new-project-button" type="button" onClick={requestNewProject} disabled={busy && !planningActive}>
            New plan
          </button>
          <button className="button button-primary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <Icon name="upload" /> Load catalogue
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose catalogue CSV"
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
        </div>
      </header>

      {confirmingNewProject && (
        <div className="message-bar is-notice new-project-confirmation" role="alertdialog" aria-labelledby="new-project-confirmation-title" aria-describedby="new-project-confirmation-description">
          <span><strong id="new-project-confirmation-title">Discard this project?</strong> <span id="new-project-confirmation-description">Catalogues, pointings, and planning state will be cleared.</span></span>
          <div className="new-project-confirmation-actions">
            <button ref={cancelNewProjectRef} className="button button-outline" type="button" onClick={() => {
              setConfirmingNewProject(false);
              newProjectButtonRef.current?.focus();
            }}>Cancel</button>
            <button className="button button-danger" type="button" onClick={startNewProject} disabled={busy && !planningActive}>Discard and start new</button>
          </div>
        </div>
      )}

      {(error || notice) && (
        <div className={`message-bar ${error ? "is-error" : "is-notice"}`} role={error ? "alert" : "status"}>
          <span>{error ?? notice}</span>
          <button aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}>×</button>
        </div>
      )}

      <section className="workspace">
        <aside className="control-panel panel-scroll" aria-label="Catalogue and planning controls" tabIndex={0}>
          <section className="panel-section catalog-section">
            <SectionHeading title="Existing catalogue" trailing={hasCatalogue ? "LOADED" : "OPTIONAL"} />
            <div className="catalogue-summary">
              <span className="summary-number">{originalTiles.length.toLocaleString()}</span>
              <span className="summary-label">original tile centers</span>
            </div>
            <p className="panel-copy">{datasets[0]?.filename === OFFICIAL_CATALOGUE_NAME
              ? "Loaded from splus-collab/splus-utilities. All survey tiles contribute to coverage."
              : "Load a local S-PLUS CSV to replace the working catalogue."}</p>
            <button className="button button-outline button-full" disabled={busy || catalogueSource === "loading"} onClick={() => void reloadOfficialCatalogue()}>Reload official catalogue</button>
            {fallbackWarning && <p className="fine-print" role="status">Using bundled official S-PLUS tiles because the current catalogue could not be reached. Planning remains available.</p>}
            {columnMapping && (
              <div className="column-mapping">
                <strong>Map coordinates in {columnMapping.file.name}</strong>
                <label>RA column
                  <select aria-label="RA column" value={columnMapping.raColumn} onChange={(event) => setColumnMapping({ ...columnMapping, raColumn: event.target.value })}>
                    <option value="">Choose RA</option>
                    {columnMapping.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                  </select>
                </label>
                <label>DEC column
                  <select aria-label="DEC column" value={columnMapping.decColumn} onChange={(event) => setColumnMapping({ ...columnMapping, decColumn: event.target.value })}>
                    <option value="">Choose DEC</option>
                    {columnMapping.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                  </select>
                </label>
                <label>Numeric RA unit
                  <select aria-label="Numeric RA unit" value={columnMapping.raUnit} onChange={(event) => setColumnMapping({ ...columnMapping, raUnit: event.target.value as ColumnMapping["raUnit"] })}>
                    <option value="auto">Auto: decimal degrees, sexagesimal hours</option>
                    <option value="degrees">Degrees</option>
                    <option value="hours">Hours</option>
                  </select>
                </label>
                <button className="button button-primary button-full" disabled={!columnMapping.raColumn || !columnMapping.decColumn || columnMapping.raColumn === columnMapping.decColumn || busy} onClick={() => void applyColumnMapping()}>Load mapped catalogue</button>
              </div>
            )}
          </section>

          <section className="panel-section planning-section">
            <SectionHeading title="Plan a region" trailing={regionPolygon ? "AREA SET" : undefined} />
            <ol className="planning-progress" aria-label="Planning steps">
              {WORKFLOW_STEPS.map(([step, label]) => (
                <li key={step} className={step < currentWorkflowStep ? "is-complete" : step === currentWorkflowStep ? "is-current" : undefined}
                  aria-current={step === currentWorkflowStep ? "step" : undefined}>
                  <span>{step}</span><strong>{label}</strong>
                </li>
              ))}
            </ol>
            <p className="panel-copy workflow-intro">Choose a polygon or rectangle to define the sky area.</p>
            <RegionAuthoring key={`region-${projectSession}`} polygonLabel="Select area" selecting={selectingRegion}
              onPolygon={beginRegionSelection} onCancelPolygon={cancelRegionDrawing} onApply={applySelectedRegion} disabled={busy} />
            <ReferenceCoordinate key={`reference-${projectSession}`} marker={referenceMarker} onChange={setReferenceMarker} />
            {regionPolygon ? <div className="region-summary">
              <div className="coordinate-row"><span>Selected polygon</span><strong>{regionPolygon.vertices.length} vertices · finalized</strong></div>
              <div className="region-actions"><button className="button button-outline" onClick={beginRegionSelection} disabled={busy}>Redraw polygon</button>
                <button className="button button-quiet" onClick={clearRegionSelection}>Clear selection</button></div>
              {import.meta.env.DEV && <details className="development-plan-input"><summary>Development: plan input</summary><pre>{JSON.stringify(regionPolygon.vertices, null, 2)}</pre><button className="text-button" disabled={!debugRequestJson} onClick={() => {
                void navigator.clipboard.writeText(debugRequestJson).then(() => setNotice("Last plan request JSON copied.")).catch(() => setError("Could not copy the plan request JSON."));
              }}>Copy last plan request JSON</button></details>}
            </div> : null}
            <fieldset className="coverage-strategy"><legend>Coverage strategy</legend>
              <label><input type="radio" name="coverage-strategy" checked={coverageStrategy === "complete"} onChange={() => changeCoverageStrategy("complete")} /><span><strong>Complete coverage (default)</strong><small>Attempts to cover every sampled point in the selected region.</small></span></label>
              <label><input type="radio" name="coverage-strategy" checked={coverageStrategy === "efficient"} onChange={() => changeCoverageStrategy("efficient")} /><span><strong>Efficient coverage</strong><small>Uses the S-PLUS coverage floor and marginal efficiency threshold to save tiles.</small></span></label>
              <p className="fine-print">Efficient may leave small residual gaps. Choose Complete for exhaustive sampled coverage.</p>
            </fieldset>
            <div className="generate-step-label"><span>Next step</span><strong>Generate and review the proposal</strong></div>
            <button className="button button-plan" onClick={() => void handlePlanRegion()} disabled={!regionPolygon || busy || catalogueSource === "loading"}>{busy ? <span className="spinner" /> : <Icon name="spark" />}Generate plan</button>
            {planningActive && <button className="button button-quiet button-full" onClick={cancelPlanningRun}>Cancel planning</button>}
            <p className="fine-print">Tiles can extend beyond the selected area to preserve the S-PLUS grid.</p>
          </section>

          <details className="advanced-tools">
            <summary className="advanced-tools-summary">
              <span>More tools</span>
              <span>Single tile · Import centers · Map layers</span>
            </summary>
            <div className="advanced-tools-content">
              <section className="panel-section single-tile-section">
                <SectionHeading title="Place a single tile" />
                <p className="panel-copy">Click a position on the map to stage one center for review.</p>
                <button className="button button-outline button-full" aria-pressed={mapMode === "add-tile"}
                  onClick={() => { setMapMode(mapMode === "add-tile" ? "idle" : "add-tile"); setSelectingRegion(false); }} disabled={busy}>
                  <Icon name="crosshair" /> Single tile
                </button>
              </section>

              <section ref={importRef} className="panel-section import-section">
                <SectionHeading title="Import centers" />
                <p className="panel-copy">Paste RA/DEC pairs for tiles that are already selected.</p>
                <label className="visually-hidden" htmlFor="centers-text">RA and DEC pairs</label>
                <textarea
                  id="centers-text"
                  value={importText}
                  onChange={(event) => { setImportText(event.target.value); setParsedCenters(null); }}
                  placeholder={"RA, DEC\n10:03:05, -23:54:31\n150.5, -24.25"}
                  rows={4}
                  disabled={busy}
                />
                <button className="button button-outline button-full" onClick={() => void handleParseCenters()} disabled={busy || !importText.trim()}>
                  Validate and preview
                </button>
                {parsedCenters && (
                  <div className="import-preview">
                    <strong>{parsedCenters.length} centers parsed</strong>
                    <div className="preview-coordinate-list">
                      {parsedCenters.slice(0, 4).map((center, index) => (
                        <span key={`${center.ra_deg}-${index}`}>{center.ra_deg.toFixed(5)}°, {center.dec_deg.toFixed(5)}°</span>
                      ))}
                      {parsedCenters.length > 4 && <span>and {parsedCenters.length - 4} more</span>}
                    </div>
                    <button className="button button-primary button-full" onClick={() => void handleStageImported()} disabled={busy}>Stage import preview</button>
                  </div>
                )}
              </section>

              <section className="panel-section layers-section">
                <SectionHeading title="Map layers" />
                <div className="layer-group-heading">Data</div>
                {datasets.map((dataset) => (
                  <div key={dataset.id}>
                    <label className="dataset-layer">
                      <input type="checkbox" aria-label={`Show ${dataset.filename}`} checked={dataset.visible} onChange={(event) => {
                        setDatasets((previous) => previous.map((item) => item.id === dataset.id ? { ...item, visible: event.target.checked } : item));
                        setSelectedTileId(null);
                      }} />
                      <span className="layer-swatch" style={{ "--swatch": dataset.color } as CSSProperties} />
                      <span title={dataset.filename}>{dataset.filename}</span>
                      <strong>{dataset.tiles.length.toLocaleString()}</strong>
                    </label>
                  </div>
                ))}
                <div className="layer-group-heading">Planning</div>
                <PlanningLayer label="Proposed tiles" color="var(--orange)" checked={planningLayers.proposals}
                  count={activeOutputProposals.length + (pending?.tiles.length ?? 0)} onChange={(checked) => {
                    setPlanningLayers((previous) => ({ ...previous, proposals: checked }));
                    setSelectedTileId(null);
                  }} />
                <PlanningLayer label="Selected region" color="var(--yellow)" checked={planningLayers.region}
                  onChange={(checked) => setPlanningLayers((previous) => ({ ...previous, region: checked }))} />
                <details className="advanced-layers">
                  <summary><span>Scientific overlays</span><span>2</span></summary>
                  <PlanningLayer label="Inference anchors" color="var(--violet)" checked={planningLayers.anchors}
                    count={activeContext?.inference?.anchor_tile_ids.length ?? 0}
                    onChange={(checked) => setPlanningLayers((previous) => ({ ...previous, anchors: checked }))} />
                  <PlanningLayer label="Candidate lattice" color="var(--green)" checked={planningLayers.lattice}
                    count={activeContext?.candidateCenters.length ?? 0}
                    onChange={(checked) => setPlanningLayers((previous) => ({ ...previous, lattice: checked }))} />
                </details>
                <p className="fine-print">Visibility only affects the map. Hidden catalogues still contribute to plans; disabled proposals appear as gray crosses.</p>
              </section>
            </div>
          </details>
        </aside>

        <section className="map-column" aria-label="Sky viewer">
          <div className="map-toolbar">
            <div className="map-title-block">
              <span className="map-live-mark"><span /></span>
              <div><strong>Sky footprint</strong><small>ICRS · equatorial</small></div>
            </div>
            <div className="map-toolbar-center">
              {mapMode === "add-tile" ? <span className="interaction-pill is-add">PLACE TILE · CLICK SKY</span> :
                selectingRegion ? <span className="interaction-pill">CLICK POLYGON VERTICES</span> :
                pending?.solution === "profile_fallback" ? <span className="interaction-pill is-fallback">S-PLUS GRID FALLBACK</span> :
                pending?.solution === "extended_existing_grid" ? <span className="interaction-pill is-extended">EXISTING GRID EXTENDED</span> :
                <span className="interaction-pill is-idle">PAN · ZOOM · INSPECT</span>}
            </div>
            {hasCatalogue && (
              <button className="map-count-button" onClick={() => setFocusRequest((previous) => previous + 1)} title="Center on catalogue footprint">
                <Icon name="target" /> {visibleTiles.length.toLocaleString()} tiles
              </button>
            )}
          </div>
          <AladinMap
            tiles={mapTiles}
            datasets={datasets}
            profile={profile}
            mode={mapMode}
            selectingRegion={selectingRegion}
            selectionRequest={selectionRequest}
            focusRequest={focusRequest}
            regionFocusRequest={regionFocusRequest}
            selectedTileId={selectedTileId}
            selectedPolygon={regionPolygon}
            referenceMarker={referenceMarker}
            planningLayers={planningLayers}
            anchorTileIds={activeContext?.inference?.anchor_tile_ids ?? EMPTY_IDS}
            candidateCenters={activeContext?.candidateCenters ?? EMPTY_CENTERS}
            pointingGeometryContext={activePointingGeometryContext}
            onSkyClick={(ra, dec) => void stageCenters([{ ra_deg: ra, dec_deg: dec, label: "Manual sky click" }], "manual")}
            onTileSelect={(tile) => setSelectedTileId(tile.id)}
            onRegionSelect={applySelectedRegion}
            onCancelRegion={cancelRegionDrawing}
            onError={setError}
          />
          <div className="map-footer">
            <span><i className="legend-line legend-cyan" />Tile footprints appear when zoomed in</span>
            <span>T80-South · 1.4° × 1.4° · 120″ overlap</span>
          </div>
        </section>

        <aside className="inspector-panel panel-scroll" aria-label="Tile and proposal inspector" tabIndex={0}>
          <section className="panel-section inspector-section">
            <SectionHeading title={selectedTile ? "Tile details" : "Inspector"} trailing={selectedTile?.source === "original" ? "ORIGINAL" : selectedTile ? "PROPOSED" : undefined} />
            {selectedTile ? (
              <TileDetails
                tile={selectedTile}
                context={activePointingGeometryContext}
                fallbackInstrument={activeInstrument}
                onToggle={proposals.some((tile) => tile.id === selectedTile.id)
                  ? () => toggleProposal(selectedTile.id)
                  : undefined}
              />
            ) : (
              <div className="inspector-empty">
                <div className="empty-cross"><span /><span /></div>
                <strong>No tile selected</strong>
                <p>Click a tile center marker to inspect its coordinates and metadata.</p>
              </div>
            )}
          </section>

          {pending && (
            <section className="panel-section proposal-section">
              <SectionHeading title="Proposal preview" trailing="REVIEW" />
              <p className="scientific-help">{pending.tiles.length} S-PLUS tile centers ready for review.</p>
              <div className="solution-stamp">
                <span className={pending.solution === "extended_existing_grid" ? "stamp-dot is-extended" : "stamp-dot"} />
                <strong>{solutionLabel(pending.solution)}</strong>
              </div>
              {pending.solution === "profile_fallback" && <p className="diagnostic-line">{hasCatalogue
                ? "No local grid could be inferred from the loaded tiles, so the S-PLUS grid supplies the plan."
                : "No catalogue is loaded; the S-PLUS grid supplies the plan."}</p>}
              {pending.coverageStrategy && <p className="strategy-result">{pending.coverageStrategy === "complete" ? "Complete coverage" : "Efficient coverage"}</p>}
              {pending.metrics ? <MetricsPanel metrics={pending.metrics} inference={pending.inference} candidateCount={pending.candidateCenters.length} /> : <div className="preview-count"><strong>{pending.tiles.length}</strong><span>new centers ready</span></div>}
              {pending.diagnostics.map((line) => <p className="diagnostic-line" key={line}>{line}</p>)}
              {anchors.length > 0 && (
                <details className="anchor-list">
                  <summary>Anchor tiles used <span>{anchors.length}</span></summary>
                  <div>{anchors.slice(0, 12).map((tile) => <span key={tile.id}>{tile.name}</span>)}{anchors.length > 12 && <span>+{anchors.length - 12} more</span>}</div>
                </details>
              )}
              <div className="proposal-list-head"><span>New tile centers</span><span>{pending.tiles.length}</span></div>
              {pending.tiles.length > 0 && (
                <p className="proposal-page-status" role="status">
                  Showing {previewStart + 1}–{previewEnd} of {pending.tiles.length} centers
                </p>
              )}
              <div className="proposal-list" role="list" aria-label="Proposed tile centers">
                {pending.tiles.length ? pending.tiles.slice(previewStart, previewEnd).map((tile, index) => {
                  const centerIndex = previewStart + index;
                  return (
                    <div className="proposal-row" role="listitem" key={`${tile.id}-${centerIndex}`}>
                      <span className="proposal-index">{String(centerIndex + 1).padStart(2, "0")}</span>
                      <span><strong>{tile.ra_deg.toFixed(4)}°</strong><small>{tile.dec_deg.toFixed(4)}°</small></span>
                    </div>
                  );
                }) : <p className="panel-copy">{(pending.metrics?.coverage_status === "resolved" || pending.metrics?.coverage_status === "legacy_compatible") && pending.metrics.remaining_uncovered_fraction === 0 ? "Existing coverage already satisfies this plan." : "No admissible candidate adds sampled coverage; see the scientific diagnostics."}</p>}
              </div>
              {previewPageCount > 1 && (
                <nav className="proposal-pagination" aria-label="Proposal center pages">
                  <button className="button button-outline" type="button" onClick={() => setPreviewPage(currentPreviewPage - 1)} disabled={currentPreviewPage === 0}>Previous 25</button>
                  <span>Page {currentPreviewPage + 1} of {previewPageCount}</span>
                  <button className="button button-outline" type="button" onClick={() => setPreviewPage(currentPreviewPage + 1)} disabled={currentPreviewPage >= previewPageCount - 1}>Next 25</button>
                </nav>
              )}
              {pending.tiles.length === 0 && <p className="proposal-page-status">No new centers to review.</p>}
              <div className="proposal-actions">
                <button className="button button-primary button-full" onClick={acceptPreview} disabled={!pending.tiles.length}><Icon name="check" /> Accept proposal</button>
                <button className="button button-quiet button-full" onClick={cancelPreview}>Cancel preview</button>
              </div>
            </section>
          )}

          <section className="panel-section accepted-section">
            <div className="accepted-heading">
              <SectionHeading title="Generated proposal" trailing={String(activeOutputProposals.length)} />
              <div className="accepted-actions">
                <button className="text-button" onClick={() => setAllProposals(true)} disabled={!activeOutputProposals.length}>Restore all</button>
                <button className="text-button" onClick={() => setAllProposals(false)} disabled={!activeOutputProposals.length}>Disable all</button>
                <button className="text-button" onClick={clearProposals} disabled={!activeOutputProposals.length && !pending}>Clear proposal</button>
              </div>
            </div>
            {activeOutputProposals.length > 0 && <p className="panel-copy">{activeOutputProposals.filter((tile) => tile.enabled !== false).length} enabled · {activeOutputProposals.filter((tile) => tile.enabled === false).length} disabled</p>}
            {activeOutputProposals.length > 0 && proposalContext?.coverageStrategy && <p className="strategy-result">{proposalContext.coverageStrategy === "complete" ? "Complete coverage" : "Efficient coverage"}</p>}
            {activeMetrics && <MetricsPanel metrics={activeMetrics} inference={proposalContext?.inference ?? null} candidateCount={proposalContext?.candidateCenters.length ?? 0} />}
            {scientificRefusal && <MetricsPanel metrics={scientificRefusal} />}
            {activeOutputProposals.length ? (
              <div className="accepted-list">
                {[...activeOutputProposals].reverse().map((tile, index) => (
                  <button className={`accepted-row ${tile.id === selectedTileId ? "is-selected" : ""} ${tile.enabled === false ? "is-disabled" : ""}`} key={tile.id} onClick={() => setSelectedTileId(tile.id)}>
                    <span className="accepted-swatch" />
                    <span><strong>{tile.name || `Pointing ${activeOutputProposals.length - index}`}</strong><small>{tile.ra_deg.toFixed(4)}°, {tile.dec_deg.toFixed(4)}°</small></span>
                    <span className="accepted-type">{tile.enabled === false ? "DISABLED" : shortMethod(tile.generation_method)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="panel-copy">Accept a proposal to edit and export its tile centers.</p>}
          </section>

          <section className="panel-section export-section">
            <SectionHeading title="Export new tiles" />
            <p className="panel-copy">{proposals.length} generated · {enabledProposals.length} enabled · {proposals.length - enabledProposals.length} disabled</p>
            <p className="fine-print">ICRS decimal degrees · RA, DEC, EPOCH · epoch 2000. Enabled new tiles only.</p>
            <button className="button button-download button-full" onClick={() => void exportFile()} disabled={!enabledProposals.length || busy}><Icon name="download" /> Download new_tiles.csv</button>
            <p className="fine-print">Powered by <a href="https://github.com/elacerda/jasytata" target="_blank" rel="noreferrer">Jasytata</a></p>
          </section>
        </aside>
      </section>
    </main>
  );
}

function SectionHeading({ title, trailing }: { title: string; trailing?: string }) {
  return <div className="section-heading"><h2>{title}</h2>{trailing && <span>{trailing}</span>}</div>;
}

/** Toggle a display layer without changing any planning or export state. */
function PlanningLayer({ label, color, checked, count, onChange }: {
  label: string; color: string; checked: boolean; count?: number; onChange: (checked: boolean) => void;
}) {
  return <label className="dataset-layer">
    <input type="checkbox" aria-label={`Show ${label}`} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="layer-swatch" style={{ "--swatch": color } as CSSProperties} />
    <span>{label}</span>
    {count !== undefined && <strong>{count.toLocaleString()}</strong>}
  </label>;
}

function TileDetails({ tile, onToggle }: { tile: TileRecord; onToggle?: () => void; context: PointingGeometryContext; fallbackInstrument: AnyInstrumentProfile | null }) {
  const metadata = Object.entries(tile.metadata).filter(([, value]) => value !== "");
  return (
    <div className="tile-detail-content">
      <div className="tile-name-block"><strong>{tile.name || (tile.source === "proposed" ? "Proposed tile" : "Catalogue tile")}</strong><span>{tile.dataset_name ?? (tile.source === "proposed" ? "Proposal" : "Catalogue")}</span></div>

      <div className="detail-grid">
        <DetailField label="RA" value={`${tile.ra_deg.toFixed(6)}°`} />
        <DetailField label="DEC" value={`${tile.dec_deg.toFixed(6)}°`} />
        {tile.ra_column && tile.original_values?.[tile.ra_column] && <DetailField label={`Source ${tile.ra_column}`} value={tile.original_values[tile.ra_column]} />}
        {tile.dec_column && tile.original_values?.[tile.dec_column] && <DetailField label={`Source ${tile.dec_column}`} value={tile.original_values[tile.dec_column]} />}
        {metadata.map(([key, value]) => <DetailField key={key} label={key} value={String(value)} />)}
      </div>
      <div className="decimal-coordinate">ICRS · {formatRa(tile.ra_deg)}, {formatDec(tile.dec_deg)}</div>
      <div className={`source-banner ${tile.source}`}><span className="status-dot" />{tile.source === "original" ? "Original catalogue tile · immutable" : `Proposed · ${tile.enabled === false ? "disabled" : "enabled"}`}</div>
      {onToggle && <button className="button button-outline button-full" onClick={onToggle}>{tile.enabled === false ? "Enable tile" : "Disable tile"}</button>}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="detail-field"><span>{label}</span><strong>{value}</strong></div>;
}

function Icon({ name }: { name: "upload" | "crosshair" | "list" | "region" | "chevron" | "spark" | "check" | "undo" | "trash" | "download" | "target" | "sun" | "moon" }) {
  const paths: Record<string, ReactNode> = {
    upload: <><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" /><path d="M5 14v5h14v-5" /></>,
    crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 2v5m0 10v5M2 12h5m10 0h5" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
    region: <><rect x="4" y="5" width="16" height="14" rx="1" strokeDasharray="3 2" /><path d="M8 9h.01M16 15h.01" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    spark: <><path d="m12 2 1.4 6.6L20 11l-6.6 1.4L12 19l-1.4-6.6L4 11l6.6-2.4L12 2Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></>,
    check: <path d="m5 12 4.5 4.5L19 7" />,
    undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 0 14h-2" /></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    download: <><path d="M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5" /><path d="M5 17v3h14v-3" /></>,
    target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.5" /><path d="M12 1v3M12 20v3M1 12h3m16 0h3" /></>,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    moon: <path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8a8.5 8.5 0 1 0 11.5 11.5Z" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function solutionLabel(solution: string) {
  if (solution === "extended_existing_grid") return "Existing grid extended";
  if (solution === "profile_fallback") return "S-PLUS grid fallback";
  if (solution === "manual") return "Manual sky placement";
  return "Imported centers";
}

function shortMethod(method: TileRecord["generation_method"]) {
  if (method === "region_extended") return "grid extension";
  if (method === "region_legacy") return "legacy grid";
  if (method === "imported_centers") return "imported";
  if (method === "manual") return "manual";
  return "proposed";
}

function formatRa(value: number) {
  const totalSeconds = Math.round((((value % 360) + 360) % 360) / 15 * 3600) % (24 * 3600);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDec(value: number) {
  const sign = value < 0 ? "−" : "+";
  const totalSeconds = Math.round(Math.abs(value) * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${String(degrees).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
