// Races a promise against a timeout so a hung network/storage/native call can
// never block app startup — used anywhere init code awaits something outside
// our control (Supabase, AsyncStorage, expo-notifications, etc).
export function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 8000): Promise<T> {
  const timeout = new Promise<T>((resolve) => {
    setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), timeout]);
}
