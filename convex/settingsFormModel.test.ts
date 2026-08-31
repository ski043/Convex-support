import { describe, expect, test } from "vitest";
import {
  normalizeNonEmptyValues,
  normalizedValuesEqual,
  saveAwareServerBaseline,
  syncUntouchedValue,
  widgetOriginObservationWarnings,
} from "../lib/settings-form-model";

describe("settings form model", () => {
  test("adopts reactive server changes only for untouched fields", () => {
    expect(syncUntouchedValue(true, true, false)).toBe(false);
    expect(syncUntouchedValue("local edit", "old value", "new value")).toBe(
      "local edit",
    );
  });

  test("preserves follow-up edits when a saved value reaches the reactive query", () => {
    const previousEnabled = saveAwareServerBaseline(true, false, false);
    expect(previousEnabled).toBe(false);
    expect(syncUntouchedValue(true, previousEnabled, false)).toBe(true);

    const previousOriginsKey = saveAwareServerBaseline(
      JSON.stringify(["https://old.example.com"]),
      JSON.stringify(["https://saved.example.com"]),
      JSON.stringify(["https://saved.example.com"]),
    );
    expect(
      normalizedValuesEqual(
        ["https://old.example.com"],
        JSON.parse(previousOriginsKey) as string[],
      ),
    ).toBe(false);
  });

  test("keeps the last observed baseline for unrelated server updates", () => {
    expect(saveAwareServerBaseline("old", "external", "saved")).toBe(
      "old",
    );
  });

  test("omits blank origin rows before saving", () => {
    expect(
      normalizeNonEmptyValues([
        " https://shop.example.com ",
        "",
        "   ",
        "https://support.example.com",
      ]),
    ).toEqual([
      "https://shop.example.com",
      "https://support.example.com",
    ]);
    expect(
      normalizeNonEmptyValues([
        "https://shop.example.com",
        "https://shop.example.com",
      ]),
    ).toEqual(["https://shop.example.com"]);
  });

  test("shows capacity and truncation warnings together", () => {
    expect(
      widgetOriginObservationWarnings({
        isAtCapacity: true,
        isTruncated: true,
      }),
    ).toEqual({ showCapacity: true, showTruncation: true });
  });

  test("recognizes origin drafts that still match reactive server state", () => {
    expect(
      normalizedValuesEqual(
        [" https://shop.example.com ", ""],
        ["https://shop.example.com"],
      ),
    ).toBe(true);
    expect(
      normalizedValuesEqual(
        ["https://local-edit.example.com"],
        ["https://shop.example.com"],
      ),
    ).toBe(false);
  });
});
