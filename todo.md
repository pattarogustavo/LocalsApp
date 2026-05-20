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
