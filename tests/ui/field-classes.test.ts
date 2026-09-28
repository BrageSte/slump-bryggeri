import { describe, expect, it } from "vitest";
import { fieldClasses } from "../../src/design-system/field-classes.ts";

describe("form field classes", () => {
  it("drops the default full width when the caller sets a width", () => {
    // Regression: `w-full` next to `w-24` made the unit picker fill the row and hid the value field.
    const classes = fieldClasses("w-24 shrink-0").split(" ");
    expect(classes).toContain("w-24");
    expect(classes).not.toContain("w-full");
  });

  it("keeps full width by default", () => {
    expect(fieldClasses().split(" ")).toContain("w-full");
    expect(fieldClasses("tabular").split(" ")).toContain("w-full");
  });
});
