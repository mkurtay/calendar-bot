import {
  getCategoryModel,
  isKnownCategory,
  knownCategories,
  slugify,
} from "../../models/registry.js";

describe("isKnownCategory", () => {
  it("accepts soccer and formula1", () => {
    expect(isKnownCategory("soccer")).toBe(true);
    expect(isKnownCategory("formula1")).toBe(true);
  });

  it("rejects unknown categories and non-strings", () => {
    expect(isKnownCategory("nba")).toBe(false);
    expect(isKnownCategory("Soccer")).toBe(false);
    expect(isKnownCategory("")).toBe(false);
    expect(isKnownCategory(undefined)).toBe(false);
    expect(isKnownCategory(42)).toBe(false);
  });
});

describe("knownCategories", () => {
  it("contains every category that has a model", () => {
    expect([...knownCategories]).toEqual(
      expect.arrayContaining(["soccer", "formula1"]),
    );
  });
});

describe("getCategoryModel", () => {
  it("returns a validator for soccer", () => {
    const model = getCategoryModel("soccer");
    expect(typeof model.validate).toBe("function");
    expect(model.validate(null).ok).toBe(false);
  });

  it("returns a validator for formula1", () => {
    const model = getCategoryModel("formula1");
    expect(typeof model.validate).toBe("function");
    expect(model.validate(null).ok).toBe(false);
  });
});

describe("slugify", () => {
  it("lowercases and dasherizes spaces", () => {
    expect(slugify("Champions League 2026")).toBe("champions-league-2026");
    expect(slugify("Formula 1 2026")).toBe("formula-1-2026");
  });

  it("collapses runs of non-alphanumerics to a single dash", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("a    b    c")).toBe("a-b-c");
    expect(slugify("foo--bar__baz")).toBe("foo-bar-baz");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("  spaces  ")).toBe("spaces");
    expect(slugify("---x---")).toBe("x");
  });

  it("handles already-slug input as identity", () => {
    expect(slugify("champions-league-2026")).toBe("champions-league-2026");
  });

  it("handles unicode by stripping (no transliteration)", () => {
    expect(slugify("São Paulo")).toBe("s-o-paulo");
  });
});
