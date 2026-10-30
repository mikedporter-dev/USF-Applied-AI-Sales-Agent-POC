import { describe, expect, it } from "vitest";
import { companyKey, companyMatcher, matchConnections, parseConnectionBatch, parseConnectionsCsv, seniorityFor, type UniverseCompany } from "./connections";

// Fictional people, in LinkedIn's export layout.
const CSV = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Example,https://www.linkedin.com/in/ada-example,ada@example.com,"NBCUniversal Media, LLC","Vice President, Data Strategy",07 Oct 2026
Ben,Sample,https://www.linkedin.com/in/ben-sample,,The Walt Disney Company,Senior Manager,01 Apr 2014
Cy,Test,https://www.linkedin.com/in/cy-test,,Verizon Business,Director of AI,15 Jun 2022
Di,Demo,https://www.linkedin.com/in/di-demo,,"Spectrum Health","Chief Medical Officer",02 Feb 2020
Ed,Mock,https://www.linkedin.com/in/ed-mock,,Colgate-Palmolive,Analyst,03 Mar 2021
,,,,,,
Fay,Fake,https://www.linkedin.com/in/fay-fake,,Apple Leisure Group,CEO,04 Apr 2023
Gus,Phony,https://www.linkedin.com/in/gus-phony,,Universal Music Group,VP Marketing,05 May 2024
Hal,Pretend,https://www.linkedin.com/in/hal-pretend,,Verizon Business Global,Head of Sales,06 Jun 2024
`;

const UNIVERSE: UniverseCompany[] = [
  { cik: "0001166691", ticker: "CMCSA", name: "Comcast", legalName: "COMCAST CORP" },
  { cik: "0001744489", ticker: "DIS", name: "Walt Disney Company (The)", legalName: "Walt Disney Co" },
  { cik: "0000732712", ticker: "VZ", name: "Verizon", legalName: "VERIZON COMMUNICATIONS INC" },
  { cik: "0001091667", ticker: "CHTR", name: "Charter Communications", legalName: "CHARTER COMMUNICATIONS, INC. /MO/" },
  { cik: "0000021665", ticker: "CL", name: "Colgate-Palmolive", legalName: "COLGATE PALMOLIVE CO" },
  { cik: "0000320193", ticker: "AAPL", name: "Apple Inc.", legalName: "Apple Inc." },
  { cik: "0000102037", ticker: "UVV", name: "Universal Corporation", legalName: "UNIVERSAL CORP /VA/" },
  { cik: "0002041610", ticker: "SKYD", name: "Skydance Corporation", legalName: "Skydance Corp" },
];

describe("parseConnectionsCsv", () => {
  it("reads people, companies, titles and dates, skipping the notes and anonymous rows", () => {
    const rows = parseConnectionsCsv(CSV);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual({ name: "Ada Example", company: "NBCUniversal Media, LLC", position: "Vice President, Data Strategy", connectedOn: "2026-10-07" });
    expect(rows[3].company).toBe("Spectrum Health");
    expect(JSON.stringify(rows)).not.toContain("@example.com"); // emails aren't kept
  });

  it("explains a file that isn't the LinkedIn export", () => {
    expect(() => parseConnectionsCsv("Ticker,Name\nCL,Colgate")).toThrow(/Connections.csv/);
  });
});

describe("seniorityFor", () => {
  it.each([
    ["President & Chief Executive Officer", "C-Suite"],
    ["CRO", "C-Suite"],
    ["Executive Vice President, Sales", "VP"],
    ["EVP and President, Sports", "C-Suite"],
    ["Head of Data Science", "VP"],
    ["GM, Streaming", "VP"],
    ["Sr. Director, Analytics", "Director"],
    ["Associate Partner, McKinsey Technology", "Director"],
    ["Senior Partner Manager", "Manager"],
    ["Managing Director", "Owner/Partner"],
    ["Partner", "Owner/Partner"],
    ["Co-Founder & CEO", "Owner/Partner"],
    ["Senior Product Manager, AI", "Manager"],
  ])("%s → %s", (title, seniority) => expect(seniorityFor(title)).toBe(seniority));

  it.each(["Senior Producer", "Data Scientist", "Marketing Intern", "Consultant", "Alliances & Partnerships"])("%s is below Manager", (title) => {
    expect(seniorityFor(title)).toBeUndefined();
  });
});

describe("companyKey", () => {
  it("ignores case, punctuation, accents and corporate suffixes", () => {
    expect(companyKey("The Walt Disney Company")).toBe(companyKey("WALT DISNEY CO"));
    expect(companyKey("JPMorgan Chase & Co.")).toBe("jpmorgan chase");
    expect(companyKey("Mondelēz International")).toBe(companyKey("MONDELEZ INTERNATIONAL, INC."));
    expect(companyKey("Amazon Web Services (AWS)")).toBe("amazon web services");
  });
});

describe("matchConnections", () => {
  it("keeps Manager+ connections at S&P 1500 companies, by name, brand or distinctive prefix", () => {
    const result = matchConnections(parseConnectionsCsv(CSV), companyMatcher(UNIVERSE));
    expect(result.total).toBe(8);
    expect(result.managerPlus).toBe(7); // the analyst is below Manager
    expect(result.matched.map((m) => [m.name, m.cik, m.seniority])).toEqual([
      ["Ada Example", "0001166691", "VP"], // NBCUniversal → Comcast
      ["Ben Sample", "0001744489", "Manager"],
      ["Cy Test", "0000732712", "Director"], // Verizon Business → Verizon
      ["Hal Pretend", "0000732712", "VP"], // Verizon Business Global → Verizon
    ]);
    expect(result.matched[0].companyAsListed).toBe("NBCUniversal Media, LLC");
    // Only unit or region words may follow a listed name: Universal Music isn't Universal Corp.
    expect(result.unmatchedCompanies).toEqual([
      { company: "Spectrum Health", count: 1 },
      { company: "Apple Leisure Group", count: 1 },
      { company: "Universal Music Group", count: 1 },
    ]);
  });
});

describe("company aliases", () => {
  it("send Paramount and Warner Bros. Discovery brands to the merged Skydance Corporation", () => {
    const matcher = companyMatcher(UNIVERSE);
    for (const name of ["Paramount", "Paramount+", "CBS News", "Warner Bros. Discovery", "HBO", "Skydance"]) {
      expect(matcher.match(name)?.ticker, name).toBe("SKYD");
    }
  });

  it("are ignored when the parent isn't in the S&P 1500", () => {
    expect(companyMatcher(UNIVERSE.filter((c) => c.ticker !== "SKYD")).match("Paramount")).toBeUndefined();
  });
});

describe("parseConnectionBatch", () => {
  const person = { cik: "0001166691", name: "Ada Example", title: "VP, Data", seniority: "VP", companyAsListed: "NBCUniversal", connectedOn: "2026-10-07" };
  const at = "2026-10-30T09:00:00Z";
  it("accepts matched connections and rejects malformed ones", () => {
    expect(parseConnectionBatch({ importedAt: at, connections: [person] })).toMatchObject({ connections: [person] });
    expect(parseConnectionBatch({ importedAt: at, connections: [{ ...person, cik: "1166691" }] })).toContain("bad cik");
    expect(parseConnectionBatch({ importedAt: at, connections: [{ ...person, seniority: "Intern" }] })).toContain("bad seniority");
    expect(parseConnectionBatch({ importedAt: at, connections: [{ ...person, connectedOn: "07 Oct 2026" }] })).toContain("bad date");
    expect(parseConnectionBatch({ importedAt: at, connections: [] })).toContain("1 to 500");
    expect(parseConnectionBatch({ connections: [person] })).toContain("importedAt");
  });
});
