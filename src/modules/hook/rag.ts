// @ts-nocheck

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5.]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreTokens(descriptionTokens, keywords) {
  let score = 0;
  for (const keyword of keywords) {
    if (descriptionTokens.includes(keyword)) {
      score += 3;
    }
  }
  return score;
}

export class HookRAG {
  storage;
  templates;

  constructor(storage) {
    this.storage = storage;
    this.templates = [
      {
        id: 'cryptojs-aes-function',
        keywords: ['aes', '加密', '破解', '解密', 'cryptojs', '返回值'],
        target: {
          type: 'function',
        },
        behavior: {
          captureArgs: true,
          captureReturn: true,
          captureStack: true,
          logToConsole: true,
        },
        explanation: 'Captures inputs and outputs of CryptoJS/AES-style encrypt/decrypt functions.',
      },
      {
        id: 'signature-object-method',
        keywords: ['sign', 'signature', '签名', 'token', 'nonce', 'timestamp', 'basicfixture.sign'],
        target: {
          type: 'object-method',
        },
        behavior: {
          captureArgs: true,
          captureReturn: true,
          captureStack: true,
          logToConsole: true,
        },
        explanation: 'Hooks object methods that likely build request signatures or tokens.',
      },
      {
        id: 'fetch-decrypt-capture',
        keywords: ['fetch', 'api', '请求', '接口', '响应', '解密'],
        target: {
          type: 'api',
          name: 'fetch',
        },
        behavior: {
          captureArgs: true,
          captureReturn: true,
          captureStack: false,
          logToConsole: true,
        },
        explanation: 'Captures fetch requests and responses to observe encrypted payloads.',
      },
    ];
  }

  async findBestTemplate(input) {
    const description = String(input?.description || '');
    const descriptionTokens = tokenize(description);
    let best = null;

    for (const template of this.templates) {
      let score = scoreTokens(descriptionTokens, template.keywords);
      if (description.toLowerCase().includes(template.id.replace(/-/g, ' '))) {
        score += 4;
      }

      if (input?.context?.signatureCandidates) {
        for (const candidate of input.context.signatureCandidates) {
          for (const objectPath of candidate.objectPaths || []) {
            if (description.toLowerCase().includes(String(objectPath).toLowerCase())) {
              score += 8;
            }
          }
        }
      }

      if (!best || score > best.score) {
        best = {
          template,
          score,
          source: 'builtin',
        };
      }
    }

    if (this.storage?.listHookEvents && input?.sessionId) {
      const historical = await this.storage.listHookEvents({
        sessionId: input.sessionId,
        limit: 50,
      });
      for (const event of historical) {
        const eventTokens = tokenize(event.summary);
        const overlap = eventTokens.filter((token) => descriptionTokens.includes(token)).length;
        if (overlap > 0 && (!best || overlap > best.score)) {
          best = {
            template: {
              id: `history:${event.hookId}`,
              target: event.payload?.target,
              behavior: event.payload?.behavior,
              condition: event.payload?.condition,
              explanation: event.summary,
              generatedCode: event.payload?.generatedCode,
            },
            score: overlap,
            source: 'history',
          };
        }
      }
    }

    return best && best.score > 0 ? best : null;
  }

  inferTargetFromContext(description, context, template) {
    const raw = String(description || '');
    const lower = raw.toLowerCase();
    const explicitObjectMethod = raw.match(/([a-z_$][\w$]*)\.([a-z_$][\w$]*)/i);
    if (explicitObjectMethod) {
      const objectRoot = explicitObjectMethod[1];
      const property = explicitObjectMethod[2];
      return {
        type: 'object-method',
        object: `window.${objectRoot}`,
        property,
        name: property,
      };
    }

    const explicitWindowMethod = raw.match(/window\.([a-z_$][\w$]*)/i);
    if (explicitWindowMethod) {
      return {
        type: 'function',
        name: explicitWindowMethod[1],
      };
    }

    for (const candidate of context?.signatureCandidates || []) {
      if (Array.isArray(candidate.objectPaths) && candidate.objectPaths.length > 0) {
        const first = candidate.objectPaths[0];
        const objectMatch = String(first).match(/^(.*)\.([^.]+)$/);
        if (objectMatch) {
          return {
            type: 'object-method',
            object: objectMatch[1],
            property: objectMatch[2],
            name: objectMatch[2],
          };
        }
      }
      const ranked = candidate.rankedFunctions?.[0];
      if (ranked?.name) {
        return {
          type: 'function',
          name: ranked.name,
        };
      }
    }

    return template?.target || {
      type: 'api',
      name: 'fetch',
    };
  }

  inferBehavior(template, description) {
    const lower = String(description || '').toLowerCase();
    return {
      captureArgs: true,
      captureReturn: !lower.includes('只看参数'),
      captureStack: lower.includes('栈') || lower.includes('调用链'),
      logToConsole: true,
      blockExecution: lower.includes('阻止') || lower.includes('拦截后不发'),
      ...(template?.behavior || {}),
    };
  }

  buildPlan(input) {
    return this.findBestTemplate(input).then((match) => {
      const target = this.inferTargetFromContext(input.description, input.context, match?.template);
      const behavior = this.inferBehavior(match?.template, input.description);

      return {
        target,
        behavior,
        condition: match?.template?.condition,
        strategy: match
          ? {
              source: match.source === 'builtin' ? 'rag' : match.source,
              templateId: match.template.id,
              score: match.score,
              explanation: match.template.explanation,
            }
          : {
              source: 'rule',
              templateId: null,
              score: 0,
              explanation: 'No RAG template matched. Falling back to rule-based inference.',
            },
      };
    });
  }
}
