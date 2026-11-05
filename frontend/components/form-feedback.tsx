'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { captureSubmittingForm } from '@/lib/form-feedback';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type FieldError = { control: Control; message: string; id: string; describedBy: string | null; invalid: string | null };
type Feedback = { message: string; errors: Record<string, string[]>; form: HTMLFormElement | null };

export default function FormFeedback() {
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const [fields, setFields] = useState<FieldError[]>([]);

  useEffect(() => {
    const marked = new Map<Control, FieldError>();
    let sequence = 0;
    let lastMessage = '';
    let lastTime = 0;
    const restore = (entry: FieldError) => {
      if (entry.describedBy === null) entry.control.removeAttribute('aria-describedby');
      else entry.control.setAttribute('aria-describedby', entry.describedBy);
      if (entry.invalid === null) entry.control.removeAttribute('aria-invalid');
      else entry.control.setAttribute('aria-invalid', entry.invalid);
      marked.delete(entry.control);
    };
    const clear = (form: HTMLFormElement) => {
      for (const entry of marked.values()) if (entry.control.form === form) restore(entry);
      setFields([...marked.values()]);
    };
    const notify = (message: string) => {
      const now = Date.now();
      if (message !== lastMessage || now - lastTime > 1500) setToast({ message, key: now });
      lastMessage = message; lastTime = now;
    };
    const mark = (control: Control, message: string) => {
      const previous = marked.get(control);
      if (previous) restore(previous);
      const entry = { control, message, id: `waflow-field-error-${++sequence}`, describedBy: control.getAttribute('aria-describedby'), invalid: control.getAttribute('aria-invalid') };
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', [entry.describedBy, entry.id].filter(Boolean).join(' '));
      marked.set(control, entry);
      setFields([...marked.values()]);
    };
    const submit = (event: Event) => {
      if (event.target instanceof HTMLFormElement) { clear(event.target); captureSubmittingForm(event.target); }
    };
    const invalid = (event: Event) => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
      event.preventDefault();
      mark(control, control.validationMessage);
      // Native validation emits one event per invalid control. Show one summary toast.
      notify('Please check the highlighted fields.');
      const first = control.form?.querySelector(':invalid');
      if (first === control) control.focus();
    };
    const input = (event: Event) => {
      const entry = marked.get(event.target as Control);
      if (entry) { restore(entry); setFields([...marked.values()]); }
    };
    const error = (event: Event) => {
      const { message, errors, form } = (event as CustomEvent<Feedback>).detail;
      notify(message);
      if (!form?.isConnected) return;
      clear(form);
      let first: Control | undefined;
      for (const [name, messages] of Object.entries(errors)) {
        const control = Array.from(form.elements).find(element => element.getAttribute('name') === name);
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
          mark(control, messages.join(' ')); first ??= control;
        }
      }
      first?.focus();
    };
    document.addEventListener('submit', submit, true);
    document.addEventListener('invalid', invalid, true);
    document.addEventListener('input', input, true);
    document.addEventListener('change', input, true);
    window.addEventListener('waflow:error', error);
    return () => {
      document.removeEventListener('submit', submit, true);
      document.removeEventListener('invalid', invalid, true);
      document.removeEventListener('input', input, true);
      document.removeEventListener('change', input, true);
      window.removeEventListener('waflow:error', error);
      for (const entry of marked.values()) restore(entry);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timeout);
  }, [toast]);

  return <>
    {fields.filter(field => field.control.isConnected && field.control.parentElement).map(field => createPortal(
      <span className="field-error" id={field.id}>{field.message}</span>, field.control.parentElement!, field.id,
    ))}
    {toast && createPortal(<div className="error-toast" role="alert" key={toast.key}><span>{toast.message}</span><button type="button" aria-label="Dismiss error notification" onClick={() => setToast(null)}>×</button></div>, document.querySelector('dialog[open]') || document.body)}
  </>;
}
