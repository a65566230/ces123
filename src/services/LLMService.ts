// @ts-nocheck

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger.js';

interface LLMServiceDependencies {
    remoteExecutor?: (provider: string, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>) => Promise<{
        content: string;
        usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        };
    }>;
    storage?: {
        getLlmCacheEntry(cacheKey: string): Promise<unknown>;
        findLlmCacheBySemanticKey(options: Record<string, unknown>): Promise<unknown>;
        setLlmCacheEntry(record: Record<string, unknown>): Promise<void>;
    };
    llmCache?: {
        enabled?: boolean;
        maxEntries?: number;
        ttlSeconds?: number;
    };
}
export class LLMService {
    config;
    openai;
    anthropic;
    remoteExecutor;
    storage;
    cacheOptions = {
        enabled: true,
        maxEntries: 500,
        ttlSeconds: 86400,
    };
    chatCache;
    analysisCache;
    retryOptions = {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
    };
    constructor(config, retryOptions, dependencies) {
        this.config = config;
        if (retryOptions) {
            this.retryOptions = { ...this.retryOptions, ...retryOptions };
        }
        if (dependencies?.llmCache) {
            this.cacheOptions = { ...this.cacheOptions, ...dependencies.llmCache };
        }
        this.remoteExecutor = dependencies?.remoteExecutor;
        this.storage = dependencies?.storage;
        this.chatCache = new LRUCache({
            max: this.cacheOptions.maxEntries,
            ttl: this.cacheOptions.ttlSeconds * 1000,
        });
        this.analysisCache = new LRUCache({
            max: this.cacheOptions.maxEntries,
            ttl: this.cacheOptions.ttlSeconds * 1000,
        });
        this.initClients();
    }
    initClients() {
        if (this.config.provider === 'openai' && this.config.openai?.apiKey) {
            this.openai = new OpenAI({
                apiKey: this.config.openai.apiKey,
                baseURL: this.config.openai.baseURL,
            });
            logger.info('OpenAI client initialized');
        }
        if (this.config.provider === 'anthropic' && this.config.anthropic?.apiKey) {
            this.anthropic = new Anthropic({
                apiKey: this.config.anthropic.apiKey,
            });
            logger.info('Anthropic client initialized');
        }
    }
    async chat(messages, options) {
        const cacheKey = this.computePromptCacheKey(messages, options, 'chat');
        const semanticKey = this.computeSemanticLookupKey(messages, 'chat');
        const cached = await this.getCachedChatResult(cacheKey, semanticKey);
        if (cached) {
            return {
                ...cached,
                cached: true,
            };
        }
        if (!this.remoteExecutor) {
            this.assertClientConfigured();
        }
        const response = await this.withRetry(async () => {
            const startTime = Date.now();
            try {
                if (this.remoteExecutor) {
                    return await this.remoteExecutor(this.config.provider, messages, options);
                }
                if (this.config.provider === 'openai') {
                    return await this.chatOpenAI(messages, options);
                }
                else if (this.config.provider === 'anthropic') {
                    return await this.chatAnthropic(messages, options);
                }
                else {
                    throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
                }
            }
            finally {
                const duration = Date.now() - startTime;
                logger.debug(`LLM call completed in ${duration}ms`);
            }
        });
        await this.storeCachedChatResult(cacheKey, semanticKey, messages, response);
        return {
            ...response,
            cached: false,
        };
    }
    async analyzeImage(imageInput, prompt, isFilePath = false) {
        const cacheKey = this.computePromptCacheKey([
            { role: 'user', content: prompt },
        ], {
            imageInput: typeof imageInput === 'string' ? imageInput.slice(0, 64) : 'binary',
            isFilePath,
        }, 'vision');
        const semanticKey = this.computeSemanticLookupKey([{ role: 'user', content: prompt }], 'vision');
        const cached = await this.getCachedChatResult(cacheKey, semanticKey);
        if (cached) {
            return cached.content;
        }
        this.assertClientConfigured();
        return this.withRetry(async () => {
            const startTime = Date.now();
            try {
                let imageBase64;
                if (isFilePath) {
                    logger.info(`📂 读取图片文件: ${imageInput}`);
                    const imageBuffer = await readFile(imageInput);
                    imageBase64 = imageBuffer.toString('base64');
                    logger.info(`✅ 图片文件已读取 (${(imageBuffer.length / 1024).toFixed(2)} KB)`);
                }
                else if (typeof imageInput === 'string') {
                    imageBase64 = imageInput;
                }
                else {
                    imageBase64 = Buffer.from(imageInput).toString('base64');
                }
                if (this.config.provider === 'openai') {
                    if (!this.openai) {
                        throw new Error('OpenAI client not initialized');
                    }
                    const model = this.config.openai?.model || 'gpt-5.4';
                    logger.info(`🖼️ Using OpenAI Responses vision model: ${model}`);
                    const response = await this.callOpenAIResponses(this.buildOpenAIResponsesRequest([
                        { role: 'user', content: prompt },
                    ], {
                        maxTokens: 1000,
                    }, [
                        {
                            role: 'user',
                            content: [
                                { type: 'input_text', text: prompt },
                                {
                                    type: 'input_image',
                                    image_url: `data:image/png;base64,${imageBase64}`,
                                },
                            ],
                        },
                    ]));
                    const content = this.extractOpenAIResponseText(response);
                    await this.storeCachedChatResult(cacheKey, semanticKey, [{ role: 'user', content: prompt }], {
                        content,
                        usage: {
                            promptTokens: response.usage?.input_tokens,
                            completionTokens: response.usage?.output_tokens,
                            totalTokens: response.usage?.total_tokens,
                        },
                    }, 'vision');
                    return content;
                }
                else if (this.config.provider === 'anthropic') {
                    if (!this.anthropic) {
                        throw new Error('Anthropic client not initialized');
                    }
                    const model = this.config.anthropic?.model || 'claude-3-opus-20240229';
                    const isVisionModel = model.includes('claude-3') || model.includes('claude-2.1');
                    if (!isVisionModel) {
                        logger.warn(`⚠️ 当前模型 ${model} 可能不支持图片分析，建议使用 claude-3-opus 或 claude-3-sonnet`);
                    }
                    logger.info(`🖼️ Using Anthropic Vision model: ${model}`);
                    const response = await this.anthropic.messages.create({
                        model,
                        max_tokens: 1000,
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    {
                                        type: 'image',
                                        source: {
                                            type: 'base64',
                                            media_type: 'image/png',
                                            data: imageBase64,
                                        },
                                    },
                                    {
                                        type: 'text',
                                        text: prompt,
                                    },
                                ],
                            },
                        ],
                    });
                    const textContent = response.content.find((c) => c.type === 'text');
                    const content = textContent?.text || '';
                    await this.storeCachedChatResult(cacheKey, semanticKey, [{ role: 'user', content: prompt }], {
                        content,
                        usage: {
                            promptTokens: response.usage?.input_tokens,
                            completionTokens: response.usage?.output_tokens,
                            totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
                        },
                    }, 'vision');
                    return content;
                }
                else {
                    throw new Error(`Unsupported LLM provider for image analysis: ${this.config.provider}`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error('❌ Image analysis failed:', errorMessage);
                if (errorMessage.includes('does not support image analysis')) {
                    logger.error('💡 解决方案:');
                    logger.error('   1. 修改 .env 文件中的 OPENAI_MODEL 为 gpt-4-vision-preview 或 gpt-4o');
                    logger.error('   2. 或者切换到 Anthropic: DEFAULT_LLM_PROVIDER=anthropic');
                    logger.error('   3. 当前配置不支持AI验证码检测，将使用降级方案');
                }
                throw error;
            }
            finally {
                const duration = Date.now() - startTime;
                logger.debug(`Image analysis completed in ${duration}ms`);
            }
        });
    }
    async withRetry(fn) {
        let lastError;
        let delay = this.retryOptions.initialDelay;
        for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (!this.shouldRetry(lastError) || attempt === this.retryOptions.maxRetries) {
                    throw lastError;
                }
                logger.warn(`LLM call failed (attempt ${attempt + 1}/${this.retryOptions.maxRetries + 1}): ${lastError.message}`);
                logger.debug(`Retrying in ${delay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay = Math.min(delay * this.retryOptions.backoffMultiplier, this.retryOptions.maxDelay);
            }
        }
        throw lastError || new Error('Unknown error');
    }
    shouldRetry(error) {
        const message = error.message.toLowerCase();
        const retryableErrors = [
            'rate limit',
            'timeout',
            'network',
            'econnreset',
            'enotfound',
            'etimedout',
            '429',
            '500',
            '502',
            '503',
            '504',
        ];
        return retryableErrors.some((pattern) => message.includes(pattern));
    }
    assertClientConfigured() {
        if (this.config.provider === 'openai' && !this.openai) {
            throw new Error('OpenAI client is not configured. Set OPENAI_API_KEY or provide a remoteExecutor.');
        }
        if (this.config.provider === 'anthropic' && !this.anthropic) {
            throw new Error('Anthropic client is not configured. Set ANTHROPIC_API_KEY or provide a remoteExecutor.');
        }
    }
    createDegradedResponse(messages) {
        const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
        return JSON.stringify({
            degraded: true,
            message: 'LLM provider is not configured, returning a deterministic fallback response.',
            hint: 'Set OPENAI_API_KEY or ANTHROPIC_API_KEY to enable AI-assisted analysis.',
            preview: lastUserMessage.slice(0, 240),
        }, null, 2);
    }
    createDegradedVisionResponse(prompt) {
        return JSON.stringify({
            degraded: true,
            message: 'Vision analysis is unavailable because no LLM provider credentials were configured.',
            promptPreview: prompt.slice(0, 240),
        }, null, 2);
    }
    computePromptCacheKey(messages, options = {}, kind = 'chat') {
        const provider = this.config.provider;
        const model = provider === 'openai'
            ? this.config.openai?.model || 'gpt-5.4'
            : this.config.anthropic?.model || 'claude-3-5-sonnet-20241022';
        return crypto
            .createHash('sha256')
            .update(JSON.stringify({
            kind,
            provider,
            model,
            messages,
            options,
        }))
            .digest('hex');
    }
    computeSemanticLookupKey(messages, kind = 'chat') {
        const normalized = messages
            .map((message) => `${message.role}:${String(message.content).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()}`)
            .join('\n')
            .slice(0, 1024);
        return crypto.createHash('sha1').update(`${kind}:${normalized}`).digest('hex');
    }
    async getCachedChatResult(cacheKey, semanticKey) {
        if (!this.cacheOptions.enabled) {
            return null;
        }
        const memoryHit = this.chatCache.get(cacheKey);
        if (memoryHit) {
            return memoryHit;
        }
        const stored = await this.storage?.getLlmCacheEntry?.(cacheKey);
        if (stored?.responseText) {
            const result = {
                content: stored.responseText,
                usage: stored.usage,
            };
            this.chatCache.set(cacheKey, result);
            return result;
        }
        const semanticHit = await this.storage?.findLlmCacheBySemanticKey?.({
            semanticKey,
            kind: 'chat',
            provider: this.config.provider,
            model: this.config.provider === 'openai'
                ? this.config.openai?.model || 'gpt-5.4'
                : this.config.anthropic?.model || 'claude-3-5-sonnet-20241022',
        });
        if (semanticHit?.responseText) {
            const result = {
                content: semanticHit.responseText,
                usage: semanticHit.usage,
            };
            this.chatCache.set(cacheKey, result);
            return result;
        }
        return null;
    }
    async storeCachedChatResult(cacheKey, semanticKey, messages, response, kind = 'chat') {
        if (!this.cacheOptions.enabled) {
            return;
        }
        const cached = {
            content: response.content,
            usage: response.usage,
        };
        this.chatCache.set(cacheKey, cached);
        if (this.storage?.setLlmCacheEntry) {
            await this.storage.setLlmCacheEntry({
                cacheKey,
                semanticKey,
                kind,
                provider: this.config.provider,
                model: this.config.provider === 'openai'
                    ? this.config.openai?.model || 'gpt-5.4'
                    : this.config.anthropic?.model || 'claude-3-5-sonnet-20241022',
                promptPreview: JSON.stringify(messages).slice(0, 500),
                responseText: response.content,
                usage: response.usage,
                createdAt: Date.now(),
                expiresAt: Date.now() + this.cacheOptions.ttlSeconds * 1000,
            });
        }
    }
    async getCachedAnalysisResult(kind, key) {
        if (!this.cacheOptions.enabled) {
            return null;
        }
        const cacheKey = `${kind}:${key}`;
        const memoryHit = this.analysisCache.get(cacheKey);
        if (memoryHit) {
            return memoryHit;
        }
        const stored = await this.storage?.getLlmCacheEntry?.(cacheKey);
        if (stored?.responseText) {
            const parsed = JSON.parse(stored.responseText);
            this.analysisCache.set(cacheKey, parsed);
            return parsed;
        }
        return null;
    }
    async storeCachedAnalysisResult(kind, key, value) {
        if (!this.cacheOptions.enabled) {
            return;
        }
        const cacheKey = `${kind}:${key}`;
        this.analysisCache.set(cacheKey, value);
        if (this.storage?.setLlmCacheEntry) {
            await this.storage.setLlmCacheEntry({
                cacheKey,
                semanticKey: crypto.createHash('sha1').update(cacheKey).digest('hex'),
                kind,
                provider: this.config.provider,
                model: this.config.provider === 'openai'
                    ? this.config.openai?.model || 'gpt-5.4'
                    : this.config.anthropic?.model || 'claude-3-5-sonnet-20241022',
                promptPreview: cacheKey,
                responseText: JSON.stringify(value),
                usage: undefined,
                createdAt: Date.now(),
                expiresAt: Date.now() + this.cacheOptions.ttlSeconds * 1000,
            });
        }
    }
    async chatOpenAI(messages, options) {
        if (!this.openai) {
            throw new Error('OpenAI client not initialized');
        }
        if ((this.config.openai?.wireApi || 'responses') === 'responses') {
            const response = await this.callOpenAIResponses(this.buildOpenAIResponsesRequest(messages, options));
            return {
                content: this.extractOpenAIResponseText(response),
                usage: response.usage
                    ? {
                        promptTokens: response.usage.input_tokens,
                        completionTokens: response.usage.output_tokens,
                        totalTokens: response.usage.total_tokens,
                    }
                    : undefined,
            };
        }
        const response = await this.openai.chat.completions.create({
            model: this.config.openai?.model || 'gpt-5.4',
            messages: messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
            })),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 4000,
        });
        const choice = response.choices[0];
        if (!choice?.message?.content) {
            throw new Error('No response from OpenAI');
        }
        return {
            content: choice.message.content,
            usage: response.usage
                ? {
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens,
                }
                : undefined,
        };
    }
    async chatAnthropic(messages, options) {
        if (!this.anthropic) {
            throw new Error('Anthropic client not initialized');
        }
        const systemMessage = messages.find((msg) => msg.role === 'system');
        const userMessages = messages.filter((msg) => msg.role !== 'system');
        const response = await this.anthropic.messages.create({
            model: this.config.anthropic?.model || 'claude-3-5-sonnet-20241022',
            max_tokens: options?.maxTokens ?? 4000,
            temperature: options?.temperature ?? 0.7,
            system: systemMessage?.content,
            messages: userMessages.map((msg) => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content,
            })),
        });
        const content = response.content[0];
        if (!content || content.type !== 'text') {
            throw new Error('Unexpected response type from Anthropic');
        }
        return {
            content: content.text,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            },
        };
    }
    buildOpenAIResponsesRequest(messages, options, responseInput) {
        const instructions = messages
            .filter((message) => message.role === 'system')
            .map((message) => message.content)
            .join('\n\n') || undefined;
        const input = responseInput || messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({
            role: message.role,
            content: [
                {
                    type: 'input_text',
                    text: message.content,
                },
            ],
        }));
        const request = {
            model: this.config.openai?.model || 'gpt-5.4',
            input,
            instructions,
            max_output_tokens: options?.maxTokens ?? 4000,
            stream: true,
            store: this.config.openai?.disableResponseStorage === true ? false : undefined,
        };
        if (this.config.openai?.reasoningEffort || this.config.openai?.reasoningSummary) {
            request.reasoning = {
                effort: this.config.openai?.reasoningEffort || 'high',
            };
            if (this.config.openai?.reasoningSummary && this.config.openai.reasoningSummary !== 'none') {
                request.reasoning.summary = this.config.openai.reasoningSummary;
            }
        }
        if (this.config.openai?.verbosity) {
            request.text = {
                verbosity: this.config.openai.verbosity,
            };
        }
        return request;
    }
    async callOpenAIResponses(request) {
        const baseUrl = this.config.openai?.baseURL || 'https://api.openai.com/v1';
        const apiKey = this.config.openai?.apiKey;
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/responses`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(request),
        });
        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`OpenAI Responses request failed: ${response.status} ${detail}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
            return await this.parseOpenAIResponsesStream(response);
        }
        return await response.json();
    }
    async parseOpenAIResponsesStream(response) {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('OpenAI Responses stream did not include a readable body');
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let aggregatedText = '';
        let completedResponse = null;
        let eventData = [];
        const flushEvent = (rawData) => {
            if (!rawData) {
                return;
            }
            const payload = JSON.parse(rawData);
            if (payload.error) {
                throw new Error(payload.detail || JSON.stringify(payload.error));
            }
            if (payload.type === 'response.output_text.delta') {
                aggregatedText += payload.delta || '';
            }
            if (payload.type === 'response.completed') {
                completedResponse = payload.response;
            }
        };
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) {
                    if (eventData.length > 0) {
                        flushEvent(eventData.join('\n'));
                        eventData = [];
                    }
                    continue;
                }
                if (trimmed.startsWith(':')) {
                    continue;
                }
                if (trimmed.startsWith('event:')) {
                    continue;
                }
                if (trimmed.startsWith('data:')) {
                    eventData.push(trimmed.slice(5).trim());
                    continue;
                }
                if (trimmed.startsWith('{')) {
                    eventData.push(trimmed);
                }
            }
        }
        if (buffer.trim()) {
            eventData.push(buffer.trim());
        }
        if (eventData.length > 0) {
            flushEvent(eventData.join('\n'));
        }
        if (completedResponse) {
            return completedResponse;
        }
        return {
            output: [
                {
                    type: 'message',
                    content: [
                        {
                            type: 'output_text',
                            text: aggregatedText.trim(),
                        },
                    ],
                },
            ],
            output_text: aggregatedText.trim(),
        };
    }
    extractOpenAIResponseText(response) {
        if (typeof response.output_text === 'string' && response.output_text.length > 0) {
            return response.output_text;
        }
        const segments = [];
        for (const item of response.output || []) {
            for (const content of item.content || []) {
                if (typeof content.text === 'string') {
                    segments.push(content.text);
                }
            }
        }
        const merged = segments.join('\n').trim();
        if (!merged) {
            throw new Error('No response from OpenAI');
        }
        return merged;
    }
    generateCodeAnalysisPrompt(code, focus) {
        const systemPrompt = `# Role
You are an expert JavaScript/TypeScript reverse engineer and code analyst with 10+ years of experience in:
- Static code analysis and AST manipulation
- Security vulnerability detection (OWASP Top 10)
- Framework and library identification (React, Vue, Angular, etc.)
- Code obfuscation and deobfuscation techniques
- Software architecture and design patterns

# Task
Perform deep static analysis on the provided JavaScript code to extract:
1. Technical stack (frameworks, bundlers, libraries)
2. Code structure (functions, classes, modules)
3. Business logic and data flow
4. Security vulnerabilities and risks
5. Code quality metrics

# Output Requirements
- Return ONLY valid JSON (no markdown, no explanations outside JSON)
- Follow the exact schema provided in the user message
- Use confidence scores (0.0-1.0) for uncertain detections
- Provide specific line numbers for security risks when possible
- Be precise and avoid hallucination

# Analysis Methodology
1. First, identify the code's purpose and main functionality
2. Then, detect frameworks and libraries by analyzing imports and API usage
3. Next, map out the code structure and call graph
4. Finally, perform security analysis using OWASP guidelines`;
        const userPrompt = `# Analysis Focus
Primary focus: ${focus}

# Code to Analyze
\`\`\`javascript
${code.length > 5000 ? code.substring(0, 5000) + '\n\n// ... (code truncated for analysis)' : code}
\`\`\`

# Required Output Schema
Return a JSON object with this EXACT structure (all fields are required):

\`\`\`json
{
  "techStack": {
    "framework": "string | null (e.g., 'React 18.x', 'Vue 3.x', 'Angular 15.x')",
    "bundler": "string | null (e.g., 'Webpack 5', 'Vite', 'Rollup')",
    "libraries": ["array of library names with versions if detectable"],
    "confidence": 0.95
  },
  "structure": {
    "functions": [
      {
        "name": "function name",
        "type": "arrow | declaration | expression | async",
        "purpose": "brief description of what it does",
        "complexity": "low | medium | high",
        "lineNumber": 42       
      }
    ],
    "classes": [
      {
        "name": "class name",
        "purpose": "brief description",
        "methods": ["method1", "method2"],
        "lineNumber": 100
      }
    ],
    "imports": ["list of imported modules"],
    "exports": ["list of exported symbols"]
  },
  "businessLogic": {
    "mainFeatures": ["feature 1", "feature 2"],
    "dataFlow": "description of how data flows through the code",
    "apiEndpoints": ["list of API endpoints if any"],
    "stateManagement": "Redux | Vuex | Context API | none | unknown"
  },
  "securityRisks": [
    {
      "type": "XSS | SQL Injection | CSRF | Insecure Deserialization | etc.",
      "severity": "critical | high | medium | low",
      "description": "detailed description of the vulnerability",
      "location": "line 123 or function name",
      "cwe": "CWE-79",
      "recommendation": "how to fix it"
    }
  ],
  "qualityScore": 85,
  "qualityMetrics": {
    "maintainability": 80,
    "readability": 75,
    "testability": 70,
    "performance": 90
  },
  "summary": "2-3 sentence summary of the code's purpose and quality"
}
\`\`\`

# Example Output (for reference)
\`\`\`json
{
  "techStack": {
    "framework": "React 18.2",
    "bundler": "Webpack 5",
    "libraries": ["axios@1.4.0", "lodash@4.17.21"],
    "confidence": 0.92
  },
  "structure": {
    "functions": [
      {"name": "fetchUserData", "type": "async", "purpose": "Fetches user data from API", "complexity": "medium", "lineNumber": 15}
    ],
    "classes": [],
    "imports": ["react", "axios"],
    "exports": ["UserComponent"]
  },
  "businessLogic": {
    "mainFeatures": ["User authentication", "Data fetching"],
    "dataFlow": "User input -> API call -> State update -> UI render",
    "apiEndpoints": ["/api/users", "/api/auth"],
    "stateManagement": "React Hooks (useState, useEffect)"
  },
  "securityRisks": [
    {
      "type": "XSS",
      "severity": "high",
      "description": "User input directly inserted into innerHTML without sanitization",
      "location": "line 45",
      "cwe": "CWE-79",
      "recommendation": "Use textContent or DOMPurify.sanitize()"
    }
  ],
  "qualityScore": 72,
  "qualityMetrics": {
    "maintainability": 75,
    "readability": 80,
    "testability": 65,
    "performance": 70
  },
  "summary": "React component for user management with API integration. Contains XSS vulnerability and lacks error handling."
}
\`\`\`

Now analyze the provided code and return ONLY the JSON output (no additional text).`;
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];
    }
    generateCryptoDetectionPrompt(code) {
        const systemPrompt = `# Role
You are a cryptography and security expert specializing in:
- Cryptographic algorithm identification (AES, RSA, DES, 3DES, Blowfish, etc.)
- JavaScript crypto library analysis (CryptoJS, JSEncrypt, Web Crypto API, crypto-js, forge, etc.)
- Security assessment based on NIST and OWASP standards
- Cryptographic parameter extraction (keys, IVs, modes, padding)
- Vulnerability detection in crypto implementations

# Expertise Areas
- Symmetric encryption: AES, DES, 3DES, Blowfish, ChaCha20
- Asymmetric encryption: RSA, ECC, ElGamal
- Hash functions: MD5, SHA-1, SHA-256, SHA-512, BLAKE2
- Encoding: Base64, Hex, URL encoding
- Key derivation: PBKDF2, scrypt, bcrypt
- Message authentication: HMAC, CMAC

# Task
Analyze the provided JavaScript code to:
1. Identify ALL cryptographic algorithms and their variants
2. Detect crypto libraries and their versions
3. Extract cryptographic parameters (keys, IVs, salts, modes, padding)
4. Assess security strength and identify vulnerabilities
5. Provide actionable security recommendations

# Analysis Standards
- Use NIST SP 800-175B for algorithm strength assessment
- Follow OWASP Cryptographic Storage Cheat Sheet
- Identify deprecated/weak algorithms (MD5, SHA-1, DES, RC4)
- Check for hardcoded keys and weak key generation`;
        const userPrompt = `# Code to Analyze
\`\`\`javascript
${code.length > 4000 ? code.substring(0, 4000) + '\n\n// ... (code truncated)' : code}
\`\`\`

# Required Output Schema
Return ONLY valid JSON with this exact structure:

\`\`\`json
{
  "algorithms": [
    {
      "name": "string (e.g., 'AES-256-CBC', 'RSA-2048', 'SHA-256')",
      "type": "symmetric | asymmetric | hash | encoding | kdf | mac",
      "variant": "string (e.g., 'CBC', 'GCM', 'PKCS1', 'OAEP')",
      "confidence": 0.95,
      "location": {
        "line": 42,
        "function": "encryptData",
        "codeSnippet": "CryptoJS.AES.encrypt(...)"
      },
      "parameters": {
        "keySize": "128 | 192 | 256 | 1024 | 2048 | 4096 | null",
        "key": "hardcoded | derived | imported | unknown",
        "keyValue": "actual key if hardcoded (first 20 chars) or null",
        "iv": "present | absent | hardcoded | random",
        "mode": "CBC | GCM | ECB | CTR | CFB | OFB | null",
        "padding": "PKCS7 | PKCS5 | NoPadding | OAEP | PSS | null",
        "salt": "present | absent",
        "iterations": 10000
      },
      "usage": "encryption | decryption | hashing | signing | verification",
      "securityIssues": ["issue 1", "issue 2"]
    }
  ],
  "libraries": [
    {
      "name": "CryptoJS | crypto-js | JSEncrypt | forge | sjcl | Web Crypto API | node:crypto",
      "version": "4.1.1 | unknown",
      "confidence": 0.92,
      "detectionMethod": "import statement | CDN link | global object | API usage"
    }
  ],
  "securityAssessment": {
    "overallStrength": "strong | medium | weak | critical",
    "score": 75,
    "weakAlgorithms": [
      {
        "algorithm": "MD5",
        "reason": "Cryptographically broken, vulnerable to collision attacks",
        "severity": "critical | high | medium | low",
        "cwe": "CWE-327"
      }
    ],
    "hardcodedSecrets": [
      {
        "type": "encryption key | API key | password",
        "location": "line 15",
        "value": "first 10 chars...",
        "severity": "critical"
      }
    ],
    "vulnerabilities": [
      {
        "type": "ECB mode usage | Weak key | No IV | Predictable IV | etc.",
        "description": "detailed description",
        "impact": "data leakage | authentication bypass | etc.",
        "cvss": 7.5,
        "cwe": "CWE-326"
      }
    ],
    "recommendations": [
      {
        "priority": "critical | high | medium | low",
        "issue": "what's wrong",
        "solution": "how to fix it",
        "example": "code example if applicable"
      }
    ]
  },
  "summary": "Brief summary of crypto usage and main security concerns"
}
\`\`\`

# Example Output
\`\`\`json
{
  "algorithms": [
    {
      "name": "AES-256-CBC",
      "type": "symmetric",
      "variant": "CBC",
      "confidence": 0.98,
      "location": {"line": 23, "function": "encryptPassword", "codeSnippet": "CryptoJS.AES.encrypt(data, key)"},
      "parameters": {
        "keySize": "256",
        "key": "hardcoded",
        "keyValue": "mySecretKey12345...",
        "iv": "absent",
        "mode": "CBC",
        "padding": "PKCS7",
        "salt": "absent",
        "iterations": null
      },
      "usage": "encryption",
      "securityIssues": ["Hardcoded key", "No IV specified (using default)"]
    }
  ],
  "libraries": [
    {"name": "CryptoJS", "version": "4.1.1", "confidence": 0.95, "detectionMethod": "CDN link"}
  ],
  "securityAssessment": {
    "overallStrength": "weak",
    "score": 35,
    "weakAlgorithms": [],
    "hardcodedSecrets": [
      {"type": "encryption key", "location": "line 10", "value": "mySecretKe...", "severity": "critical"}
    ],
    "vulnerabilities": [
      {
        "type": "Hardcoded encryption key",
        "description": "Encryption key is hardcoded in source code",
        "impact": "Anyone with access to code can decrypt all data",
        "cvss": 9.1,
        "cwe": "CWE-321"
      }
    ],
    "recommendations": [
      {
        "priority": "critical",
        "issue": "Hardcoded encryption key",
        "solution": "Use environment variables or secure key management service (KMS)",
        "example": "const key = process.env.ENCRYPTION_KEY;"
      }
    ]
  },
  "summary": "Uses AES-256-CBC with CryptoJS but has critical security flaw: hardcoded encryption key. Immediate remediation required."
}
\`\`\`

Now analyze the code and return ONLY the JSON output.`;
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];
    }
    buildStructuredPromptContext(context = {}) {
        return JSON.stringify({
            objective: context.objective || 'Recover readable JavaScript and preserve behavior',
            budget: context.budget || 'standard',
            facts: context.facts || [],
            inferences: context.inferences || [],
            unknowns: context.unknowns || [],
            evidenceIds: context.evidenceIds || [],
            nextActions: context.nextActions || [],
        }, null, 2);
    }
    generateDeobfuscationPrompt(code, context = {}) {
        const systemPrompt = `# Role
You are an expert JavaScript reverse engineer specializing in:
- Code deobfuscation and obfuscation pattern recognition
- Obfuscator tool identification (javascript-obfuscator, UglifyJS, Terser, Webpack, etc.)
- Control flow analysis and simplification
- Semantic code understanding and variable naming
- AST manipulation and code transformation

# Known Obfuscation Techniques
1. **String Array Obfuscation**: Strings stored in arrays with index-based access
2. **Control Flow Flattening**: Switch-case state machines replacing normal control flow
3. **Dead Code Injection**: Unreachable code blocks (if(false){...})
4. **Opaque Predicates**: Always-true/false conditions (if(5>3){...})
5. **Variable Name Mangling**: _0x1234, _0xabcd style names
6. **Function Inlining/Outlining**: Moving code between functions
7. **Encoding**: Hex, Unicode, Base64 encoded strings
8. **VM Protection**: Custom virtual machine interpreters
9. **Self-Defending**: Anti-debugging and anti-tampering code

# Task
Analyze the obfuscated code to:
1. Identify the obfuscation type and tool used
2. Understand the actual program logic
3. Suggest meaningful variable and function names
4. Provide deobfuscated code if possible
5. Explain the deobfuscation process step-by-step

# Constraints
- Preserve exact program functionality
- Do NOT guess or hallucinate functionality
- If uncertain, mark with confidence scores
- Provide partial results if full deobfuscation is not possible`;
        const structuredContext = this.buildStructuredPromptContext(context);
        const userPrompt = `# Obfuscated Code
\`\`\`javascript
${code.length > 3000 ? code.substring(0, 3000) + '\n\n// ... (code truncated)' : code}
\`\`\`

# Investigation Context
\`\`\`json
${structuredContext}
\`\`\`

# Required Output Schema
Return ONLY valid JSON:

\`\`\`json
{
  "obfuscationType": {
    "primary": "string-array | control-flow-flattening | vm-protection | mixed | unknown",
    "techniques": ["technique 1", "technique 2"],
    "tool": "javascript-obfuscator | webpack | uglify | terser | custom | unknown",
    "toolVersion": "string or null",
    "confidence": 0.85
  },
  "analysis": {
    "codeStructure": "description of overall structure",
    "mainLogic": "what the code actually does",
    "keyFunctions": [
      {
        "obfuscatedName": "_0x1234",
        "purpose": "what it does",
        "confidence": 0.9
      }
    ],
    "dataFlow": "how data flows through the code",
    "externalDependencies": ["list of external APIs or libraries used"]
  },
  "suggestions": {
    "variableRenames": {
      "_0x1234": {"suggested": "userId", "reason": "stores user ID from API", "confidence": 0.95},
      "_0x5678": {"suggested": "apiKey", "reason": "used in authentication header", "confidence": 0.88}
    },
    "functionRenames": {
      "_0xabcd": {"suggested": "encryptPassword", "reason": "calls CryptoJS.AES.encrypt", "confidence": 0.92}
    },
    "simplifications": [
      {
        "type": "remove dead code | unflatten control flow | decode strings",
        "description": "what to simplify",
        "impact": "high | medium | low"
      }
    ]
  },
  "deobfuscationSteps": [
    "Step 1: Extract string array at line 1-5",
    "Step 2: Replace string array calls with actual strings",
    "Step 3: Simplify control flow in function _0x1234",
    "Step 4: Rename variables based on usage context"
  ],
  "deobfuscatedCode": "string or null (full deobfuscated code if possible)",
  "partialResults": {
    "stringArrayDecoded": {"_0x0": "hello", "_0x1": "world"},
    "decodedFunctions": [
      {
        "original": "function _0x1234(){...}",
        "deobfuscated": "function getUserData(){...}",
        "confidence": 0.85
      }
    ]
  },
  "limitations": ["what couldn't be deobfuscated and why"],
  "summary": "Brief summary of obfuscation and deobfuscation results"
}
\`\`\`

# Example Output
\`\`\`json
{
  "obfuscationType": {
    "primary": "string-array",
    "techniques": ["string-array", "variable-mangling", "dead-code-injection"],
    "tool": "javascript-obfuscator",
    "toolVersion": "4.0.0",
    "confidence": 0.92
  },
  "analysis": {
    "codeStructure": "IIFE with string array at top, followed by main logic",
    "mainLogic": "Fetches user data from API and encrypts password before sending",
    "keyFunctions": [
      {"obfuscatedName": "_0x1a2b", "purpose": "Decodes strings from array", "confidence": 0.98},
      {"obfuscatedName": "_0x3c4d", "purpose": "Makes API request", "confidence": 0.95}
    ],
    "dataFlow": "User input -> validation -> encryption -> API call -> response handling",
    "externalDependencies": ["fetch API", "CryptoJS"]
  },
  "suggestions": {
    "variableRenames": {
      "_0x1a2b": {"suggested": "decodeString", "reason": "accesses string array with index", "confidence": 0.98},
      "_0x3c4d": {"suggested": "fetchUserData", "reason": "calls fetch() with /api/users", "confidence": 0.95}
    },
    "functionRenames": {
      "_0x5e6f": {"suggested": "encryptPassword", "reason": "uses CryptoJS.AES.encrypt", "confidence": 0.92}
    },
    "simplifications": [
      {"type": "decode strings", "description": "Replace all string array calls with actual strings", "impact": "high"},
      {"type": "remove dead code", "description": "Remove if(false) blocks at lines 45-60", "impact": "medium"}
    ]
  },
  "deobfuscationSteps": [
    "Step 1: Identified string array: ['hello', 'world', 'api', 'user']",
    "Step 2: Replaced _0x1a2b(0) with 'hello', _0x1a2b(1) with 'world'",
    "Step 3: Removed dead code blocks",
    "Step 4: Renamed functions based on their actual purpose"
  ],
  "deobfuscatedCode": "// Partially deobfuscated\nfunction fetchUserData(userId) {\n  const apiUrl = 'https://api.example.com/users/' + userId;\n  return fetch(apiUrl);\n}",
  "partialResults": {
    "stringArrayDecoded": {"_0x0": "hello", "_0x1": "world", "_0x2": "api"},
    "decodedFunctions": [
      {"original": "function _0x3c4d(_0x1){...}", "deobfuscated": "function fetchUserData(userId){...}", "confidence": 0.95}
    ]
  },
  "limitations": ["VM-protected section at lines 100-200 could not be fully deobfuscated", "Some variable names are uncertain due to lack of context"],
  "summary": "Code uses javascript-obfuscator with string array and dead code injection. Successfully decoded 80% of the code. Main functionality is user data fetching with password encryption."
}
\`\`\`

Now analyze the obfuscated code and return ONLY the JSON output.`;
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];
    }
    generateHookGenerationPrompt(description, context = {}) {
        const systemPrompt = `# Role
You are an expert JavaScript reverse engineer focused on runtime hook generation.

# Goal
Turn a reverse-engineering request into a structured hook plan that helps capture encryption inputs, outputs, request signatures, and decrypted payloads.

# Output Rules
- Return ONLY valid JSON
- Prefer object-method hooks when a concrete object path is available
- Prefer function hooks for standalone sign/encrypt/decrypt functions
- Prefer API hooks only when function-level targets are unknown
- Capture return values for decrypt/signature workflows by default
- Do not invent object paths that are unsupported by the evidence`;
        const userPrompt = `# Request
${description}

# Context
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

# Output Schema
\`\`\`json
{
  "target": {
    "type": "function | object-method | api | property | event | custom",
    "name": "string or null",
    "object": "string or null",
    "property": "string or null"
  },
  "behavior": {
    "captureArgs": true,
    "captureReturn": true,
    "captureStack": false,
    "logToConsole": true,
    "blockExecution": false
  },
  "condition": {
    "urlPattern": "string or null",
    "argFilter": "string or null"
  },
  "reasoning": "short explanation"
}
\`\`\``;
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];
    }
    generateTaintAnalysisPrompt(code, sources, sinks) {
        const systemPrompt = `# Role
You are a security researcher specializing in:
- Taint analysis and data flow tracking
- OWASP Top 10 vulnerability detection
- Source-Sink-Sanitizer analysis
- XSS, SQL Injection, Command Injection detection
- Secure coding practices

# Task
Analyze data flow from sources (user input) to sinks (dangerous operations) to identify security vulnerabilities.

# Methodology
1. Identify all data sources (user input, network, storage)
2. Track data flow through variables, functions, and operations
3. Identify sanitizers (validation, encoding, escaping)
4. Detect dangerous sinks (eval, innerHTML, SQL queries)
5. Report vulnerable paths where tainted data reaches sinks without sanitization`;
        const userPrompt = `# Code to Analyze
\`\`\`javascript
${code.length > 4000 ? code.substring(0, 4000) + '\n\n// ... (truncated)' : code}
\`\`\`

# Detected Sources
${sources.map(s => `- ${s}`).join('\n')}

# Detected Sinks
${sinks.map(s => `- ${s}`).join('\n')}

# Required Output
Return JSON with taint paths and vulnerabilities:

\`\`\`json
{
  "taintPaths": [
    {
      "source": {"type": "user_input", "location": "line 10", "variable": "userInput"},
      "sink": {"type": "eval", "location": "line 50", "variable": "code"},
      "path": ["userInput -> processData -> sanitize? -> code -> eval"],
      "sanitized": false,
      "vulnerability": "Code Injection",
      "severity": "critical",
      "cwe": "CWE-94"
    }
  ],
  "summary": "Found X vulnerable paths"
}
\`\`\`

Return ONLY the JSON output.`;
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];
    }
}
//# sourceMappingURL=LLMService.js.map
