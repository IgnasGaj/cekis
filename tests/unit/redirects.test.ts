import { describe, expect, it } from "vitest";
import { safePostLoginPath } from "../../src/lib/redirects";

describe("post-login destination", () => {
  it("accepts the one supported destination", () => {
    expect(safePostLoginPath("/pradzia")).toBe("/pradzia");
  });
  it.each(["//evil.test", "https://evil.test", "/\\evil.test", "/%2f%2fevil.test", "javascript:alert(1)", null, 3])("rejects %s", (value) => {
    expect(safePostLoginPath(value)).toBeNull();
  });
});
