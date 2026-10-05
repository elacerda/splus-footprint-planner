import "@testing-library/jest-dom/vitest";


import { beforeEach, vi } from "vitest";
// Every test is isolated from GitHub; product tests override this with their own responses.
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline test catalogue"))); });
