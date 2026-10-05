export function safePostLoginPath(value: unknown): "/pradzia" | null {
  return value === "/pradzia" ? "/pradzia" : null;
}
