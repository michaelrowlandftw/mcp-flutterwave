import { registerV4Tools } from './v4/register.js';
import { getApiVersion } from '../config/apiVersion.js';
import { registerVerifyTools } from './verify.js';
import { registerWebhookTools } from './webhook.js';

export async function registerTools() {
  registerVerifyTools();
  registerWebhookTools();
  if (getApiVersion() === 'v4') {
    registerV4Tools();
    return;
  }

  const { registerV3Tools } = await import('./registerV3.js');
  registerV3Tools();
}
