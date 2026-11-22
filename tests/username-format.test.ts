import { describe, it, expect } from "vitest";
import { isValidUsernameFormat, suggestUsernameFrom, USERNAME_REGEX } from "../shared/username";

describe("isValidUsernameFormat", () => {
  it("accepts 3-20 chars of letters, numbers, period and underscore", () => {
    expect(isValidUsernameFormat("abc")).toBe(true);
    expect(isValidUsernameFormat("gustavo.pattaro")).toBe(true);
    expect(isValidUsernameFormat("user_123")).toBe(true);
    expect(isValidUsernameFormat("a".repeat(20))).toBe(true);
  });

  it("rejects too short or too long", () => {
    expect(isValidUsernameFormat("ab")).toBe(false);
    expect(isValidUsernameFormat("a".repeat(21))).toBe(false);
  });

  it("rejects disallowed characters", () => {
    expect(isValidUsernameFormat("user name")).toBe(false);
    expect(isValidUsernameFormat("user@name")).toBe(false);
    expect(isValidUsernameFormat("usér")).toBe(false);
    expect(isValidUsernameFormat("user-name")).toBe(false);
  });

  it("matches the exported regex directly", () => {
    expect(USERNAME_REGEX.test("valid_name.1")).toBe(true);
  });
});

describe("suggestUsernameFrom", () => {
  it("derives from the name when given", () => {
    expect(suggestUsernameFrom("Gustavo Pattaro", null)).toBe("gustavopattaro");
  });

  it("strips diacritics and invalid characters", () => {
    expect(suggestUsernameFrom("José Núñez-Á", null)).toBe("josenuneza");
  });

  it("falls back to the email's local part when no name is given", () => {
    expect(suggestUsernameFrom(null, "jane.doe@example.com")).toBe("jane.doe");
  });

  it("falls back to a random suggestion when neither yields 3+ chars", () => {
    const suggestion = suggestUsernameFrom("", null);
    expect(suggestion.length).toBeGreaterThanOrEqual(3);
    expect(isValidUsernameFormat(suggestion)).toBe(true);
  });

  it("always returns a format-valid suggestion", () => {
    expect(isValidUsernameFormat(suggestUsernameFrom("Gustavo Pattaro", null))).toBe(true);
    expect(isValidUsernameFormat(suggestUsernameFrom(null, "jane.doe@example.com"))).toBe(true);
  });
});
