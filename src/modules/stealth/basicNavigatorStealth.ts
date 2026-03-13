// @ts-nocheck

export function applyBasicNavigatorStealthInit(options = {}) {
    const root = globalThis.__jshookStealthBase = globalThis.__jshookStealthBase || {};
    const flagName = String(options.flagName || 'basic-navigator-stealth');
    if (root[flagName]) {
        return;
    }
    root[flagName] = true;

    const safeDefine = (target, key, descriptor) => {
        const existing = Object.getOwnPropertyDescriptor(target, key);
        if (existing && existing.configurable === false) {
            return false;
        }
        Object.defineProperty(target, key, {
            configurable: true,
            ...descriptor,
        });
        return true;
    };

    const webdriverValue = options.webdriverMode === 'false' ? false : undefined;
    safeDefine(navigator, 'webdriver', {
        get: () => webdriverValue,
    });

    const realisticPlugins = [
        {
            0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
            description: 'Portable Document Format',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Plugin',
        },
        {
            0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '' },
            description: '',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Viewer',
        },
        {
            0: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
            1: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
            description: '',
            filename: 'internal-nacl-plugin',
            length: 2,
            name: 'Native Client',
        },
    ];
    const simplePlugins = [1, 2, 3, 4, 5];
    safeDefine(navigator, 'plugins', {
        get: () => options.pluginsMode === 'realistic' ? realisticPlugins : simplePlugins,
    });

    const languages = Array.isArray(options.languages) && options.languages.length > 0
        ? options.languages
        : ['en-US', 'en'];
    safeDefine(navigator, 'languages', {
        get: () => languages,
    });

    window.chrome = window.chrome || {};
    if (options.chromeProfile === 'rich') {
        window.chrome.runtime = window.chrome.runtime || {
            connect: () => { },
            sendMessage: () => { },
            onMessage: {
                addListener: () => { },
                removeListener: () => { },
            },
        };
        window.chrome.loadTimes = window.chrome.loadTimes || function () {
            return {
                commitLoadTime: Date.now() / 1000,
                connectionInfo: 'http/1.1',
                finishDocumentLoadTime: Date.now() / 1000,
                finishLoadTime: Date.now() / 1000,
                firstPaintAfterLoadTime: 0,
                firstPaintTime: Date.now() / 1000,
                navigationType: 'Other',
                npnNegotiatedProtocol: 'unknown',
                requestTime: 0,
                startLoadTime: Date.now() / 1000,
                wasAlternateProtocolAvailable: false,
                wasFetchedViaSpdy: false,
                wasNpnNegotiated: false,
            };
        };
        window.chrome.csi = window.chrome.csi || function () {
            return {
                onloadT: Date.now(),
                pageT: Date.now(),
                startE: Date.now(),
                tran: 15,
            };
        };
    }
    else {
        window.chrome.runtime = window.chrome.runtime || {};
        window.chrome.loadTimes = window.chrome.loadTimes || function () { };
        window.chrome.csi = window.chrome.csi || function () { };
    }
    window.chrome.app = window.chrome.app || {};

    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery && !originalQuery.__jshookWrapped) {
        const notificationState = options.notificationState === 'use-native-permission'
            ? Notification.permission
            : (options.notificationState || 'denied');
        const wrapped = (parameters) => {
            if (parameters?.name === 'notifications') {
                return Promise.resolve({ state: notificationState });
            }
            return originalQuery(parameters);
        };
        wrapped.__jshookWrapped = true;
        window.navigator.permissions.query = wrapped;
    }
}
