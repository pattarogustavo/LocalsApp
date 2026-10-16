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
  /** How many places to propose in this call — always <= MAX_PLACES_PER_BATCH. Never a forced quota: see the "fewer than asked" rule below. */
  batchSize: number;
  /** Previously proposed names (any group, any batch) to exclude so lots never repeat a place. */
  excludeNames?: string[];
  /** Set only for a complement round: describes specifically what's still missing. */
  onlyMissing?: string;
  /** Set only for the icon batch (group I): frames the ask as "the city's biggest icons" instead of the normal goal-driven batch. */
  isIconBatch?: boolean;
}

/**
 * Step 1 prompt: free-text research call (web search enabled, no forced
 * schema) for a SINGLE small batch within one group (A/B/C/D — see
 * scripts/curate/batches.ts). Every batch shares the same quality bar:
 * real, locally-recommended, currently open places with an original 1-2
 * sentence description — never copied from a source. No category quota is
 * ever forced: the batch size is a ceiling, and the model is explicitly told
 * to reflect what the city actually has (many beaches/parks/museums, or few
 * of any of them) rather than distribute evenly across categories.
 */
export function buildResearchPrompt(params: ResearchPromptParams): string {
  const { destinationName, country, goals, group, groupLabel, batchSize, excludeNames, onlyMissing, isIconBatch } = params;

  const lines = [
    `Você é um curador local especializado em ${destinationName}, ${country}.`,
    isIconBatch
      ? `Proponha até ${batchSize} lugares com os MAIORES ÍCONES de ${destinationName} — os lugares que qualquer guia de viagem cita primeiro e que definem a cidade (ex.: em Londres: Buckingham Palace, Big Ben/Casas do Parlamento, Trafalgar Square, Covent Garden, Camden Market, Notting Hill/Portobello Road, Hyde Park).`
      : onlyMissing
        ? `Esta é uma rodada de complementação do grupo "${groupLabel}": proponha apenas ${onlyMissing}.`
        : `Proponha até ${batchSize} lugares do grupo "${groupLabel}" para esta cidade.`,
    "",
    "Regras gerais, válidas para todo lugar proposto:",
    "- Proponha o que realmente importa nesta cidade, na ordem de relevância — nunca force uma distribuição por categoria. Se a cidade tiver muitos lugares de um mesmo tipo (museus, praias, parques, etc.), reflita isso na lista; se tiver poucos lugares relevantes, devolva menos do que foi pedido em vez de completar a cota com itens fracos.",
    "- Evite lugares quase idênticos entre si (ex.: duas praias ou dois mercados muito parecidos) — varie também bairros e interesses.",
    "- Só lugares em funcionamento HOJE — nunca um lugar fechado definitivamente ou que não existe mais.",
    "- Evite redes de fast-food e franquias (locais ou internacionais), exceto as realmente icônicas do destino.",
    "- Priorize o que moradores e guias respeitados realmente recomendam. Evite armadilhas de turista, exceto as genuinamente icônicas.",
    "- Nunca repita um lugar já proposto (veja a lista de exclusão abaixo, se houver).",
    '- Cada entrada deve ser UM único lugar pesquisável pelo seu nome oficial — nunca combine dois lugares em uma só entrada usando "&", " e ", " and ", "/" ou "+" (ex.: não proponha "Hyde Park & Kensington Gardens"; liste "Hyde Park" e "Kensington Gardens" como entradas separadas, ou proponha apenas o principal).',
    "",
    "Categorias disponíveis: attraction, museum, park (parque ou jardim), beach (praia), market (mercado de comida, flores, antiguidades ou de rua), neighborhood (bairro ou região para passear), restaurant, cafe, hidden_gem, other. Use a categoria mais específica possível — nunca force um lugar para attraction/other quando park/beach/market/neighborhood descreve melhor.",
    "",
    "Para cada lugar, informe: nome como é conhecido, bairro, categoria, tags relevantes (apenas dentre: culture, gastronomy, nature, adventure, shopping, relaxation, nightlife, art), faixa de preço (se restaurante/café), refeições em que se encaixa (breakfast, lunch, dinner, snack), tipo de culinária (se aplicável), se a culinária é local/típica ou estrangeira, seu nível de confiança (high/medium/low — o quanto é consenso entre fontes), prioridade relativa, e uma descrição ORIGINAL de 1 a 2 frases (o que ver ou fazer, mais uma dica prática) — nunca copiada de um site.",
  ];

  if (group === "B") {
    lines.push(
      "",
      "Só proponha estabelecimentos cuja atividade principal é servir refeições — nunca casas de show, bares sem cozinha ou clubes.",
      `Distribua os restaurantes entre as faixas budget, moderate e luxury, com pelo menos ${goals.perBudgetMin} em cada faixa.`,
      "Varie também as refeições cobertas (breakfast/lunch/dinner/snack) entre os restaurantes propostos.",
      `Pelo menos ${goals.localCuisineMinPct}% devem ser de culinária local/típica; no máximo 2 a 3 podem ser de referência mundial estrangeira.`,
    );
  }

  if (group === "C") {
    lines.push(
      "",
      "Cubra tanto café da manhã quanto lanche entre os cafés propostos.",
      "Cafeterias e padarias são categoria cafe; mercados de comida, flores, antiguidades ou de rua são categoria market.",
    );
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

/**
 * Structuring-only prompt for curate:add: the names were chosen manually by
 * a human editor (not researched), so this never asks the model to pick or
 * replace places — only to fill in the structured fields for exactly the
 * names given, in the same order, for pairing back to their Google match.
 */
export function buildManualStructurePrompt(destinationName: string, country: string, names: string[]): string {
  const list = names.map((n) => `- ${n}`).join("\n");
  return [
    `Você é um curador local especializado em ${destinationName}, ${country}.`,
    "Os lugares abaixo foram escolhidos manualmente por um editor humano — não pesquise alternativas, não substitua nenhum deles e não omita nenhum.",
    "Para CADA lugar da lista, na mesma ordem, produza: category, tags (apenas dentre: culture, gastronomy, nature, adventure, shopping, relaxation, nightlife, art), priceTier e meals (se for restaurante/café), cuisine (se aplicável), isLocalCuisine, confidence (sempre \"high\"), priority (sempre 1), e descriptionPt/descriptionEn ORIGINAIS de 1 a 2 frases cada (o que ver ou fazer, mais uma dica prática) — nunca copiadas de um site.",
    'Mantenha o campo "name" EXATAMENTE como está escrito na lista abaixo, sem traduzir ou reformatar — é usado para parear a resposta ao lugar original.',
    "",
    "--- LUGARES ---",
    list,
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
