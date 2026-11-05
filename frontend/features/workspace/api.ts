import { currentSubmittingForm, reportError } from '@/lib/form-feedback';
let csrf = "";
export class ApiError extends Error { constructor(message: string, public errors: Record<string, string[]> = {}, public status = 500) { super(message); } }
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const form = currentSubmittingForm();
  try {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-TOKEN": csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({
    message: "The server is unavailable. Please try again shortly.",
  }));
  if (!response.ok)
    throw new ApiError(
      payload.errors
        ? Object.values(payload.errors).flat().join(" ")
        : payload.message || "Something went wrong. Please try again.",
      payload.errors || {}, response.status,
    );
  if (payload.data?.csrf) csrf = payload.data.csrf;
  return payload.data;
  } catch (error) {
    const cause = error instanceof ApiError ? error : new ApiError('Unable to reach the server. Check your connection and try again.');
    reportError(cause.message, cause.errors, form);
    throw cause;
  }
}

