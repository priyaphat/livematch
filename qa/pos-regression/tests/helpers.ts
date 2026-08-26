import { request, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const suiteRoot = path.resolve(currentDir, '..');

export const posBaseURL = process.env.POS_QA_BASE_URL || 'http://localhost:5275';

export async function ownerApi(owner: 'a' | 'b' = 'a'): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: posBaseURL,
    storageState: path.join(suiteRoot, `.auth/owner-${owner}.json`),
  });
}

export async function csrfHeaders(api: APIRequestContext) {
  const state = await api.storageState();
  const token = state.cookies.find((cookie) => cookie.name === 'livematch_csrf')?.value;
  if (!token) throw new Error('livematch_csrf cookie is missing from QA auth state');
  return { 'X-CSRF-Token': token };
}

