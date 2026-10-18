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

export interface RedescribeItem {
  id: string;
  name: string;
  neighborhood?: string;
  category: string;
  cuisine?: string;
}

/**
 * curate:redescribe's rewrite prompt: a single call (no web search, no
 * forced output schema — see buildRedescribeFormatInstructions) for up to
 * 12 places of the same city, each already identified (name, neighborhood,
 * category, cuisine) — only the description is being replaced, never the
 * place's identity. Explicitly bans the generic template phrases this
 * command exists to get rid of, forbids exact prices/hours/menu items since
 * those go stale fast and were never verified here, and bans comparative or
 * self-contradictory claims (e.g. "better than X because it's not X").
 */
export function buildRedescribePrompt(destinationName: string, country: string, items: RedescribeItem[]): string {
  const list = items
    .map((i) => `- id=${i.id} | ${i.name}${i.neighborhood ? ` (${i.neighborhood})` : ""} | categoria: ${i.category}${i.cuisine ? ` | culinária: ${i.cuisine}` : ""}`)
    .join("\n");
  return [
    `Você é um curador local especializado em ${destinationName}, ${country}.`,
    "Para cada lugar abaixo, escreva uma descrição ORIGINAL de até ~300 caracteres, em 1 a 2 frases, em português e a mesma em inglês: o que torna o lugar especial, mais UMA dica prática específica (melhor horário para ir, o que pedir ou não perder, se é preciso reservar com antecedência, etc.).",
    'Nunca use fórmulas genéricas como "reserve um tempo", "descubra", "sem pressa", "vale a pena conhecer" — cada descrição deve ser específica para este lugar, nunca intercambiável com outro da lista.',
    "Descreva o lugar pelo que ele É, nunca por comparação com outro lugar — nenhuma afirmação comparativa (\"melhor que X\", \"ao contrário de Y\") e nenhuma frase que se contradiga (ex.: dizer que um lugar compensa por NÃO ser outra coisa, e no mesmo fôlego dizer que ele SE TORNA essa outra coisa).",
    "No inglês, traduza o SENTIDO do português sem trocar os fatos citados (nomes de obras, artistas, períodos, etc.) por outros — nunca generalize um fato específico (ex.: se o português diz \"de Rodin a Tarsila\", o inglês deve dizer o mesmo, nunca algo genérico como \"Rodin-style sculpture\").",
    "Não copie texto de sites, não informe preços ou horários exatos, e não afirme fatos que mudam rápido (um prato específico do menu, um evento datado).",
    "Se você não conhecer bem o lugar o suficiente para dizer algo específico e verdadeiro, escreva uma descrição curta e neutra, sem inventar detalhes, e marque lowKnowledge=true; só marque lowKnowledge=false quando tiver confiança no que escreveu.",
    "Nunca repita a mesma frase inicial entre dois lugares desta lista — varie a abertura de cada descrição.",
    "",
    buildRedescribeFormatInstructions(),
    "",
    "--- LUGARES ---",
    list,
  ].join("\n");
}

/**
 * The exact JSON Lines output contract for buildRedescribePrompt: one
 * complete, valid JSON object per line, nothing else. Chosen over a forced
 * output schema because the schema path was observed double-encoding long
 * free text (e.g. `{"places": "{\"places\":[...]}"}`) — plain JSON Lines
 * gives the model less structure to get wrong, and a bad line here only
 * costs that one id (see scripts/curate/jsonl.ts), not the whole batch.
 */
export function buildRedescribeFormatInstructions(): string {
  return [
    "FORMATO DA RESPOSTA — siga exatamente, é parseado por máquina:",
    '- Responda em JSON Lines: UMA linha por lugar, cada linha um objeto JSON completo e válido: {"id":"123","pt":"...","en":"...","lowKnowledge":false}',
    "- Nenhum markdown, nenhuma lista com marcadores, nenhum texto antes ou depois das linhas, nenhuma linha vazia entre elas.",
    "- Nunca quebre uma linha no meio de um objeto — cada objeto cabe inteiro em uma única linha.",
    "- Dentro de pt/en, nunca use aspas duplas — use aspas simples se precisar citar algo.",
    "- Mantenha o id exatamente como foi passado, uma linha por id, na mesma ordem da lista.",
  ].join("\n");
}

/** curate:redescribe's shortening retry: asked only for a single overlong pt/en text that otherwise passed validation, never for the whole batch again. Plain text response (no JSON), trimmed as-is. */
export function buildShortenPrompt(text: string, lang: "pt" | "en"): string {
  const languageName = lang === "pt" ? "português" : "inglês";
  return [
    `O texto abaixo (em ${languageName}) está longo demais. Reescreva-o em no máximo 280 caracteres, mantendo o idioma, o sentido e os fatos específicos citados — apenas mais direto e conciso.`,
    "Responda APENAS com o texto reescrito, sem aspas, sem explicações, sem markdown.",
    "",
    text,
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
