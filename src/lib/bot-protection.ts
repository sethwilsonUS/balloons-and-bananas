import { checkBotId } from 'botid/server';
import { json } from './responses';

type BasicBotCheck = (options: { advancedOptions: { checkLevel: 'basic' } }) => Promise<{ isBot: boolean }>;

/**
 * Invisible, free BotID Basic protection for selected interactive requests.
 * A positive bot verdict is rejected; service/SDK failures leave the public
 * archive available. There is deliberately no CAPTCHA or paid fallback.
 */
export async function checkBasicBot(check: BasicBotCheck = checkBotId): Promise<Response | null> {
  try {
    const verdict = await check({ advancedOptions: { checkLevel: 'basic' } });
    return verdict.isBot ? json({ error: 'This request could not be verified. Please reload the page and try again.' }, 403) : null;
  } catch {
    return null;
  }
}
