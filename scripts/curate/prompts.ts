import type { TierGoals } from "../data/curation-config";
import type { GroupKey } from "./batches";

export interface ResearchPromptParams {
  destinationName: string;
  country: string;
  goals: TierGoals;
  /** Which batch group this call is researching (A/B/C/D) — see scripts/curate/batches.ts. */
  group: GroupKey;
  /** Human-readable description of what the group covers, e.g. "restaurantes". */
  groupLabel: string;
  /** How many places to propose in this call — always <= MAX_PLACES_PER_BATCH. */
  batchSize: number;
  /** Category caps (scaled for this tier) relevant to this group, e.g. { museum: 15, attraction: 15 }. */
  categoryCaps?: Record<string, number>;
  /** Previously proposed names (any group, any batch) to exclude so lots never repeat a place. */
  excludeNames?: string[];
  /** Set only for a complement round: describes specifically what's still missing. */
  onlyMissing?: string;
}

/**
 * Step 1 prompt: free-text research call (web search enabled, no forced
 * schema) for a SINGLE small batch within one group (A/B/C/D — see
 * scripts/curate/batches.ts). Every batch shares the same quality bar:
 * real, locally-recommended, currently open places with an original 1-2
 * sentence description — never copied from a source.
 */
export function buildResearchPrompt(params: ResearchPromptParams): string {
  const { destinationName, country, goals, group, groupLabel, batchSize, categoryCaps, excludeNames, onlyMissing } = params;

  const lines = [
    `Você é um curador local especializado em ${destinationName}, ${country}.`,
    onlyMissing
      ? `Esta é uma rodada de complementação do grupo "${groupLabel}": proponha apenas ${onlyMissing}.`
      : `Proponha ${batchSize} lugares do grupo "${groupLabel}" (categoria: ${group}).`,
    "",
    "Regras gerais, válidas para todo lugar proposto:",
    "- Só lugares em funcionamento HOJE — nunca um lugar fechado definitivamente ou que não existe mais.",
    "- Evite redes de fast-food e franquias (locais ou internacionais), exceto as realmente icônicas do destino.",
    "- Priorize o que moradores e guias respeitados realmente recomendam. Evite armadilhas de turista, exceto as genuinamente icônicas.",
    "- Varie bairros — não concentre tudo em uma única região.",
    "- Nunca repita um lugar já proposto (veja a lista de exclusão abaixo, se houver).",
    '- Cada entrada deve ser UM único lugar pesquisável pelo seu nome oficial — nunca combine dois lugares em uma só entrada usando "&", " e ", " and ", "/" ou "+" (ex.: não proponha "Hyde Park & Kensington Gardens"; liste "Hyde Park" e "Kensington Gardens" como entradas separadas, ou proponha apenas o principal).',
    "",
    "Para cada lugar, informe: nome como é conhecido, bairro, categoria, tags relevantes (apenas dentre: culture, gastronomy, nature, adventure, shopping, relaxation, nightlife, art), faixa de preço (se restaurante/café), refeições em que se encaixa (breakfast, lunch, dinner, snack), tipo de culinária (se aplicável), se a culinária é local/típica ou estrangeira, seu nível de confiança (high/medium/low — o quanto é consenso entre fontes), prioridade relativa, e uma descrição ORIGINAL de 1 a 2 frases (o que ver ou fazer, mais uma dica prática) — nunca copiada de um site.",
  ];

  if (group === "B") {
    lines.push(
      "",
      `Distribua os restaurantes entre as faixas budget, moderate e luxury, com pelo menos ${goals.perBudgetMin} em cada faixa.`,
      "Varie também as refeições cobertas (breakfast/lunch/dinner/snack) entre os restaurantes propostos.",
      `Pelo menos ${goals.localCuisineMinPct}% devem ser de culinária local/típica; no máximo 2 a 3 podem ser de referência mundial estrangeira.`,
    );
  }

  if (group === "C") {
    lines.push("", "Cubra tanto café da manhã quanto lanche entre os cafés/padarias/mercados propostos.");
  }

  if (categoryCaps && Object.keys(categoryCaps).length > 0) {
    const capsText = Object.entries(categoryCaps)
      .map(([cat, cap]) => `${cat}: no máximo ${cap}`)
      .join("; ");
    lines.push("", `Respeite os tetos por categoria deste destino: ${capsText}.`);
  }

  if (excludeNames?.length) {
    lines.push("", `NÃO repita nenhum destes lugares, já propostos antes: ${excludeNames.join(", ")}.`);
  }

  return lines.join("\n");
}

/** Step 2 prompt: converts the step-1 free text into the structured list (sent together with outputSchema). */
export function buildStructurePrompt(researchText: string): string {
  return [
    "Converta a pesquisa de lugares abaixo em uma lista estruturada, seguindo exatamente o schema fornecido.",
    "Escreva descriptionPt e descriptionEn como traduções fiéis uma da outra, mantendo o conteúdo original da pesquisa (não invente nem copie de outra fonte).",
    "",
    "--- PESQUISA ---",
    researchText,
  ].join("\n");
}

export interface TranslateBatchItem {
  id: string | number;
  en: string;
}

/** Step: batched es/fr/de/it translation prompt for up to MAX_PLACES_PER_BATCH places at a time. */
export function buildTranslatePrompt(destinationName: string, items: TranslateBatchItem[]): string {
  const list = items.map((item) => `${item.id}: ${item.en}`).join("\n");
  return [
    `Traduza as descrições de lugares em ${destinationName} abaixo do inglês para espanhol, francês, alemão e italiano.`,
    "Mantenha o mesmo tom e nível de detalhe do original — tradução fiel, não um resumo.",
    "Responda seguindo exatamente o schema fornecido, uma entrada por id.",
    "",
    "--- DESCRIÇÕES (id: texto em inglês) ---",
    list,
  ].join("\n");
}
