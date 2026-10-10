import * as db from "./db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo's documented max messages per request.
const EXPO_PUSH_BATCH_SIZE = 100;

export type PushLanguage = "pt" | "en" | "es" | "fr" | "de" | "it";
const SUPPORTED_LANGUAGES: readonly PushLanguage[] = ["pt", "en", "es", "fr", "de", "it"];

export interface PushMessageContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

function normalizeLanguage(language: string | null | undefined): PushLanguage {
  const code = (language ?? "").slice(0, 2).toLowerCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code) ? (code as PushLanguage) : "pt";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

async function sendBatch(tokens: string[], messages: Record<string, unknown>[]): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => null);
    const tickets = json?.data as ExpoPushTicket[] | undefined;
    if (!Array.isArray(tickets)) {
      console.warn("[Push] Unexpected Expo push response shape:", json);
      return;
    }

    const staleTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === "error") {
        console.warn(`[Push] delivery error for token ${tokens[i]}:`, ticket.message, ticket.details);
        if (ticket.details?.error === "DeviceNotRegistered") {
          staleTokens.push(tokens[i]);
        }
      }
    });
    if (staleTokens.length > 0) {
      await Promise.all(staleTokens.map((t) => db.deletePushToken(t).catch(() => {})));
    }
  } catch (err) {
    console.warn("[Push] Expo push request failed:", err);
  }
}

const INVITE_MESSAGES: Record<PushLanguage, { title: string; body: (owner: string, trip: string) => string }> = {
  pt: { title: "Novo convite de viagem", body: (owner, trip) => `${owner} convidou você para ${trip}` },
  en: { title: "New trip invite", body: (owner, trip) => `${owner} invited you to ${trip}` },
  es: { title: "Nueva invitación de viaje", body: (owner, trip) => `${owner} te invitó a ${trip}` },
  fr: { title: "Nouvelle invitation de voyage", body: (owner, trip) => `${owner} vous a invité à ${trip}` },
  de: { title: "Neue Reiseeinladung", body: (owner, trip) => `${owner} hat dich zu ${trip} eingeladen` },
  it: { title: "Nuovo invito di viaggio", body: (owner, trip) => `${owner} ti ha invitato a ${trip}` },
};

/** The "you've been invited to a trip" push, localized per recipient device. */
export function buildTripInviteMessage(language: PushLanguage, ownerName: string, tripName: string): PushMessageContent {
  const texts = INVITE_MESSAGES[language] ?? INVITE_MESSAGES.pt;
  return {
    title: texts.title,
    body: texts.body(ownerName, tripName),
    data: { type: "invite" },
  };
}

/**
 * Sends a push notification to every device registered to any of `userIds`.
 * `buildMessage` is called once per device with that device's saved
 * language, so recipients on different app languages each get localized
 * content.
 *
 * Always fire-and-forget from the caller's perspective: every failure
 * (missing tokens, network error, malformed Expo response) is caught and
 * logged here, never thrown, so a caller can call this without `await` and
 * never have it affect their own response.
 */
export async function sendPush(
  userIds: number[],
  buildMessage: (language: PushLanguage) => PushMessageContent,
): Promise<void> {
  try {
    if (userIds.length === 0) return;
    const tokenRows = await db.getPushTokensForUsers(userIds);
    if (tokenRows.length === 0) return;

    const tokens = tokenRows.map((row) => row.token);
    const messages = tokenRows.map((row) => {
      const { title, body, data } = buildMessage(normalizeLanguage(row.language));
      return { to: row.token, title, body, data, sound: "default" as const };
    });

    for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH_SIZE) {
      await sendBatch(
        tokens.slice(i, i + EXPO_PUSH_BATCH_SIZE),
        messages.slice(i, i + EXPO_PUSH_BATCH_SIZE),
      );
    }
  } catch (err) {
    console.warn("[Push] sendPush failed:", err);
  }
}
