import { describe, expect, it } from "vitest";
import { validateNewPassword } from "../utils/password-validation";

describe("validateNewPassword", () => {
  it("returns no errors for a valid matching password", () => {
    expect(validateNewPassword("secret1", "secret1")).toEqual({});
  });

  it("flags an empty password as required", () => {
    expect(validateNewPassword("", "")).toEqual({ password: "required", confirm: "required" });
  });

  it("flags a password shorter than 6 characters", () => {
    expect(validateNewPassword("abc12", "abc12")).toEqual({ password: "tooShort" });
  });

  it("flags a mismatched confirmation", () => {
    expect(validateNewPassword("secret1", "secret2")).toEqual({ confirm: "mismatch" });
  });

  it("flags an empty confirmation as required even when password is valid", () => {
    expect(validateNewPassword("secret1", "")).toEqual({ confirm: "required" });
  });

  it("accepts a password exactly at the 6-character minimum", () => {
    expect(validateNewPassword("abcdef", "abcdef")).toEqual({});
  });
});
