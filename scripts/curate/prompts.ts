import type { TierGoals } from "../data/curation-config";
import { restaurantCandidateTarget, totalCandidateTarget } from "../data/curation-config";

export interface ResearchPromptParams {
  destinationName: string;
  country: string;
  goals: TierGoals;
  /** Previously proposed names to exclude — only set for complement rounds. */
  excludeNames?: string[];
  /** When set, describes specifically what's still missing (e.g. "mais 3 restaurantes"). */
  onlyMissing?: string;
}

/**
 * Step 1 prompt: free-text research call (web search enabled, no forced
 * schema). Asks for real, locally-recommended places across categories,
 * with original 1-2 sentence descriptions — never copied from a source.
 */
export function buildResearchPrompt(params: ResearchPromptParams): string {
  const { destinationName, country, goals, excludeNames, onlyMissing } = params;
  const restaurantTarget = restaurantCandidateTarget(goals);
  const totalTarget = totalCandidateTarget(goals);

  const lines = [
    `Você é um curador local especializado em ${destinationName}, ${country}.`,
    onlyMissing
      ? `Esta é uma rodada de complementação: proponha apenas ${onlyMissing}.`
      : `Proponha cerca de ${totalTarget} lugares no total, incluindo pelo menos ${restaurantTarget} opções de restaurantes de culinária LOCAL/típica.`,
    "",
    "Inclua: atrações e pontos turísticos, museus, restaurantes de culinária local/típica, cafés/padarias/mercados, e 'segredos de morador' (hidden gems).",
    "Priorize o que moradores e guias respeitados realmente recomendam. Evite armadilhas de turista, exceto as genuinamente icônicas.",
    "Varie bairros e interesses — não concentre tudo em uma única região.",
    "",
    "Para cada lugar, informe: nome como é conhecido, bairro, categoria, tags relevantes (apenas dentre: culture, gastronomy, nature, adventure, shopping, relaxation, nightlife, art), faixa de preço (se restaurante/café), refeições em que se encaixa (breakfast, lunch, dinner, snack), tipo de culinária (se aplicável), se a culinária é local/típica ou estrangeira, seu nível de confiança (high/medium/low — o quanto é consenso entre fontes), prioridade relativa, e uma descrição ORIGINAL de 1 a 2 frases (o que ver ou fazer, mais uma dica prática) — nunca copiada de um site.",
    `Pelo menos ${goals.localCuisineMinPct}% dos restaurantes devem ser de culinária local/típica; no máximo 2 a 3 podem ser de referência mundial estrangeira.`,
  ];

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

/** Step: batched es/fr/de/it translation prompt for a destination's approved places. */
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
