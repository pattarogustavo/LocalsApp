import type { Trip } from '@/types/voyage';

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function formatDate(dateStr: string, format: 'short' | 'medium' | 'long' = 'medium'): string {
  const date = new Date(dateStr);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  if (format === 'short') {
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }
  if (format === 'medium') {
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  return `${days[date.getDay()]}, ${date.getDate()} de ${monthsFull[date.getMonth()]} de ${date.getFullYear()}`;
}

export function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr);
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return days[date.getDay()];
}

export function getDaysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getDaysSince(dateStr: string): number {
  return -getDaysUntil(dateStr);
}

export function isTripUpcoming(trip: Trip): boolean {
  return getDaysUntil(trip.startDate) > 0;
}

export function isTripPast(trip: Trip): boolean {
  return getDaysUntil(trip.endDate) < 0;
}

export function isTripOngoing(trip: Trip): boolean {
  const daysUntilStart = getDaysUntil(trip.startDate);
  const daysUntilEnd = getDaysUntil(trip.endDate);
  return daysUntilStart <= 0 && daysUntilEnd >= 0;
}

export function getTripBadge(trip: Trip): string {
  const daysUntil = getDaysUntil(trip.startDate);
  const daysSince = getDaysSince(trip.endDate);

  if (daysUntil > 0) {
    return `em ${daysUntil} dias`;
  } else if (daysSince > 0) {
    return `há ${daysSince} dias`;
  } else {
    return 'hoje';
  }
}

export function getTripName(trip: Trip): string {
  if (trip.name) return trip.name;
  const destNames = trip.destinations.map((d) => d.name).join(', ');
  return `${trip.totalDays} Dias em ${destNames}`;
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    BRL: 'R$',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    ARS: '$',
    CLP: '$',
    MXN: '$',
    CAD: 'CA$',
    AUD: 'A$',
  };
  return symbols[currency] || currency;
}

export function getCountryFlag(country: string): string {
  const flags: Record<string, string> = {
    'Brasil': '🇧🇷',
    'United States': '🇺🇸',
    'France': '🇫🇷',
    'Italy': '🇮🇹',
    'United Kingdom': '🇬🇧',
    'Japan': '🇯🇵',
    'Spain': '🇪🇸',
    'Portugal': '🇵🇹',
    'Germany': '🇩🇪',
    'Argentina': '🇦🇷',
  };
  return flags[country] || '🌍';
}

export function getTotalExpenses(trip: Trip): number {
  return trip.expenses.reduce((sum, e) => sum + e.amount, 0);
}

export function getTotalSpots(trip: Trip): number {
  return trip.places.length;
}
