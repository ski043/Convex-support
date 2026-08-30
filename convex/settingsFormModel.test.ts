import { describe, expect, test } from "vitest";
import {
  normalizeNonEmptyValues,
  normalizedValuesEqual,
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
