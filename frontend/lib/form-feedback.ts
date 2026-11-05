let submittingForm: HTMLFormElement | null = null;

export function captureSubmittingForm(form: HTMLFormElement) {
  submittingForm = form;
  // React's delegated submit handler runs after document capture. Keep the
  // association through the whole event task, including its microtasks.
  setTimeout(() => { if (submittingForm === form) submittingForm = null; }, 0);
}

export function currentSubmittingForm() { return submittingForm; }

export function reportError(message: string, errors: Record<string, string[]> = {}, form: HTMLFormElement | null = null) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('waflow:error', { detail: { message, errors, form } }));
}
