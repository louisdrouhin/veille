export class ValidationError extends Error {}

export function str(form: FormData, key: string, { max = 200, required = true } = {}): string {
  const raw = form.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (required && !value) throw new ValidationError(`Le champ « ${key} » est obligatoire.`);
  if (value.length > max) throw new ValidationError(`Le champ « ${key} » dépasse ${max} caractères.`);
  return value;
}

export function int(form: FormData, key: string, fallback?: number): number {
  const raw = form.get(key);
  if ((raw === null || raw === "") && fallback !== undefined) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new ValidationError(`Le champ « ${key} » doit être un entier.`);
  return n;
}

export function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ValidationError("Identifiant invalide.");
  return n;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function httpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError("URL invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ValidationError("L'URL doit commencer par http(s)://");
  return url.toString();
}

/** Postgres unique violation (works with postgres-js and wrapped drizzle errors). */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "23505") return true;
  }
  return false;
}

export const NOTE_MAX_LENGTH = 10_000;
