import { describe, expect, it } from "vitest";
import { INDUSTRY_FIT } from "./scoring";
import { sicToGicsSector } from "./sic";

describe("sicToGicsSector", () => {
  it.each([
    ["2844", "Consumer Staples"], // Colgate-Palmolive: perfumes, cosmetics & toilet preparations
    ["2834", "Health Care"], // pharmaceutical preparations
    ["1311", "Energy"],
    ["3674", "Information Technology"], // semiconductors
    ["3711", "Consumer Discretionary"], // motor vehicles
    ["6022", "Financials"], // state commercial banks
    ["6798", "Real Estate"],
    ["7372", "Information Technology"], // prepackaged software
    ["4911", "Utilities"],
    [4813, "Communication Services"],
  ])("maps SIC %s to %s", (sic, sector) => {
    expect(sicToGicsSector(sic)).toBe(sector);
  });

  it("returns undefined for missing or unknown codes", () => {
    expect(sicToGicsSector(undefined)).toBeUndefined();
    expect(sicToGicsSector("")).toBeUndefined();
    expect(sicToGicsSector("9999")).toBeUndefined();
  });

  it("only returns sectors the scoring knows", () => {
    for (let code = 100; code < 9999; code += 7) {
      const sector = sicToGicsSector(code);
      if (sector) expect(Object.keys(INDUSTRY_FIT)).toContain(sector);
    }
  });
});
