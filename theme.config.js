/**
 * Todos os pares texto/fundo abaixo foram validados para contraste mínimo de
 * 4.5:1 (WCAG 2.1 AA, texto normal) e os pares de borda funcional para 3:1
 * (WCAG 1.4.11, componentes de UI não-textuais). Ver scripts de auditoria
 * usados para calcular os valores — luminância relativa + fórmula de
 * contraste padrão do WCAG.
 *
 * @type {const}
 */
const themeColors = {
  // ── Marca / ação ──────────────────────────────────────────────────────────
  // Verde-oliva escuro. Preenchimento de botões, tabs ativas, ícones de ação.
  // Constante nos dois esquemas — por isso NUNCA deve ser usado como cor de
  // TEXTO solta sobre background/surface (falha contraste no modo escuro,
  // 2.25:1). Para texto/ícone com essa identidade de marca, use `textAccent`.
  primary: { light: '#465639', dark: '#465639' },
  // Verde-oliva secundário, usado raramente (variação decorativa de primary).
  secondary: { light: '#4A6B38', dark: '#4A6B38' },

  // ── Superfícies ───────────────────────────────────────────────────────────
  // Fundo padrão da tela.
  background: { light: '#F0EBE0', dark: '#1A1A14' },
  // Cartão/superfície elevada em relação ao background (linhas de lista,
  // inputs, chips). Mesmo valor de `card`.
  surface: { light: '#F7F3EC', dark: '#252519' },
  // Alias de `surface` — mantido por compatibilidade com código existente.
  card: { light: '#F7F3EC', dark: '#252519' },
  // Superfície "flutuante": sheets/modais que ficam por cima do conteúdo
  // (ex: modal de detalhe, bottom sheet). Um degrau mais claro que `surface`,
  // ainda com contraste garantido para todos os tokens de texto/status.
  cardElevated: { light: '#FDFBF7', dark: '#26261A' },
  // Fundo do card de estado vazio (ex: "Nenhuma viagem ainda"). Bege sólido
  // ~18% mais escuro que `background`, para diferenciar o card do fundo da
  // tela sem depender de foto/gradiente.
  emptyStateBackground: { light: '#C5C1B8', dark: '#151510' },

  // ── Texto ─────────────────────────────────────────────────────────────────
  // Texto principal (títulos, valores, corpo de texto de destaque).
  foreground: { light: '#2C2416', dark: '#F0EBE0' },
  // Texto secundário/muted (legendas, descrições, labels auxiliares).
  // Ajustado no modo claro (era #8A7F6E, 3.31:1 — falhava) para #70675A
  // (4.68:1 contra background, 5.03:1 contra surface).
  muted: { light: '#70675A', dark: '#9A9080' },
  // Placeholder de campo de texto. Hoje mesmo valor de `muted` — mantido como
  // token próprio para podermos divergir no futuro sem tocar em texto muted.
  textPlaceholder: { light: '#70675A', dark: '#9A9080' },
  // Texto/ícone desenhado em cima de um fundo sólido `primary` (ex: texto de
  // botão primário, ícone de badge preenchido). Substitui o padrão antigo
  // `const ON_PRIMARY = SchemeColors.light.background` duplicado em vários
  // arquivos. Constante nos dois esquemas porque `primary` também é.
  textOnPrimary: { light: '#F0EBE0', dark: '#F0EBE0' },
  // Texto/ícone com a cor de destaque da marca (labels de seção, links,
  // valores em negrito) desenhado DIRETO sobre background/surface — não
  // sobre um botão preenchido. Usa a mesma progressão de `tint`: no modo
  // escuro precisa ser mais claro que `primary` para manter 4.5:1
  // (primary puro dá só 2.25:1 no fundo escuro).
  textAccent: { light: '#3D5A2E', dark: '#6B9B52' },

  // ── Bordas ────────────────────────────────────────────────────────────────
  // Divisor decorativo/hairline (baixo contraste é intencional aqui).
  border: { light: '#DDD5C5', dark: '#3A3828' },
  // Borda de campo de formulário (input, select). Mais forte que `border`
  // porque delimita um componente funcional — validada para 3:1 contra
  // background (WCAG 1.4.11).
  borderInput: { light: '#9A855A', dark: '#736F50' },

  // ── Status ────────────────────────────────────────────────────────────────
  success: { light: '#3D5A2E', dark: '#6B9B52' },
  // Ajustado no modo claro (era #A07830, 3.38:1 — falhava) para #856328
  // (4.63:1 contra background).
  warning: { light: '#856328', dark: '#D4A855' },
  // Ajustado no modo claro (era #B84040, só 4.59:1 — margem insuficiente)
  // para #B03D3D (4.93:1), consolidando os vários vermelhos de erro
  // hardcoded encontrados pelo app (#E74C3C, #C0392B, #EF4444).
  error: { light: '#B03D3D', dark: '#E07070' },
  // Ajustado no modo claro (era #B8860B, 2.74:1 — falhava feio) para #886308
  // (4.61:1). Usado para sublinhado/destaque decorativo e texto de avaliação
  // (ex: nota/estrela).
  accent: { light: '#886308', dark: '#D4A855' },
  // Tint genérico (usado por telas de debug/tema). Igual a `textAccent`.
  tint: { light: '#3D5A2E', dark: '#6B9B52' },
  // Terceira cor de destaque neutra (azul), para diferenciar uma 3ª opção
  // quando `primary`/`accent` já estão em uso nas outras duas (ex: os 3 modos
  // de criação de roteiro — IA do zero / IA com lugares / manual). Ajustada
  // no modo claro (era #7B9FD4 fixo, 2.28:1 — falhava) para #3969B0
  // (4.62:1 contra background, 4.97:1 contra surface).
  info: { light: '#3969B0', dark: '#7B9FD4' },

  // Estados de transporte (voo/traslado) — usados como cor de ícone/badge de
  // status "embarcando", "partiu", "chegou". Antes hardcoded e duplicados em
  // dois arquivos (next-transport-card.tsx e transport-block.tsx).
  statusBoarding: { light: '#0B5FE9', dark: '#4A8BF7' },
  statusDeparted: { light: '#763FF4', dark: '#9C74F7' },
  statusArrived: { light: '#0A7753', dark: '#10B981' },

  // ── Overlays ──────────────────────────────────────────────────────────────
  // Scrim por trás de modais/bottom sheets. Propositalmente igual nos dois
  // esquemas — é um fundo semitransparente preto, não uma superfície do
  // design system, então não precisa (nem deve) variar com o tema.
  overlayModal: { light: 'rgba(0,0,0,0.55)', dark: 'rgba(0,0,0,0.55)' },
  // Scrim mais forte para visualizadores em tela cheia (foto, cartão de
  // embarque). Mesma lógica de `overlayModal`, mais opaco.
  overlayScrim: { light: 'rgba(0,0,0,0.92)', dark: 'rgba(0,0,0,0.92)' },

  // ── Tab bar / segmented control ──────────────────────────────────────────
  // Ícone/label do item ativo. Igual a `textAccent` (ver comentário acima
  // sobre por que não é `primary` puro).
  tabIconActive: { light: '#3D5A2E', dark: '#6B9B52' },
  // Ícone/label do item inativo. Igual a `muted`.
  tabIconInactive: { light: '#70675A', dark: '#9A9080' },
};
module.exports = { themeColors };
