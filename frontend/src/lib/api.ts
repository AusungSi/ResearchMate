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

type SseEventHandler = (eventType: string, payload: Record<string, unknown>) => void;

export async function apiPostSse(path: string, body: unknown, onEvent: SseEventHandler, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
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

  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const block of parts) {
      const lines = block.split(/\r?\n/);
      let eventType = "message";
      const dataLines: string[] = [];
      for (const raw of lines) {
        if (raw.startsWith("event:")) {
          eventType = raw.slice(6).trim() || "message";
          continue;
        }
        if (raw.startsWith("data:")) {
          dataLines.push(raw.slice(5).trim());
        }
      }
      if (!dataLines.length) continue;
      try {
        const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
        onEvent(eventType, payload);
      } catch {
        onEvent(eventType, { raw: dataLines.join("\n") });
      }
    }

    if (done) {
      if (buffer.trim()) {
        try {
          const lines = buffer.split(/\r?\n/);
          let eventType = "message";
          const dataLines: string[] = [];
          for (const raw of lines) {
            if (raw.startsWith("event:")) {
              eventType = raw.slice(6).trim() || "message";
            } else if (raw.startsWith("data:")) {
              dataLines.push(raw.slice(5).trim());
            }
          }
          if (dataLines.length) {
            onEvent(eventType, JSON.parse(dataLines.join("\n")) as Record<string, unknown>);
          }
        } catch {
          // Ignore truncated trailing buffer.
        }
      }
      break;
    }
  }
}
