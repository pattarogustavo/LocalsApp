# curate:import

Importa lugares curados a partir de um ou mais arquivos JSON, sem chamar
nenhuma API paga (IA ou tradução) por padrão. Útil para colar o resultado de
uma conversa de chat (pesquisa feita fora deste repositório) direto no banco,
já passando pela mesma validação, normalização e verificação no Google
Places usadas por `curate:add` e `curate:generate`.

```
pnpm curate:import --file=import/lisbon-pt.json
pnpm curate:import --dir=import --status=approved --translate
pnpm curate:import --file=import/lisbon-pt.json --dry-run
```

Flags:

- `--file=<arquivo.json>` ou `--dir=<pasta>` (exatamente um dos dois)
- `--status=pending|approved` (padrão: `pending`)
- `--translate` — preenche `es`/`fr`/`de`/`it` a partir de `en` (ou `pt`) via
  modelo de tradução, só para os lugares que serão de fato gravados
- `--dry-run` — não grava nada; imprime o que seria feito
- `--yes` — pula a confirmação interativa `"sim"` antes de escrever no banco
- `--max-google-calls=<n>` — teto de chamadas ao Google Places nesta execução

Com `--dir`, todos os `.json` da pasta são processados em ordem alfabética.
Cada cidade é independente: um arquivo com JSON inválido, ou uma cidade cuja
resolução falhe, é reportado como falha e não impede as demais de seguirem.

O comando é idempotente — rodar de novo o mesmo arquivo não duplica nada
(mesma trava `onConflictDoNothing` por `(destinationId, googlePlaceId)` usada
pelo resto da curadoria).

## Formato do arquivo

Uma cidade:

```json
{
  "destination": {
    "slug": "porto-pt",
    "nameEn": "Porto",
    "namePt": "Porto",
    "country": "Portugal",
    "countryCode": "PT",
    "tier": "medium"
  },
  "places": [
    {
      "name": "Livraria Lello",
      "neighborhood": "Baixa",
      "category": "attraction",
      "tags": ["culture", "art"],
      "priceTier": null,
      "meals": null,
      "cuisine": null,
      "confidence": "high",
      "descriptions": {
        "pt": "Uma das livrarias mais bonitas do mundo...",
        "en": "One of the world's most beautiful bookstores..."
      }
    }
  ]
}
```

Várias cidades em um arquivo:

```json
{ "cities": [ { "destination": { ... }, "places": [ ... ] }, { "destination": { ... }, "places": [ ... ] } ] }
```

O arquivo pode vir dentro de um bloco ```` ```json ... ``` ```` (copiado de um
chat) ou com texto antes/depois — o comando extrai o primeiro objeto JSON
balanceado e ignora o resto.

Veja um exemplo completo em
[`scripts/data/examples/import-example.json`](../scripts/data/examples/import-example.json).

### Campos de `destination`

O destino é identificado pelo `slug`:

- Se o slug já existir em `scripts/data/destinations.ts` **ou** na tabela
  `curated_destinations`, o destino existente é usado como está — os demais
  campos do bloco (`nameEn`, `country`, `tier`, ...) são ignorados.
- Se o slug for novo, uma linha é criada em `curated_destinations` com
  exatamente os campos dados, resolvendo o `googlePlaceId` da cidade via
  Google Places.

### Campos de cada lugar em `places`

| Campo          | Obrigatório | Observações |
|----------------|-------------|--------------|
| `name`         | sim         | nome a verificar no Google |
| `neighborhood` | não         | ajuda a desambiguar a busca no Google |
| `category`     | não         | um de `attraction, museum, park, beach, market, neighborhood, restaurant, cafe, hidden_gem, other`, ou um sinônimo comum (`landmark`, `church`, `food market`, ...). Se faltar, é inferida a partir dos `types` que o Google devolve para o lugar. |
| `tags`         | não         | subconjunto de `culture, gastronomy, nature, adventure, shopping, relaxation, nightlife, art`; uma tag desconhecida é descartada, e a lista cai para `["culture"]` se ficar vazia |
| `priceTier`    | não         | `budget`, `moderate` ou `luxury` |
| `meals`        | não         | subconjunto de `breakfast, lunch, dinner, snack` |
| `cuisine`      | não         | texto livre |
| `confidence`   | não         | `high`, `medium` ou `low` (padrão `medium`) |
| `descriptions` | sim*        | `{ pt?, en?, es?, fr?, de?, it? }` — exige **pelo menos** `pt` ou `en` |

Cada lugar é verificado no Google Places com a busca `"name, neighborhood,
cidade"` e as mesmas regras de `curate:add` (formato do place_id, tipos,
distância ao centro, status, nome) — incluindo aceitar um resultado do tipo
`neighborhood`/`sublocality`. Um lugar sem correspondência válida é
reportado como rejeitado, não grava nada, e não interrompe os demais.

## Prompt de instruções do chat

Texto para colar em uma conversa de chat (ChatGPT, Claude, etc.) pedindo uma
lista de lugares curados para uma cidade, no formato que `curate:import`
espera:

```
Você vai montar uma lista de lugares curados para [CIDADE, PAÍS] no formato
JSON abaixo, para importação em um catálogo de viagens. Responda APENAS com
o JSON, sem texto antes ou depois.

Formato:
{
  "destination": {
    "slug": "cidade-xx",        // kebab-case + código de país ISO-2 em minúsculas
    "nameEn": "Nome em inglês",
    "namePt": "Nome em português",
    "country": "Nome do país em inglês",
    "countryCode": "XX",        // ISO 3166-1 alpha-2
    "tier": "mega|large|medium|small"  // mega: capital turística global; large: grande destino; medium: cidade média; small: cidade pequena
  },
  "places": [
    {
      "name": "Nome exato e verificável no Google Maps",
      "neighborhood": "Bairro (opcional, mas ajuda a desambiguar)",
      "category": "attraction|museum|park|beach|market|neighborhood|restaurant|cafe|hidden_gem|other",
      "tags": ["culture|gastronomy|nature|adventure|shopping|relaxation|nightlife|art", "..."],
      "priceTier": "budget|moderate|luxury ou null (só para restaurant/cafe)",
      "meals": ["breakfast|lunch|dinner|snack"] ou null,
      "cuisine": "tipo de cozinha ou null (só para restaurant/cafe)",
      "confidence": "high|medium|low",
      "descriptions": {
        "pt": "2-3 frases em português, sem citar preço/horário/avaliação",
        "en": "mesma descrição em inglês"
      }
    }
  ]
}

Regras:
- Use nomes reais e verificáveis no Google Maps — nunca invente lugares.
- category e tags: use exatamente os valores listados acima.
- descriptions.pt e descriptions.en são obrigatórias nas duas.
- Não inclua preço, horário de funcionamento, nota/avaliação ou endereço na
  descrição — isso vem do Google, não da curadoria.
- Gere entre 20 e 60 lugares, cobrindo atrações, museus, restaurantes
  (maioria de culinária local), cafés, mercados, bairros e alguns "hidden
  gems".
```

## Testes

`tests/curate-import-json.test.ts`, `tests/curate-import-validate.test.ts`,
`tests/curate-import-cli.test.ts`, `tests/curate-import-translate.test.ts` e
`tests/curate-import-run.test.ts` cobrem o parsing tolerante de JSON, a
normalização/validação de cada lugar, o parsing de flags, o preenchimento de
traduções e a resolução/dedupe de lugares (incluindo idempotência).
