import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/uploads/sponsors/[name]/route";

const DIR = join(process.cwd(), "public", "uploads", "sponsors");
const NAME = "sponsor-1760000000000-deadbeef.png";

const call = (name: string) =>
  GET(new Request(`http://localhost/uploads/sponsors/${name}`), { params: Promise.resolve({ name }) });

beforeAll(async () => {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, NAME), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});
afterAll(async () => {
  await rm(join(DIR, NAME), { force: true });
});

describe("GET /uploads/sponsors/:name", () => {
  it("serves an uploaded logo with its image type", async () => {
    const res = await call(NAME);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses names the upload route could not have produced", async () => {
    for (const name of ["../../.env", "..%2F..%2F.env", "sponsor-1-x.png", "sponsor-1760000000000-deadbeef.svg"]) {
      expect((await call(name)).status).toBe(404);
    }
  });

  it("404s a well-formed name that does not exist", async () => {
    expect((await call("sponsor-1760000000000-00000000.png")).status).toBe(404);
  });
});
