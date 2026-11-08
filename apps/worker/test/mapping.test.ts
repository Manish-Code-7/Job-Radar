import { describe, expect, it } from "vitest";
import { apifyItemToRawJob } from "../src/crawl";
import { DirectoryRow, mapAts, mapKind } from "../src/seed";

describe("seed mapping", () => {
  it("maps kinds; Services and staffing are excluded", () => {
    expect(mapKind("Services")).toMatchObject({ kind: "services", excluded: true });
    expect(mapKind("IT Services")).toMatchObject({ kind: "services", excluded: true });
    expect(mapKind("Staffing agency")).toMatchObject({ kind: "staffing", excluded: true });
    expect(mapKind("GCC")).toMatchObject({ kind: "gcc", excluded: false });
    expect(mapKind("Product")).toMatchObject({ kind: "product", excluded: false });
  });
  it("maps ATS names and aliases", () => {
    expect(mapAts("Greenhouse")).toBe("greenhouse");
    expect(mapAts("SAP SuccessFactors")).toBe("successfactors");
    expect(mapAts("Zoho Recruit")).toBe("zoho");
    expect(mapAts("Taleo")).toBe("oracle");
    expect(mapAts("something new")).toBe("unknown");
  });
  it("validates directory rows", () => {
    expect(DirectoryRow.safeParse({ name: "Acme", kind: "Product", ats: "lever", readable: true }).success).toBe(true);
    expect(DirectoryRow.safeParse({ kind: "Product", ats: "lever" }).success).toBe(false);
  });
});

describe("apify item mapping", () => {
  const company = { ats: "workday" } as never;
  it("reads common field names", () => {
    const j = apifyItemToRawJob({ jobId: "R1", jobTitle: "Associate Engineer", jobUrl: "https://x.wd3.myworkdayjobs.com/Ext/job/R1", location: "Bengaluru, India", description: "<p>Build things</p>" }, company);
    expect(j).toMatchObject({ sourceJobId: "R1", title: "Associate Engineer", locations: ["Bengaluru, India"], descriptionText: "Build things", detailFetched: true });
  });
  it("drops items without url or title", () => {
    expect(apifyItemToRawJob({ title: "x" }, company)).toBeNull();
  });
});
