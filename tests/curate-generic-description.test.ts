import { describe, expect, it } from "vitest";

import { isGenericPt, isGenericEn, isGenericDescriptions } from "../scripts/curate/generic-description";

describe("isGenericPt", () => {
  it("matches the real generic template from the 6-city import", () => {
    expect(isGenericPt("Conheça X e descubra seus arquitetura e história. Reserve um tempo para explorar a região de Y sem pressa.")).toBe(true);
  });

  it("matches other opening verbs with the telltale phrase", () => {
    expect(isGenericPt("Descubra este lugar incrível. Reserve um tempo para aproveitar sem pressa.")).toBe(true);
    expect(isGenericPt("Visite o museu e descubra seus segredos.")).toBe(true);
    expect(isGenericPt("Explore a vizinhança e descubra seus encantos escondidos.")).toBe(true);
  });

  it("requires BOTH the opening verb and a telltale phrase", () => {
    expect(isGenericPt("Conheça este restaurante incrível, com pratos deliciosos e vista para o mar.")).toBe(false);
    expect(isGenericPt("Este é um ótimo lugar. Reserve um tempo para aproveitar sem pressa.")).toBe(false);
  });

  it("does not match an original description", () => {
    expect(isGenericPt("Pequeno café de bairro com o melhor pão de queijo da região; vá antes das 9h, acaba rápido.")).toBe(false);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(isGenericPt("  conheça X e descubra seus charmes. reserve um tempo para passear sem pressa.  ")).toBe(true);
  });
});

describe("isGenericEn", () => {
  it("matches the real generic template from the 6-city import", () => {
    expect(isGenericEn("Visit X and discover its architecture and history. Allow time to explore the surrounding Y area at an easy pace.")).toBe(true);
  });

  it("matches other opening verbs with the telltale phrase", () => {
    expect(isGenericEn("Discover this amazing spot. Allow time to enjoy it at an easy pace.")).toBe(true);
    expect(isGenericEn("Explore the museum and discover its secrets.")).toBe(true);
  });

  it("requires BOTH the opening verb and a telltale phrase", () => {
    expect(isGenericEn("Visit this amazing restaurant, known for its fresh seafood and ocean view.")).toBe(false);
    expect(isGenericEn("This is a great place. Allow time to enjoy it at an easy pace.")).toBe(false);
  });

  it("does not match an original description", () => {
    expect(isGenericEn("Tiny neighborhood bakery famous for its cheese bread; go before 9am, it sells out fast.")).toBe(false);
  });
});

describe("isGenericDescriptions", () => {
  it("matches when pt is generic even if en is fine", () => {
    expect(
      isGenericDescriptions({
        pt: "Conheça X e descubra seus encantos. Reserve um tempo para passear sem pressa.",
        en: "A tiny bakery famous for its cheese bread; go before 9am.",
      }),
    ).toBe(true);
  });

  it("matches when en is generic even if pt is fine", () => {
    expect(
      isGenericDescriptions({
        pt: "Padaria de bairro famosa pelo pão de queijo; vá antes das 9h.",
        en: "Visit X and discover its architecture. Allow time to explore the area at an easy pace.",
      }),
    ).toBe(true);
  });

  it("does not match when neither language is generic", () => {
    expect(
      isGenericDescriptions({
        pt: "Padaria de bairro famosa pelo pão de queijo; vá antes das 9h.",
        en: "A tiny bakery famous for its cheese bread; go before 9am.",
      }),
    ).toBe(false);
  });

  it("tolerates missing pt or en", () => {
    expect(isGenericDescriptions({ en: "A tiny bakery famous for its cheese bread." })).toBe(false);
    expect(isGenericDescriptions({})).toBe(false);
  });
});
