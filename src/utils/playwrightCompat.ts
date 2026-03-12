// @ts-nocheck

export async function createCDPSessionForPage(page) {
  if (typeof page.createCDPSession === 'function') {
    return page.createCDPSession();
  }

  if (typeof page.context === 'function') {
    const context = page.context();
    if (context && typeof context.newCDPSession === 'function') {
      return context.newCDPSession(page);
    }
  }

  throw new Error('Active page does not support CDP sessions');
}

export async function addInitScriptCompat(page, script, arg) {
  if (typeof page.evaluateOnNewDocument === 'function') {
    return page.evaluateOnNewDocument(script, arg);
  }

  if (typeof page.addInitScript === 'function') {
    return page.addInitScript(script, arg);
  }

  throw new Error('Active page does not support init scripts');
}

export async function setUserAgentCompat(page, userAgent) {
  if (typeof page.setUserAgent === 'function') {
    return page.setUserAgent(userAgent);
  }

  const cdp = await createCDPSessionForPage(page);
  try {
    await cdp.send('Emulation.setUserAgentOverride', { userAgent });
  } finally {
    await cdp.detach?.().catch(() => undefined);
  }
}
