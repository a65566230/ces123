// @ts-nocheck

import { logger } from '../../utils/logger.js';
import { addInitScriptCompat, setUserAgentCompat } from '../../utils/playwrightCompat.js';
export class StealthScripts2025 {
    static async addInit(page, script, arg) {
        return addInitScriptCompat(page, script, arg);
    }
    static buildPatchPrelude(flagName) {
        return `(() => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root[${JSON.stringify(flagName)}]) {
                return false;
            }
            root[${JSON.stringify(flagName)}] = true;
            const safeDefine = (target, key, descriptor) => {
                try {
                    const existing = Object.getOwnPropertyDescriptor(target, key);
                    if (existing && existing.configurable === false) {
                        return false;
                    }
                    Object.defineProperty(target, key, {
                        configurable: true,
                        ...descriptor,
                    });
                    return true;
                }
                catch (_error) {
                    return false;
                }
            };
            return { root, safeDefine };
        })()`;
    }
    static async injectAll(page) {
        logger.info('🛡️ 注入2024-2025最新反检测脚本...');
        await Promise.all([
            this.hideWebDriver(page),
            this.mockChrome(page),
            this.mockPlugins(page),
            this.fixPermissions(page),
            this.mockCanvas(page),
            this.mockWebGL(page),
            this.fixLanguages(page),
            this.mockBattery(page),
            this.fixMediaDevices(page),
            this.mockNotifications(page),
        ]);
        logger.info('✅ 反检测脚本注入完成');
    }
    static async hideWebDriver(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.hideWebDriverApplied) {
                return;
            }
            root.hideWebDriverApplied = true;
            const originalNavigator = navigator;
            try {
                delete Object.getPrototypeOf(originalNavigator).webdriver;
            }
            catch (_error) {
                // ignore prototype patch failures when webdriver is already locked down
            }
            const existing = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
            if (!existing || existing.configurable === true) {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                    configurable: true,
                });
            }
            const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
            if (!root.getOwnPropertyNamesWrapped) {
                Object.getOwnPropertyNames = function (obj) {
                    const props = originalGetOwnPropertyNames(obj);
                    return props.filter(prop => prop !== 'webdriver');
                };
                root.getOwnPropertyNamesWrapped = true;
            }
        });
    }
    static async mockChrome(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.mockChromeApplied) {
                return;
            }
            root.mockChromeApplied = true;
            window.chrome = window.chrome || {};
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
            window.chrome.app = window.chrome.app || {};
        });
    }
    static async mockPlugins(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.mockPluginsApplied) {
                return;
            }
            root.mockPluginsApplied = true;
            const existing = Object.getOwnPropertyDescriptor(navigator, 'plugins');
            if (existing && existing.configurable === false) {
                return;
            }
            Object.defineProperty(navigator, 'plugins', {
                configurable: true,
                get: () => [
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
                ],
            });
        });
    }
    static async fixPermissions(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.fixPermissionsApplied) {
                return;
            }
            root.fixPermissionsApplied = true;
            const originalQuery = window.navigator.permissions.query;
            if (!originalQuery || originalQuery.__jshookWrapped) {
                return;
            }
            const wrapped = (parameters) => parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);
            wrapped.__jshookWrapped = true;
            window.navigator.permissions.query = wrapped;
        });
    }
    static async mockCanvas(page) {
        await this.addInit(page, () => {
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
            const addNoise = (imageData) => {
                const data = imageData.data;
                if (data) {
                    for (let i = 0; i < data.length; i += 4) {
                        data[i] = data[i] ^ 1;
                        data[i + 1] = data[i + 1] ^ 1;
                        data[i + 2] = data[i + 2] ^ 1;
                    }
                }
                return imageData;
            };
            HTMLCanvasElement.prototype.toDataURL = function (...args) {
                const context = this.getContext('2d');
                if (context) {
                    const imageData = context.getImageData(0, 0, this.width, this.height);
                    addNoise(imageData);
                    context.putImageData(imageData, 0, 0);
                }
                return originalToDataURL.apply(this, args);
            };
            CanvasRenderingContext2D.prototype.getImageData = function (...args) {
                const imageData = originalGetImageData.apply(this, args);
                return addNoise(imageData);
            };
        });
    }
    static async mockWebGL(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.mockWebGLApplied) {
                return;
            }
            root.mockWebGLApplied = true;
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function (parameter) {
                if (parameter === 37445) {
                    return 'Intel Inc.';
                }
                if (parameter === 37446) {
                    return 'Intel Iris OpenGL Engine';
                }
                return getParameter.apply(this, [parameter]);
            };
        });
    }
    static async fixLanguages(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.fixLanguagesApplied) {
                return;
            }
            root.fixLanguagesApplied = true;
            const languageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'language');
            if (!languageDescriptor || languageDescriptor.configurable === true) {
                Object.defineProperty(navigator, 'language', {
                    configurable: true,
                    get: () => 'en-US',
                });
            }
            const languagesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'languages');
            if (!languagesDescriptor || languagesDescriptor.configurable === true) {
                Object.defineProperty(navigator, 'languages', {
                    configurable: true,
                    get: () => ['en-US', 'en'],
                });
            }
        });
    }
    static async mockBattery(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.mockBatteryApplied) {
                return;
            }
            root.mockBatteryApplied = true;
            if ('getBattery' in navigator) {
                const originalGetBattery = navigator.getBattery;
                if (originalGetBattery.__jshookWrapped) {
                    return;
                }
                navigator.getBattery = function () {
                    return originalGetBattery.call(navigator).then((battery) => {
                        const safeDefine = (key, value) => {
                            const descriptor = Object.getOwnPropertyDescriptor(battery, key);
                            if (descriptor && descriptor.configurable === false) {
                                return;
                            }
                            Object.defineProperty(battery, key, {
                                configurable: true,
                                get: () => value,
                            });
                        };
                        safeDefine('charging', true);
                        safeDefine('chargingTime', 0);
                        safeDefine('dischargingTime', Infinity);
                        safeDefine('level', 1);
                        return battery;
                    });
                };
                navigator.getBattery.__jshookWrapped = true;
            }
        });
    }
    static async fixMediaDevices(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.fixMediaDevicesApplied) {
                return;
            }
            root.fixMediaDevicesApplied = true;
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
                if (originalEnumerateDevices.__jshookWrapped) {
                    return;
                }
                navigator.mediaDevices.enumerateDevices = function () {
                    return originalEnumerateDevices.call(navigator.mediaDevices).then((devices) => {
                        if (devices.length === 0) {
                            return [
                                {
                                    deviceId: 'default',
                                    kind: 'audioinput',
                                    label: 'Default - Microphone',
                                    groupId: 'default',
                                    toJSON: () => ({}),
                                },
                                {
                                    deviceId: 'default',
                                    kind: 'videoinput',
                                    label: 'Default - Camera',
                                    groupId: 'default',
                                    toJSON: () => ({}),
                                },
                            ];
                        }
                        return devices;
                    });
                };
                navigator.mediaDevices.enumerateDevices.__jshookWrapped = true;
            }
        });
    }
    static async mockNotifications(page) {
        await this.addInit(page, () => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.mockNotificationsApplied) {
                return;
            }
            root.mockNotificationsApplied = true;
            if ('Notification' in window) {
                const descriptor = Object.getOwnPropertyDescriptor(Notification, 'permission');
                if (!descriptor || descriptor.configurable === true) {
                    Object.defineProperty(Notification, 'permission', {
                        configurable: true,
                        get: () => 'default',
                    });
                }
            }
        });
    }
    static async setRealisticUserAgent(page, platform = 'windows') {
        const userAgents = {
            windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        const platformMap = {
            windows: 'Win32',
            mac: 'MacIntel',
            linux: 'Linux x86_64',
        };
        await setUserAgentCompat(page, userAgents[platform]);
        await this.addInit(page, (platformValue) => {
            const root = globalThis.__jshookStealth2025 = globalThis.__jshookStealth2025 || {};
            if (root.realisticNavigatorPlatformApplied === platformValue) {
                return;
            }
            root.realisticNavigatorPlatformApplied = platformValue;
            const safeDefine = (key, value) => {
                const descriptor = Object.getOwnPropertyDescriptor(navigator, key);
                if (descriptor && descriptor.configurable === false) {
                    return;
                }
                Object.defineProperty(navigator, key, {
                    configurable: true,
                    get: () => value,
                });
            };
            safeDefine('platform', platformValue);
            safeDefine('vendor', 'Google Inc.');
            safeDefine('hardwareConcurrency', 8);
            safeDefine('deviceMemory', 8);
        }, platformMap[platform]);
    }
    static getRecommendedLaunchArgs() {
        return [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--window-size=1920,1080',
            '--disable-infobars',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
        ];
    }
}
//# sourceMappingURL=StealthScripts2025.js.map
