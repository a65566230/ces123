// @ts-nocheck
import fs from 'fs';
import path from 'path';

export function buildCodexExecInvocation(platform, schemaPath, options = {}) {
    return buildCodexExecInvocations(platform, schemaPath, options)[0];
}

function getCodexErrorText(result) {
    return [
        String(result?.stderr || ''),
        result?.error ? String(result.error) : '',
    ].filter(Boolean).join('\n');
}

function hasStreamDisconnect(result) {
    if ((result?.repeatedDisconnects || 0) > 0) {
        return true;
    }
    return getCodexErrorText(result).includes('stream disconnected');
}

function hasLauncherFailure(result) {
    const errorText = getCodexErrorText(result);
    return /\bENOENT\b|\bEINVAL\b|not recognized as an internal or external command|unknown option/i.test(errorText);
}

export function decideCodexExecNextStep(result, options = {}) {
    if (options.hasUsableOutput || result?.status === 0) {
        return {
            action: 'accept',
            reason: options.hasUsableOutput ? 'usable-output' : 'zero-exit',
        };
    }

    if (hasStreamDisconnect(result)) {
        return {
            action: 'abort-benchmark',
            reason: 'stream-disconnected',
        };
    }

    if (hasLauncherFailure(result)) {
        return {
            action: options.isLastInvocation ? 'abort-benchmark' : 'next-invocation',
            reason: 'launcher-failure',
        };
    }

    if (result?.timedOut) {
        return {
            action: 'abort-benchmark',
            reason: 'timed-out',
        };
    }

    if ((options.attempt || 1) < (options.maxAttempts || 1)) {
        return {
            action: 'retry-invocation',
            reason: 'retry-budget-remaining',
        };
    }

    if (!options.isLastInvocation) {
        return {
            action: 'next-invocation',
            reason: 'attempt-exhausted',
        };
    }

    return {
        action: 'abort-benchmark',
        reason: 'attempt-exhausted',
    };
}

function resolveWindowsCodexNodeInvocation(commonArgs) {
    const appData = process.env.APPDATA;
    const codexScriptPath = appData
        ? path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
        : '';
    if (!codexScriptPath || !fs.existsSync(codexScriptPath)) {
        return null;
    }
    return {
        command: process.execPath,
        args: [codexScriptPath, ...commonArgs],
        shell: false,
    };
}

export function buildCodexExecInvocations(platform, schemaPath, options = {}) {
    const outputLastMessagePath = typeof options.outputLastMessagePath === 'string' ? options.outputLastMessagePath : undefined;
    const commonArgs = [
        'exec',
        '--json',
        '--color',
        'never',
        '--ephemeral',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '--output-schema',
        schemaPath,
    ];
    if (outputLastMessagePath) {
        commonArgs.push('--output-last-message', outputLastMessagePath);
    }
    commonArgs.push('-');
    const directInvocation = {
        command: 'codex',
        args: commonArgs,
        shell: platform === 'win32',
    };
    if (platform !== 'win32') {
        return [directInvocation];
    }
    const windowsNodeInvocation = resolveWindowsCodexNodeInvocation(commonArgs);
    return [
        ...(windowsNodeInvocation ? [windowsNodeInvocation] : []),
        {
            command: 'cmd.exe',
            args: [
                '/d',
                '/s',
                '/c',
                `codex exec --json --color never --ephemeral --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-schema ${schemaPath}${outputLastMessagePath ? ` --output-last-message ${outputLastMessagePath}` : ''} -`,
            ],
            shell: false,
        },
    ];
}
