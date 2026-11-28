import { initBotId } from 'botid/client/core';

// Runs before hydration so the first interactive request has invisible proof.
// Read-only catalog/session requests and native download links stay public.
try {
  initBotId({ protect: [
    { path: '/api/search', method: 'POST', advancedOptions: { checkLevel: 'basic' } },
    { path: '/api/concordance', method: 'POST', advancedOptions: { checkLevel: 'basic' } },
    { path: '/api/assets/*', method: 'GET', advancedOptions: { checkLevel: 'basic' } },
    { path: '/api/analytics/*', method: 'POST', advancedOptions: { checkLevel: 'basic' } },
  ] });
} catch {
  // Monitoring must not prevent the archive from rendering if setup fails.
}
