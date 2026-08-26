const rawBackendUrl = process.env["BACKEND_URL"] || "http://localhost:8000";
const backendUrl = rawBackendUrl.replace(/\/+$/, "");

export class BackendUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The interview engine is unavailable.", { cause });
    this.name = "BackendUnavailableError";
  }
}

export class BackendRequestError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Interview engine responded with ${status}`);
    this.name = "BackendRequestError";
    this.status = status;
    this.body = body;
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, init);
  } catch (cause) {
    throw new BackendUnavailableError(cause);
  }

  const body = await parseBody(response);

  if (!response.ok) {
    throw new BackendRequestError(response.status, body);
  }

  return body;
}

export function backendGet(path: string): Promise<unknown> {
  return request(path, { method: "GET" });
}

export function backendPostJson(path: string, data: unknown): Promise<unknown> {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function backendPostForm(path: string, form: FormData): Promise<unknown> {
  return request(path, { method: "POST", body: form });
}

export function backendPostEmpty(path: string): Promise<unknown> {
  return request(path, { method: "POST" });
}
