import { formatDegrees } from "./profiles/presentation";
import type { CoverageResult, InferenceDiagnostics } from "./types";

function basisLabel(metrics: CoverageResult) {
  switch (metrics.coverage_basis) {
    case "observed_area": return "Observed-area geometry coverage";
    case "nominal_envelope": return "Nominal envelope overlap";
    case "target_access": return "Target-access envelope · not observed coverage";
    case "legacy_v2": return "S-PLUS coverage";
  }
}

function angularScale(degrees: number) {
  return `${Number((degrees * 3600).toPrecision(3))} arcsec`;
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={`metric-row ${emphasis ? "is-emphasis" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function SamplingDetails({ metrics }: { metrics: CoverageResult }) {
  const sampling = metrics.sampling;
  if (!sampling) return null;
  const bound = "error_bound" in metrics ? metrics.error_bound : undefined;
  return <details className="scientific-details">
    <summary>Sampling details</summary>
    <Metric label="Coverage basis" value={basisLabel(metrics)} />
    {"geometry_basis" in metrics && metrics.geometry_basis && <Metric label="Geometry basis" value={metrics.geometry_basis === "effective_sequence" ? "Effective sequence" : "Single exposure"} />}
    <Metric label="Smallest contributing scale" value={angularScale(sampling.characteristic_scale_deg)} />
    <Metric label="Required pitch" value={angularScale(sampling.natural_step_deg)} />
    <Metric label="Actual cell size (east × north)" value={`${angularScale(sampling.cell_width_deg)} × ${angularScale(sampling.cell_height_deg)}`} />
    <Metric label="Samples / maximum budget" value={`${sampling.sample_count.toLocaleString()} / ${sampling.max_samples.toLocaleString()}`} />
    <Metric label="Required samples" value={sampling.required_sample_count?.toLocaleString() ?? "Beyond safe integer range"} />
    {bound && <>
      <Metric label="Fraction error upper bound" value={`${Number((bound.fraction_error_upper_bound * 100).toPrecision(3))} percentage points`} />
      <Metric label="Area error upper bound" value={`${Number(bound.area_error_upper_bound_deg2.toPrecision(3))} deg²`} />
      <p>Numerical bound in the modeled plane. Physical and spherical projection errors are unquantified; this does not certify gap-free coverage.</p>
    </>}
    {sampling.status === "under_resolved" && <p>Actual cells are diagnostic only; no coverage fraction was calculated.</p>}
  </details>;
}

/** Present role-aware measurements or typed scientific unavailability without fake percentages.
 * @param props - Frozen Gate 6B result, optional inference diagnostics and candidate count.
 * @returns Measurement readout with compact sampling disclosure and text status/alert semantics.
 */
export function CoverageReadout({ metrics, inference = null, candidateCount = 0 }: {
  metrics: CoverageResult; inference?: InferenceDiagnostics | null; candidateCount?: number;
}) {
  if (metrics.coverage_status !== "resolved" && metrics.coverage_status !== "legacy_compatible") {
    return <div className="metrics-panel scientific-coverage">
      <div role="alert">
        <strong>{metrics.coverage_status === "under_resolved" ? "Coverage unavailable at required resolution"
          : metrics.coverage_status === "unsupported_basis" ? "Area coverage is not supported for this basis" : "No eligible coverage contributors"}</strong>
        <p>{basisLabel(metrics)}</p>
        {metrics.coverage_status === "under_resolved" && <>
          <p>No authoritative coverage percentage is available. The required spatial sampling exceeds the computational budget.</p>
          {metrics.sampling && <p>Required pitch: {angularScale(metrics.sampling.natural_step_deg)}. Required samples: {metrics.sampling.required_sample_count?.toLocaleString() ?? "beyond safe integer range"}; maximum budget: {metrics.sampling.max_samples.toLocaleString()}.</p>}
        </>}
        {metrics.coverage_basis === "target_access" && <p>This field is an access envelope. It does not establish individual fibre reachability, assignment or successful observation.</p>}
      </div>
      <SamplingDetails metrics={metrics} />
    </div>;
  }
  const envelope = metrics.coverage_basis === "nominal_envelope";
  const fidelity = metrics.contributing_semantics?.filter(({ role }) => role === metrics.coverage_basis).map(({ fidelity }) => fidelity);
  return <div className="metrics-panel scientific-coverage">
    <p><strong>{basisLabel(metrics)} · sampled estimate{(envelope || fidelity?.includes("approximate")) ? " · Approximate" : fidelity?.includes("exact") ? " · Exact geometry" : ""}</strong></p>
    {envelope && <p>Planning envelope, not exact active area</p>}
    {metrics.geometry_basis && <p>{metrics.geometry_basis === "effective_sequence" ? "Effective sequence · geometric union only" : "Single exposure"}</p>}
    <Metric label="Selected region" value={`${metrics.coverage_basis === "legacy_v2" ? metrics.selected_region_area_deg2.toFixed(2) : Number(metrics.selected_region_area_deg2.toPrecision(3))} deg²`} />
    <Metric label="Existing contributors" value={String(metrics.existing_tiles_contributing)} />
    {inference && <>
      <Metric label="Nearby anchor candidates" value={String(inference.nearby_tile_count)} />
      <Metric label="Inference anchors used" value={String(inference.anchor_tile_ids.length)} />
      <Metric label="Compatible neighbor pairs" value={String(inference.compatible_neighbor_pairs)} />
    </>}
    <Metric label="New tiles" value={String(metrics.new_tiles)} emphasis />
    <Metric label={envelope ? "Existing envelope overlap" : "Already covered"} value={`${(metrics.already_covered_fraction * 100).toFixed(1)}%`} />
    <Metric label={basisLabel(metrics)} value={`${(metrics.selected_region_coverage * 100).toFixed(1)}%`} emphasis />
    <Metric label={envelope ? "Incremental envelope overlap" : "Incremental new coverage"} value={`${(metrics.incremental_coverage * 100).toFixed(1)}%`} />
    <Metric label={envelope ? "Remaining outside envelopes" : "Remaining uncovered"} value={`${(metrics.remaining_uncovered_fraction * 100).toFixed(1)}% · ${Number(metrics.remaining_uncovered_area_deg2.toPrecision(3))} deg²`} />
    <Metric label={envelope ? "Redundant envelope overlap" : "Redundant proposal coverage"} value={`${(metrics.redundant_coverage * 100).toFixed(1)}%`} />
    <Metric label="Outside selected area" value={`${Number(metrics.outside_region_coverage_deg2.toPrecision(3))} deg²`} />
    {metrics.sampling ? <SamplingDetails metrics={metrics} /> : <div className="metric-footnote">Sample step {formatDegrees(metrics.sample_step_deg)} · {candidateCount} candidate lattice centers</div>}
  </div>;
}
