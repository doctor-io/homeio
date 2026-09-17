import { describe, expect, it } from "vitest";

import { reorder } from "../storage";

const list = ["a", "b", "c", "d"];

describe("reorder", () => {
  it("moves an item down without losing the others", () => {
    expect(reorder(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up", () => {
    expect(reorder(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("leaves the list alone when nothing moves", () => {
    expect(reorder(list, 1, 1)).toBe(list);
  });

  it("refuses an index off either end rather than dropping the item", () => {
    // A drag released past the last card must not delete it, which is what
    // splice at an out-of-range index would quietly do.
    expect(reorder(list, 0, 9)).toBe(list);
    expect(reorder(list, -1, 0)).toBe(list);
    expect(reorder(list, 0, -1)).toBe(list);
  });

  it("never mutates the input", () => {
    const original = [...list];
    reorder(list, 0, 3);
    expect(list).toEqual(original);
  });
});
