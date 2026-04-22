export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const hasFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(path, {
    headers: {
      ...(hasFormDataBody ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!response.ok) {
    const message = await response.text();
    let displayMessage = message;
    try {
      const parsed = JSON.parse(message) as { detail?: string; message?: string };
      displayMessage = parsed.detail || parsed.message || message;
    } catch {
      displayMessage = message;
    }
    throw new Error(displayMessage || `request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}
