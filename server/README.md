# Backend Development Guide

This guide covers server-side features including authentication, database, tRPC API, and integrations. **Only read this if your app needs these capabilities.**

---

## When Do You Need Backend?

| Scenario | Backend Needed? | User Auth Required? | Solution |
|----------|-----------------|---------------------|----------|
| Data stays on device only | No | No | Use `AsyncStorage` |
| Data syncs across devices | Yes | Yes | Database + tRPC |
| User accounts / login | Yes | Yes | Supabase Auth |
| AI-powered features | Yes | **Optional** | Anthropic (`invokeLLM`) |
| User uploads files | Yes | **Optional** | Supabase Storage |
| Server-side validation | Yes | **Optional** | tRPC procedures |

> **Note:** Backend ≠ User Auth. You can run a backend with LLM/Storage capabilities without requiring user login — just use `publicProcedure` instead of `protectedProcedure`. User auth is only mandatory when you need to identify users or sync user-specific data.

---

## File Structure

```
server/
  db.ts              ← Query helpers (add database functions here)
  routers.ts         ← tRPC procedures (add API routes here)
  storage.ts         ← Supabase Storage helpers (can extend)
  _core/             ← Framework-level code (don't modify)
drizzle/
  schema.ts          ← Database tables & types (add your tables here)
  relations.ts       ← Table relationships
  migrations/        ← Auto-generated migrations
shared/
  types.ts           ← Shared TypeScript types
  const.ts           ← Shared constants
  _core/             ← Framework-level code (don't modify)
lib/
  trpc.ts            ← tRPC client (can customize headers)
  supabase.ts        ← Supabase client (browser/native)
  _core/             ← Framework-level code (don't modify)
store/
  auth.ts            ← Supabase-backed auth state (Zustand)
hooks/
  use-auth.ts        ← Thin wrapper around store/auth.ts (don't modify)
tests/
  *.test.ts          ← Add your tests here
```

Only touch the files with "←" markers. Anything under `_core/` directories is framework-level—avoid editing unless you are extending the infrastructure.

---

## Authentication

### Overview

Auth is handled entirely by **Supabase Auth** (`@supabase/supabase-js`), used directly from the client — there is no custom OAuth exchange or session cookie dance.

| Platform | Session storage |
|----------|------------------|
| iOS/Android | `expo-secure-store` (via the Supabase client's storage adapter) |
| Web | `localStorage` |

Supported sign-in methods: email/password (`supabase.auth.signUp` / `signInWithPassword`), Apple Sign In (`supabase.auth.signInWithIdToken`), and password reset (`supabase.auth.resetPasswordForEmail`). See `app/auth/login.tsx`, `app/auth/register.tsx`, `app/auth/forgot-password.tsx`.

The backend never issues its own session tokens — it verifies the Supabase-issued JWT on every request using `SUPABASE_JWT_SECRET` (`server/_core/sdk.ts::authenticateRequest`), and auto-provisions a row in the local `users` table on first sign-in.

### Using the Auth Hook

```tsx
import { useAuth } from "@/hooks/use-auth";

function MyScreen() {
  const { user, isAuthenticated, loading, logout } = useAuth();

  if (loading) return <ActivityIndicator />;

  if (!isAuthenticated) {
    return <LoginButton />;
  }

  return (
    <View>
      <ThemedText>Welcome, {user.name}</ThemedText>
      <Button title="Logout" onPress={logout} />
    </View>
  );
}
```

`useAuth()` is a thin wrapper around `useAuthStore` (`store/auth.ts`), which owns the actual Supabase session. Screens that need more (subscription status, avatar, preferred language) should read `useAuthStore()` directly.

### User Object

```tsx
interface AuthUser {
  id: string; // Supabase UUID
  email: string | null;
  name: string | null;
  subscriptionStatus: "trial" | "active" | "expired" | "cancelled" | null;
  subscriptionPlan: "monthly" | "annual" | null;
  subscriptionExpiresAt: string | null;
  trialEndsAt: string | null;
  avatarUri?: string | null;
  preferredLanguage?: string | null;
}
```

### Protected Routes

Use `protectedProcedure` in tRPC to require authentication:

```tsx
// server/routers.ts
import { protectedProcedure } from "./_core/trpc";

export const appRouter = router({
  myFeature: router({
    getData: protectedProcedure.query(({ ctx }) => {
      // ctx.user is guaranteed to exist (verified Supabase JWT)
      return db.getUserData(ctx.user.id);
    }),
  }),
});
```

### Frontend: Handling Auth Errors

```tsx
try {
  await trpc.someProtectedEndpoint.mutate(data);
} catch (error) {
  if (error.data?.code === 'UNAUTHORIZED') {
    router.push('/auth/login');
    return;
  }
  throw error;
}
```

---

## Database

### Schema Definition

Define your tables in `drizzle/schema.ts`:

```tsx
import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

// Users table (already exists)
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(), // Supabase user UUID
  name: text("name"),
  email: varchar("email", { length: 320 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Add your tables
export const items = mysqlTable("items", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  completed: boolean("completed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Export types
export type User = typeof users.$inferSelect;
export type Item = typeof items.$inferSelect;
export type InsertItem = typeof items.$inferInsert;
```

### Running Migrations

After editing the schema, push changes to the database:

```bash
pnpm db:push
```

This runs `drizzle-kit generate` and `drizzle-kit migrate`.

### Query Helpers

Add database queries in `server/db.ts`:

```tsx
import { eq } from "drizzle-orm";
import { getDb } from "./_core/db";
import { items, InsertItem } from "../drizzle/schema";

export async function getUserItems(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(items).where(eq(items.userId, userId));
}

export async function createItem(data: InsertItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(items).values(data);
  return result.insertId;
}
```

---

## tRPC API

### Adding Routes

Define API routes in `server/routers.ts`:

```tsx
import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import * as db from "./db";

export const appRouter = router({
  // Public route (no auth required)
  health: publicProcedure.query(() => ({ status: "ok" })),

  // Protected routes (auth required)
  items: router({
    list: protectedProcedure.query(({ ctx }) => {
      return db.getUserItems(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1).max(255),
        description: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => {
        return db.createItem({
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
        });
      }),
  }),
});

export type AppRouter = typeof appRouter;
```

### Calling from Frontend

```tsx
import { trpc } from "@/lib/trpc";

function ItemList() {
  const { data: items, isLoading, refetch } = trpc.items.list.useQuery();

  const createMutation = trpc.items.create.useMutation({
    onSuccess: () => refetch(),
  });

  if (isLoading) return <ActivityIndicator />;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id.toString()}
      renderItem={({ item }) => <ItemCard item={item} />}
    />
  );
}
```

---

## LLM Integration

`invokeLLM` (`server/_core/llm.ts`) calls the Anthropic API directly via `@anthropic-ai/sdk`. Requires `ANTHROPIC_API_KEY`; the model defaults to `ANTHROPIC_MODEL` (falls back to `claude-sonnet-5`).

```ts
import { invokeLLM } from "./server/_core/llm";

const response = await invokeLLM({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello, world!" },
  ],
});

const text = response.choices[0].message.content;
```

The function signature is unchanged from before the migration (same `Message`/`Tool`/`ResponseFormat` shapes), so existing callers keep working. Under the hood:
- `system` messages become Anthropic's top-level `system` param.
- `response_format: { type: "json_object" }` is emulated with an appended system instruction plus fence-stripping on the response — Claude has no native "JSON mode".
- `response_format: { type: "json_schema", json_schema }` is emulated via a single forced tool call matching the schema; the tool's input is returned as the JSON string in `content`.
- `tools`/`tool_choice` map to Anthropic's native tool-use format.

Tips
- Always call from server-side code (tRPC procedures) — never expose `ANTHROPIC_API_KEY` to the client.
- LLM responses often contain markdown. Use `<Streamdown>{content}</Streamdown>` (from `streamdown`) to render it.
- For image inputs, local `file://`/blob URLs don't work — upload to storage first and pass the resulting URL.

### Structured Responses (JSON Schema)

```ts
const structured = await invokeLLM({
  messages: [
    { role: "system", content: "You are a helpful assistant designed to output JSON." },
    { role: "user", content: "Extract the name and age from: \"My name is Alice and I am 30 years old.\"" },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "person_info",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name", "age"],
        additionalProperties: false,
      },
    },
  },
});

const data = JSON.parse(structured.choices[0].message.content as string);
```

**Note:** `json_schema` works best for flat structures — Anthropic's forced-tool-call emulation can be picky about deeply nested arrays/objects. For those, prefer `json_object` and describe the exact JSON shape in the system prompt (this is what `server/routers.ts`'s itinerary/places AI endpoints already do).

---

## File Storage

Use the helpers in `server/storage.ts`, backed by a **private** Supabase Storage bucket. Requires `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose to the client) and `SUPABASE_STORAGE_BUCKET`.

```ts
import { storagePut } from "./server/storage";

const fileKey = `${userId}-files/${fileName}.png`;
const { key, url } = await storagePut(fileKey, fileBuffer, "image/png");
// url = "/storage/{key}" — served via a 307 redirect to a freshly-signed URL
// key = unique storage key — save in your database
```

Tips
- Save the `key` or `url` in your database; the storage layer only holds bytes.
- `storageGetSignedUrl(key)` mints a signed URL directly (1 hour TTL) if you need one outside the `/storage/{key}` redirect flow.
- To delete a file, drop its `key` from your DB and any UI references — there's no delete helper exposed here; use the Supabase dashboard/API directly if you need hard deletes.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | MySQL/TiDB connection string |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (client-side) |
| `SUPABASE_JWT_SECRET` | Supabase project JWT secret — backend verifies user sessions with this |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — server-only, bypasses RLS, used for Storage |
| `SUPABASE_STORAGE_BUCKET` | Name of the private Supabase Storage bucket |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_MODEL` | Optional; defaults to `claude-sonnet-5` |
| `EXPO_PUBLIC_API_BASE_URL` | API server URL (derived automatically if unset) |

See `.env.example` for the full list including third-party integrations (Google Places/Directions, AeroDataBox, AviationStack, OpenWeatherMap, RevenueCat).

---

## Testing

Write tests in `tests/` using Vitest:

```tsx
// tests/items.test.ts
import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";

describe("items", () => {
  it("creates an item", async () => {
    const ctx = createMockContext({ userId: 1 });
    const caller = appRouter.createCaller(ctx);

    const result = await caller.items.create({
      title: "Test Item",
      description: "Test description",
    });

    expect(result).toBeDefined();
  });
});
```

Run tests:

```bash
pnpm test
```

Several existing tests (`tests/supabase-*.test.ts`, `tests/google-places.test.ts`, `tests/aerodatabox.test.ts`, etc.) assert that real third-party credentials are present and reachable — they're expected to fail in any environment without a populated `.env`.

---

## Common Patterns

### Optimistic Updates

```tsx
const toggleComplete = trpc.items.update.useMutation({
  onMutate: async (input) => {
    await utils.items.list.cancel();
    const previous = utils.items.list.getData();
    utils.items.list.setData(undefined, (old) =>
      old?.map((item) =>
        item.id === input.id ? { ...item, completed: input.completed } : item
      )
    );
    return { previous };
  },
  onError: (err, input, context) => {
    utils.items.list.setData(undefined, context?.previous);
  },
  onSettled: () => {
    utils.items.list.invalidate();
  },
});
```

### Pagination

```tsx
// Router
list: protectedProcedure
  .input(z.object({
    limit: z.number().min(1).max(100).default(20),
    cursor: z.number().optional(),
  }))
  .query(async ({ ctx, input }) => {
    const items = await db.getItems({
      userId: ctx.user.id,
      limit: input.limit + 1,
      cursor: input.cursor,
    });

    let nextCursor: number | undefined;
    if (items.length > input.limit) {
      const next = items.pop();
      nextCursor = next?.id;
    }

    return { items, nextCursor };
  }),

// Frontend
const { data, fetchNextPage, hasNextPage } = trpc.items.list.useInfiniteQuery(
  { limit: 20 },
  { getNextPageParam: (lastPage) => lastPage.nextCursor }
);
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Database not available" | Check `DATABASE_URL` is set |
| Auth requests return 401 | Verify `SUPABASE_JWT_SECRET` matches the Supabase project's JWT secret |
| `invokeLLM` throws "ANTHROPIC_API_KEY is not configured" | Set `ANTHROPIC_API_KEY` in `.env` |
| Storage uploads fail | Verify `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` are set and the bucket exists |
| tRPC type errors | Run `pnpm check` to verify types |
| Mutations fail silently | Check browser console for errors |
