import { describe, expect, it } from "vitest";
import { privacyUrl, supportUrl } from "../constants/links";

describe("privacyUrl", () => {
  it("uses the pt path for 'pt'", () => {
    expect(privacyUrl("pt")).toBe("https://thelocalstravel.com/pt/privacy/");
  });

  it("uses the pt path for 'pt-BR'", () => {
    expect(privacyUrl("pt-BR")).toBe("https://thelocalstravel.com/pt/privacy/");
  });

  it("uses the default path for 'en'", () => {
    expect(privacyUrl("en")).toBe("https://thelocalstravel.com/privacy/");
  });

  it("uses the default path for 'es'", () => {
    expect(privacyUrl("es")).toBe("https://thelocalstravel.com/privacy/");
  });
});

describe("supportUrl", () => {
  it("uses the pt path for 'pt'", () => {
    expect(supportUrl("pt")).toBe("https://thelocalstravel.com/pt/support/");
  });

  it("uses the pt path for 'pt-BR'", () => {
    expect(supportUrl("pt-BR")).toBe("https://thelocalstravel.com/pt/support/");
  });

  it("uses the default path for 'en'", () => {
    expect(supportUrl("en")).toBe("https://thelocalstravel.com/support/");
  });

  it("uses the default path for 'es'", () => {
    expect(supportUrl("es")).toBe("https://thelocalstravel.com/support/");
  });
});
