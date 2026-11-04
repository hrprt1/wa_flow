import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { AuthService } from '../src/auth/auth.service';
import { resetMailOptions } from '../src/auth/reset-mail';

test('reset mail rejects non-delivering Laravel log configuration and missing sender', () => {
  const env = { MAIL_MAILER: 'smtp', MAIL_HOST: 'smtp.example.com', MAIL_FROM_ADDRESS: 'hello@example.com' };
  assert.throws(() => resetMailOptions({ ...env, MAIL_MAILER: 'log' }), /SMTP configuration/);
  assert.throws(() => resetMailOptions({ ...env, MAIL_FROM_ADDRESS: '' }), /SMTP configuration/);
  assert.throws(() => resetMailOptions({ ...env, MAIL_PORT: 'invalid' }), /SMTP configuration/);
  assert.equal(resetMailOptions({ ...env, MAIL_PORT: '465' }).secure, true);
  assert.equal(resetMailOptions({ ...env, MAIL_PORT: '587', MAIL_ENCRYPTION: 'tls' }).requireTLS, true);
  assert.equal(resetMailOptions({ ...env, MAIL_SCHEME: 'smtps' }).secure, true);
});

test('reset sends a normalized recipient and usable link; SMTP failures are actionable', async () => {
  const previous = { ...process.env };
  const original = nodemailer.createTransport;
  let stored: any;
  let message: any;
  let fail = false;
  let closed = 0;
  Object.assign(process.env, { MAIL_MAILER: 'smtp', MAIL_HOST: 'smtp.example.com', MAIL_PORT: '587', MAIL_FROM_ADDRESS: 'hello@example.com', APP_URL: 'https://waflow.example' });
  nodemailer.createTransport = (() => ({
    sendMail: async (value: any) => { if (fail) throw new Error('private provider error'); message = value; },
    close: () => { closed++; },
  })) as any;
  const db: any = () => ({
    where: (filter: any) => ({ first: async () => { assert.equal(filter.email, 'owner@example.com'); return { id: 1 }; } }),
    insert: (value: any) => ({ onConflict: () => ({ merge: async () => { stored = value; } }) }),
  });
  try {
    const service = new AuthService({ db } as any);
    await service.forgot({ email: ' Owner@Example.com ' });
    assert.equal(message.to, 'owner@example.com');
    const url = new URL(message.text.split(': ').slice(1).join(': '));
    assert.equal(url.origin, 'https://waflow.example');
    assert.equal(url.pathname, '/reset-password');
    assert.equal(url.searchParams.get('email'), 'owner@example.com');
    assert.equal(await bcrypt.compare(url.searchParams.get('token')!, stored.token), true);
    fail = true;
    await assert.rejects(() => service.forgot({ email: 'owner@example.com' }), /SMTP configuration/);
    assert.equal(closed, 2);
  } finally {
    nodemailer.createTransport = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
