import productionV3 from "./production-v3.json";
import { createBundledProfileRegistry as createSplusRegistry } from "../../profiles/registry";
/** Reconstruct the upstream test library solely for unchanged science regressions. */
export function createBundledProfileRegistry() {
  const registry = createSplusRegistry();
  for (const instrument of productionV3.instruments) registry.registerInstrumentProfileV3(instrument);
  for (const survey of productionV3.strategies) registry.registerSurveyProfileV3(survey);
  return registry;
}
