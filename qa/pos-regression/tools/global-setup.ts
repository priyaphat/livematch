import { request, type FullConfig } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, '..');

async function saveLogin(baseURL: string, email: string, password: string, target: string) {
  const api = await request.newContext({ baseURL });
  const response = await api.post('/api/auth/pos/login', {
    data: { email, password, remember: true },
  });
  if (!response.ok()) {
    throw new Error(`QA global login failed for ${email}: ${response.status()} ${await response.text()}`);
  }
  await api.storageState({ path: target });
  await api.dispose();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0]?.use?.baseURL || 'http://localhost:5275');
  const authDir = path.join(root, '.auth');
  await fs.mkdir(authDir, { recursive: true });
  await saveLogin(baseURL, 'qa.owner.a@example.invalid', 'QaPass123!', path.join(authDir, 'owner-a.json'));
  await saveLogin(baseURL, 'qa.owner.b@example.invalid', 'QaPass123!', path.join(authDir, 'owner-b.json'));
}

