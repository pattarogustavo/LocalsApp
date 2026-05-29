# Voyage App TODO

- [x] Initialize Expo project with mobile scaffold
- [x] Generate app icon (compass rose on deep green)
- [x] Configure design system (Voyage colors, typography)
- [x] Update app.config.ts with Voyage branding
- [x] Create Trip types (TypeScript)
- [x] Create Zustand store for trips management with AsyncStorage persistence
- [x] Create utility functions (date formatting, trip helpers)
- [x] Create Home Screen with Por Vir / Já Aconteceram sections
- [x] Create TripCard and TripCardStacked components
- [x] Create CreateTripSheet bottom sheet modal
- [x] Create Trip Detail screen with hero image and tabs
- [x] Create TransportBlock component (flights, car, train)
- [x] Create DocumentsBlock component
- [x] Create ExpensesBlock component
- [x] Create TravelersBlock component
- [x] Create PlacesScreen component with categories and suggested places
- [x] Create PlaceDetailModal with maps/website links
- [x] Add design.md with full design documentation
- [x] Fix any TypeScript/build errors
- [x] Test navigation flow (Home → Trip Detail → back)
- [x] Add Guias Curados section on Home Screen
- [x] Add AI itinerary generation (OpenAI integration)
- [x] Add Google Places autocomplete for destination input
- [x] Add accommodation management UI
- [x] Fix Home Screen safe area spacing (background extends behind iPhone status bar)
- [x] Restore hero image on trip detail screen (real photo from destination)
- [x] Expand destination image map (40+ cities worldwide)
- [x] Save Google Places imageUrl to destination for hero image
- [ ] Add trip cover image picker
- [ ] Add currency selector in trip settings
- [ ] Add push notifications for flight alerts
- [ ] Final UI polish and animations

## Fase 2 — Novas funcionalidades

- [x] Google Places API autocomplete — só cidades/países, sem campo aberto
- [x] Sistema de planos (Free / Pro) com paywall para funcionalidades de IA
- [x] IA: fluxo "Criar com IA" — preferências de viagem → sugestão de destinos
- [x] IA: sugestão de lugares por categoria em cada destino
- [x] IA: geração de roteiro dia-a-dia (por preferências ou por lugares selecionados manualmente)
- [x] Campo "Roteiro Dia-a-Dia" na aba Geral (entre Transporte e Documentos)
- [x] Botão "Data" na tela de roteiro para editar datas
- [x] Botão "Destinos" na tela de roteiro para editar destinos
- [x] Renomear aba "Destinos" → "Geral"
- [x] Hospedagem por destino (Hotel ou Casa) com check-in/check-out por destino
- [x] Integrar IA em Lugares: botão "IA escolhe os lugares" + "Montar roteiro com selecionados"

## Fase 3 — Melhorias no Roteiro e Lugares

- [x] Moeda com bandeira do país no cabeçalho do roteiro (mesma linha do nome)
- [x] Nome criativo do roteiro baseado nas cidades de destino
- [x] Data + destinos na mesma linha no cabeçalho
- [x] Redesenhar bloco de Transporte (caixa maior, padrão visual da referência)
- [x] Roteiro dia-a-dia com timeline por horário (não por período)
- [x] Ícones de categoria no roteiro dia-a-dia
- [x] Link Google Maps com trajeto entre locais no roteiro
- [x] Tempo de deslocamento entre locais (Google Maps + ícone do meio de transporte)
- [x] Botão "Criar roteiro dia-a-dia" quando não há lugares selecionados
- [x] Tela Lugares: seção "Minha Viagem" + "Disponíveis" com busca e categorias
- [x] Adicionar/remover lugares com atualização automática do roteiro
- [x] Pop-up de detalhes do local: foto real, descrição, horário, site, telefone, upload de arquivo
- [x] IA avançada: perfil, estilo, ritmo, orçamento, restrições → roteiro otimizado
- [x] Dica do dia + custo estimado no final de cada dia do roteiro

## Fase 4 — Correções de UX

- [x] Remover sistema de paywall/remuneração (ajustar depois com layout final)
- [x] Aba Geral: mostrar dias do roteiro mesmo sem itinérário criado
- [x] Aba Geral: botão vazio direciona para aba "Lugares"
- [x] Lugares: campo de busca abaixo das categorias de "Minha Viagem"
- [x] Lugares: botão "Criar roteiro com IA" na linha de cima de "Minha Viagem"
- [x] Lugares: seção "Disponíveis" carrega automaticamente (sem precisar clicar em "Sugerir com IA")

## Fase 5 — Fotos, Viajantes e Melhorias

- [x] Moedas em coluna no header do roteiro (uma por linha, alinhadas à direita)
- [x] Fix bug: múltiplos destinos mostram apenas bandeira do primeiro
- [x] Foto de capa personalizada (galeria ou câmera)
- [x] Álbum de fotos da viagem compartilhado com todos os viajantes
- [x] Edição do roteiro dia-a-dia (long-press para deletar parada)
- [x] Sistema de viajantes com conta na plataforma (convite por e-mail, badge de status pendente/ativo)

## Fase 6 — Transporte, Fotos e Roteiro

- [x] Aba "Fotos" dedicada no trip detail (grade 3x3, contador, fullPage mode)
- [x] Time picker para editar horário de parada do roteiro dia-a-dia (tap no horário)
- [x] Notificações de voo automáticas (check-in 24h antes, embarque 2h antes)
- [x] Reestruturar TransportBlock: seção "Entre Destinos" com voos reais por trajeto
- [x] Seção "Dentro da Cidade" no TransportBlock (modo de transporte urbano)
- [x] Voo com número obrigatório + seletor de trajeto (leg)
- [x] QR code / imagem da passagem aérea (câmera ou galeria, visualizador em tela cheia)

## Fase 7 — Integração AviationStack + Card de Voo

- [x] Salvar AVIATIONSTACK_API_KEY como secret no servidor
- [x] Endpoint tRPC: buscar voo por número + data via AviationStack
- [x] Endpoint tRPC: atualizar status de voo em tempo real
- [x] Redesenhar FlightCard no estilo da referência (cidade/IATA/horário/duração/status)
- [x] Redesenhar NextTransportCard com mesmo padrão visual
- [x] Novo modal de adicionar voo: apenas número + data, busca automática
- [x] Notificação 4h antes do embarque (substituir 2h anterior)

## Fase 8 — Google Directions API

- [x] Salvar GOOGLE_DIRECTIONS_API_KEY como secret no servidor
- [x] Endpoint tRPC: calcular rota/tempo entre dois pontos (lat/lng ou endereço) com modo de transporte
- [x] Itinerary block: botão "Atualizar trajetos" que recalcula tempos reais entre paradas
- [x] Link Google Maps com rota real entre paradas (tap no conector de trajeto)
- [x] Ícone de transporte correto (a pé, carro, metrô, bicicleta) no conector de trajeto
- [x] IA gera lat/lng reais para cada parada e usa cityTransportMode no prompt

## Fase 9 — Transporte de Carro

- [x] Modal de Carro: campos de endereço origem e destino
- [x] Sugestão automática do hotel como endereço de origem/destino
- [x] Campo de horário de chegada desejado com DateTimePickerField
- [x] Botão "Calcular rota" via Google Directions com resultado de tempo e distância
- [x] Cálculo do horário de saída = chegada desejada - tempo de percurso
- [x] Notificação 1h antes do horário de saída calculado
- [x] CarCard para exibir trajeto de carro com endereços, horários e duração

## Fase 10 — UX Melhorias Gerais

- [x] Tela inicial: cards de roteiro com separação e altura maior (52% da tela), 1/3 do próximo card visível
- [x] Aba Geral: data e destinos na mesma linha (data esquerda, destinos direita)
- [x] DatePicker: rolo centralizado verticalmente ao abrir
- [x] Transporte: reordenar tipos (Voo, Carro, Trem, Ônibus, Barco, Outro)
- [x] Transporte Carro: campos de endereço via Google Places (PlacesAutocompleteInput), campo para contrato de locação (PDF/foto)
- [x] Transporte Trem: estação origem/destino via Google, horário saída/chegada em DateTimePicker, número do bilhete, alerta 1h, anexo bilhete
- [x] Transporte Ônibus: mesmo formato do trem
- [x] Transporte Barco: mesmo formato do trem
- [x] Transporte Outros: apenas nome, horário saída e horário chegada
- [x] Hotel: nome do hotel via Google Places com endereço preenchido automaticamente
- [x] Hotel: reordenar campos (tipo → datas check-in/check-out → nome do local)
- [x] Hotel: Casa/Apartamento apenas campo de endereço via Google (sem nome do local)
- [x] Hotel: remover tipos Airbnb e Hostel
- [x] Hotel: campo de anexo (PDF/foto) da confirmação em todos os tipos

## Fase 11 — Timeline e Rotas Melhoradas

- [x] Hotel auto-aparece na timeline para os dias reservados; endereço do hotel usado como ponto de partida do dia
- [x] Links Google Maps na timeline mostram rota origem→destino (não apenas pin de localização)
- [x] Tempo de rota e links Maps usam o meio de transporte informado pelo usuário na aba Transporte

## Fase 12 — Melhorias de UI e Roteiro

- [ ] Campo "Início da viagem" com texto mais escuro no celular (cor do placeholder/valor visível)
- [ ] Corrigir moeda, bandeira e foto para destinos como Maiorca e Milão
- [ ] Painel de Destinos: adicionar novo destino + arrastar para reordenar + validação de dias totais
- [ ] Painel de Data: adicionar edição de quantidade de dias do roteiro
