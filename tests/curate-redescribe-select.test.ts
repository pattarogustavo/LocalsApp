import { describe, expect, it } from "vitest";

import { selectRedescribeCandidates } from "../scripts/curate/redescribe-select";

const GENERIC = { pt: "Conheça X e descubra seus encantos. Reserve um tempo para passear sem pressa.", en: "ok fine description here" };
const ORIGINAL = { pt: "Padaria de bairro famosa pelo pão de queijo; vá antes das 9h.", en: "A tiny bakery famous for its cheese bread; go before 9am." };

describe("selectRedescribeCandidates", () => {
  it("selects only rows matching the generic template", () => {
    const rows = [
      { id: 1, descriptions: GENERIC },
      { id: 2, descriptions: ORIGINAL },
    ];
    const selected = selectRedescribeCandidates(rows);
    expect(selected.map((r) => r.id)).toEqual([1]);
  });

  it("never touches a row that doesn't match, even if requested", () => {
    const rows = [{ id: 1, descriptions: ORIGINAL }];
    expect(selectRedescribeCandidates(rows)).toEqual([]);
  });

  it("forces inclusion of a row via forcedIds regardless of its text", () => {
    const rows = [
      { id: 1, descriptions: ORIGINAL },
      { id: 2, descriptions: GENERIC },
    ];
    const selected = selectRedescribeCandidates(rows, new Set([1]));
    expect(selected.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it("tolerates null descriptions without throwing", () => {
    const rows = [{ id: 1, descriptions: null }];
    expect(selectRedescribeCandidates(rows)).toEqual([]);
  });
});
