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
