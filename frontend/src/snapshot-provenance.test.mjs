import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import bundledCsv from "./data/official/tiles_nc.csv?raw";
import provenance from "./data/official/provenance.json";

it("records the exact upstream Git blob SHA of the bundled snapshot", () => {
  const bytes = Buffer.from(bundledCsv);
  expect(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"))
    .toBe(provenance.blob_sha);
});
