import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';

export const MAX_CONTACT_IMPORT_ROWS = 10_000;
export const MAX_CONTACT_IMPORT_BYTES = 5_000_000;

export const consentFields = {
  opted_in: z.boolean().default(false),
  consent_source: z.string().trim().max(255).optional(),
};
export const hasConsentEvidence = (value: { opted_in?: boolean; consent_source?: string }) =>
  !value.opted_in || !!value.consent_source?.trim();

/** Small, bounded RFC 4180 reader. No spreadsheet formulas are evaluated. */
export function parseContactsCsv(csv: string) {
  if (Buffer.byteLength(csv, 'utf8') > MAX_CONTACT_IMPORT_BYTES)
    throw new UnprocessableEntityException('CSV must be no larger than 5 MB.');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const fail = () => { throw new UnprocessableEntityException('Invalid CSV quoting. Use a comma-separated UTF-8 file.'); };
  const cell = () => { row.push(field); field = ''; closed = false; };
  const line = () => { cell(); if (row.some(v => v.trim())) rows.push(row); row = []; };
  csv = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === '"') {
      if (field || closed) fail();
      quoted = true;
    } else if (char === ',') cell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      line();
      if (rows.length > MAX_CONTACT_IMPORT_ROWS + 1) throw new UnprocessableEntityException('Import up to 10,000 contacts per file.');
    } else {
      if (closed) fail();
      field += char;
    }
  }
  if (quoted) fail();
  line();
  if (rows.length < 2 || rows.length > MAX_CONTACT_IMPORT_ROWS + 1)
    throw new UnprocessableEntityException('Provide a header and between 1 and 10,000 contacts.');
  const headers = rows.shift()!.map(v => v.trim().toLowerCase());
  const allowed = ['name', 'phone', 'email', 'tag', 'opted_in'];
  if (new Set(headers).size !== headers.length || headers.some(v => !allowed.includes(v)) || !headers.includes('name') || !headers.includes('phone'))
    throw new UnprocessableEntityException('CSV headers must include name,phone; optional columns: email,tag,opted_in.');
  const contact = z.object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/),
    email: z.string().trim().email().max(255).or(z.literal('')).transform(v => v || null),
    tag: z.string().trim().min(1).max(30),
    opted_in: z.enum(['true', 'false', '']).transform(v => v === 'true'),
  });
  const seen = new Set<string>();
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new UnprocessableEntityException(`Contact row ${index + 2}: column count does not match the header.`);
    const raw = Object.fromEntries(headers.map((key, i) => [key, values[i].trim()]));
    const parsed = contact.safeParse({ email: '', tag: 'New', opted_in: '', ...raw });
    if (!parsed.success)
      throw new UnprocessableEntityException(`Contact row ${index + 2}: check name, international phone, email, tag and opted_in (true or false).`);
    if (seen.has(parsed.data.phone))
      throw new UnprocessableEntityException(`Contact row ${index + 2}: duplicate phone in this file.`);
    seen.add(parsed.data.phone);
    return parsed.data;
  });
}
