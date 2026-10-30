// Approximate GICS sector for an SEC SIC industry code. SIC and GICS don't line
// up exactly, so this is a stand-in until the S&P 1500 list supplies the real
// GICS sector for each company.

type Range = [from: number, to: number, sector: string];

// More specific ranges come first; the first match wins.
const RANGES: Range[] = [
  [1311, 1389, "Energy"], // crude oil, natural gas, drilling and services
  [1000, 1499, "Materials"], // metal and mineral mining
  [100, 999, "Consumer Staples"], // agriculture
  [1500, 1799, "Industrials"], // construction
  [2000, 2199, "Consumer Staples"], // food, beverages, tobacco
  [2200, 2399, "Consumer Discretionary"], // textiles, apparel
  [2500, 2599, "Consumer Discretionary"], // furniture
  [2400, 2699, "Materials"], // lumber, paper
  [2700, 2799, "Communication Services"], // printing and publishing
  [2830, 2836, "Health Care"], // pharmaceuticals
  [2840, 2844, "Consumer Staples"], // soap, detergents, cosmetics
  [2800, 2899, "Materials"], // chemicals
  [2900, 2999, "Energy"], // petroleum refining
  [3100, 3199, "Consumer Discretionary"], // leather goods
  [3000, 3399, "Materials"], // rubber, plastics, glass, metals
  [3570, 3579, "Information Technology"], // computers
  [3400, 3599, "Industrials"], // fabricated metal, machinery
  [3630, 3639, "Consumer Discretionary"], // household appliances
  [3600, 3699, "Information Technology"], // electronics, semiconductors
  [3711, 3716, "Consumer Discretionary"], // motor vehicles
  [3700, 3799, "Industrials"], // aircraft, ships, rail
  [3840, 3851, "Health Care"], // medical instruments
  [3800, 3899, "Information Technology"], // other instruments
  [3900, 3999, "Consumer Discretionary"], // toys, jewelry, misc
  [4000, 4799, "Industrials"], // transportation
  [4800, 4899, "Communication Services"], // telecom, broadcasting
  [4900, 4999, "Utilities"],
  [5120, 5122, "Health Care"], // drug wholesale
  [5140, 5149, "Consumer Staples"], // grocery wholesale
  [5000, 5199, "Industrials"], // other wholesale
  [5400, 5499, "Consumer Staples"], // food stores
  [5912, 5912, "Consumer Staples"], // drug stores
  [5200, 5999, "Consumer Discretionary"], // other retail
  [6500, 6599, "Real Estate"],
  [6798, 6798, "Real Estate"], // REITs
  [6000, 6799, "Financials"], // banks, insurance, brokers, holding companies
  [7370, 7379, "Information Technology"], // software and IT services
  [7800, 7999, "Communication Services"], // entertainment
  [7000, 7299, "Consumer Discretionary"], // hotels, personal services
  [7500, 7599, "Consumer Discretionary"], // auto services
  [7300, 7399, "Industrials"], // other business services
  [8000, 8099, "Health Care"], // health services
  [8200, 8299, "Consumer Discretionary"], // education
  [8700, 8799, "Industrials"], // engineering, research, management services
];

export function sicToGicsSector(sic: string | number | undefined): string | undefined {
  const code = Number(sic);
  if (!Number.isInteger(code) || code <= 0) return undefined;
  return RANGES.find(([from, to]) => code >= from && code <= to)?.[2];
}
