# Voyage — Design Document

## Brand Identity

**Voyage** is a premium mobile travel planning app. The visual identity communicates sophistication, calm, exclusivity, and a cinematic editorial feeling — inspired by Apple's first-party apps combined with Wanderlog, TripIt, Airbnb, and Notion.

## Color Palette

| Token | Light Value | Usage |
|-------|-------------|-------|
| `primary` | `#1C3D2E` | Deep forest green — buttons, headers, primary actions |
| `secondary` | `#3D5A47` | Olive green — secondary elements |
| `background` | `#F5F0E8` | Warm off-white / cream — main background |
| `surface` | `#EDE8DC` | Slightly warmer cream — cards, inputs |
| `card` | `#1C3D2E` | Dark green — trip detail cards (glassmorphism) |
| `accent` | `#52B788` | Soft green — highlights, badges, icons |
| `foreground` | `#1C3D2E` | Dark green text |
| `muted` | `#6B7C72` | Subdued text, labels |

## Typography

- **Display / Headers**: Serif italic (system serif / Playfair Display style) — used for "Voyage", trip names, modal titles
- **Body / UI**: Inter / system sans-serif — used for labels, descriptions, data
- **Micro labels**: All-caps, letter-spaced, 10-12px — used for section headers ("POR VIR", "DOCUMENTOS")

## Screen List

### 1. Home Screen (`/`)
The main entry point. Shows the Voyage logo header with action buttons (+, search, menu). Displays trips in two sections: "Por Vir" (upcoming) and "Já Aconteceram" (past), using a stacked card layout. When no trips exist, shows a hero CTA card. Below, a horizontal scroll of "Guias Curados" (curated guides).

### 2. Create Trip Sheet (bottom modal)
A bottom sheet modal triggered by the + button. Contains: start date picker, days stepper (+/-), destination input with autocomplete, per-destination day distribution, "Criar com IA" button, and "Criar Roteiro" CTA.

### 3. Trip Detail Screen (`/trip/[id]`)
Full-screen view with a large hero image (destination photo), dark overlay gradient, trip title in serif italic, and destination/country subtitle. A currency badge appears top-right. Below the hero, a horizontal scrollable tab bar with: Destinos, Transporte, Hospedagem, Lugares, História.

### 4. Destinos Tab (default)
Shows stacked dark green cards for: Transport (flight info), Documents, Playlist do Destino, Expenses, and Travelers.

### 5. Transporte Tab
Dedicated transport management. Shows flight cards with origin → destination, flight number, duration, terminal, gate, and status.

### 6. Hospedagem Tab
Accommodation management. Empty state with add CTA. Shows hotel/Airbnb cards with check-in/check-out dates.

### 7. Lugares Tab
Places management with search, category filters (Todos, Atrações, Restaurantes, Cafés, Museus, Hidden Gems), destination filter, and suggested places list. Each place has a detail modal with image, address, hours, and Maps/Site buttons.

### 8. História Tab
Cultural and historical context for the destination.

## Key User Flows

**Create a trip:**
Home → Tap + → CreateTripSheet → Select date → Set days → Add destination → Tap "Criar Roteiro" → Trip Detail

**Add a place:**
Trip Detail → Lugares tab → Browse suggestions → Tap "Adicionar" → Place added to trip

**Add transport:**
Trip Detail → Transporte tab → Tap + in TransportBlock → Select mode → Fill details → Confirm

**Add expense:**
Trip Detail → Destinos tab → ExpensesBlock → Tap "+ Adicionar" → Fill form → Confirm

## Visual Style

- **Border radius**: Large (16-24px for cards, 12-14px for inputs)
- **Shadows**: Soft, minimal
- **Glassmorphism**: Dark green translucent cards (`rgba(28,61,46,0.85)`) on dark backgrounds
- **Hero images**: Full-width with dark gradient overlay
- **Animations**: Smooth transitions, scale on touch
- **Scroll**: Fluid, no visible scrollbars

## Component Hierarchy

```
App
├── Home Screen
│   ├── Header (logo + action buttons)
│   ├── TripCardStacked (Por Vir)
│   ├── TripCardStacked (Já Aconteceram)
│   ├── CuratedGuides (horizontal FlatList)
│   └── CreateTripSheet (modal)
└── Trip Detail Screen
    ├── HeroImage + gradient overlay
    ├── TabBar (horizontal scroll)
    └── Tab Content
        ├── DestinationsTab
        │   ├── TransportBlock
        │   ├── DocumentsBlock
        │   ├── PlaylistBlock
        │   ├── ExpensesBlock
        │   └── TravelersBlock
        ├── TransportTab
        ├── AccommodationTab
        ├── PlacesScreen
        │   └── PlaceDetailModal
        └── HistoryTab
```
