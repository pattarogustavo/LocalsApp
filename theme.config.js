
/**
 * Todos os pares texto/fundo abaixo devem ser validados para contraste mínimo de
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
  background: { light: '#F2F2F7', dark: '#1C1C1E' },
  // Cartão/superfície elevada em relação ao background (linhas de lista,
  // inputs, chips). Mesmo valor de `card`.
  surface: { light: '#FFFFFF', dark: '#2C2C2E' },
  // Alias de `surface` — mantido por compatibilidade com código existente.
  card: { light: '#FFFFFF', dark: '#2C2C2E' },
  // Superfície "flutuante": sheets/modais que ficam por cima do conteúdo
  // (ex: modal de detalhe, bottom sheet). Um degrau mais claro que `surface`,
  // ainda com contraste garantido para todos os tokens de texto/status.
  cardElevated: { light: '#FFFFFF', dark: '#3A3A3C' },
  // Fundo do card de estado vazio (ex: "Nenhuma viagem ainda"). Bege sólido
  // ~18% mais escuro que `background`, para diferenciar o card do fundo da
  // tela sem depender de foto/gradiente.
  emptyStateBackground: { light: '#E5E5EA', dark: '#262628' },

  // ── Texto ─────────────────────────────────────────────────────────────────
  // Texto principal (títulos, valores, corpo de texto de destaque).
  foreground: { light: '#1C1C1E', dark: '#F5F5F7' },
  // Texto secundário/muted (legendas, descrições, labels auxiliares).
  // Ajustado para uma estética mais neutra, inspirada no sistema iOS.
  muted: { light: '#636366', dark: '#AEAEB2' },
  // Placeholder de campo de texto. Hoje mesmo valor de `muted` — mantido como
  // token próprio para podermos divergir no futuro sem tocar em texto muted.
  textPlaceholder: { light: '#636366', dark: '#AEAEB2' },
  // Texto/ícone desenhado em cima de um fundo sólido `primary` (ex: texto de
  // botão primário, ícone de badge preenchido). Substitui o padrão antigo
  // `const ON_PRIMARY = SchemeColors.light.background` duplicado em vários
  // arquivos. Constante nos dois esquemas porque `primary` também é.
  textOnPrimary: { light: '#FFFFFF', dark: '#FFFFFF' },
  // Texto/ícone com a cor de destaque da marca (labels de seção, links,
  // valores em negrito) desenhado DIRETO sobre background/surface — não
  // sobre um botão preenchido. Usa a mesma progressão de `tint`: no modo
  // escuro precisa ser mais claro que `primary` para manter 4.5:1
  // (primary puro dá só 2.25:1 no fundo escuro).
  textAccent: { light: '#3D5A2E', dark: '#6B9B52' },

  // ── Bordas ────────────────────────────────────────────────────────────────
  // Divisor decorativo/hairline (baixo contraste é intencional aqui).
  border: { light: '#D1D1D6', dark: '#38383A' },
  // Borda de campo de formulário (input, select). Mais forte que `border`
  // porque delimita um componente funcional — validada para 3:1 contra
  // background (WCAG 1.4.11).
  borderInput: { light: '#8E8E93', dark: '#8E8E93' },

  // ── Status ───────────────────────────────────────────────────────────────
  success: { light: '#3D5A2E', dark: '#6B9B52' },
  warning: { light: '#856328', dark: '#D4A855' },
  error: { light: '#B03D3D', dark: '#E07070' },
  accent: { light: '#886308', dark: '#D4A855' },
  // Tint genérico (usado por telas de debug/tema). Igual a `textAccent`.
  tint: { light: '#3D5A2E', dark: '#6B9B52' },
  // Terceira cor de destaque neutra (azul), para diferenciar uma 3ª opção
  // quando `primary`/`accent` já estão em uso nas outras duas (ex: os 3 modos
  // de criação de roteiro — IA do zero / IA com lugares / manual).
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
  tabIconInactive: { light: '#636366', dark: '#AEAEB2' },
};
module.exports = { themeColors };
