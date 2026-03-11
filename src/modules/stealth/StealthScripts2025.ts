// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class StealthScripts2025 {
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
        await page.evaluateOnNewDocument(() => {
            const originalNavigator = navigator;
            delete Object.getPrototypeOf(originalNavigator).webdriver;
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true,
            });
            const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
            Object.getOwnPropertyNames = function (obj) {
                const props = originalGetOwnPropertyNames(obj);
                return props.filter(prop => prop !== 'webdriver');
            };
        });
    }
    static async mockChrome(page) {
        await page.evaluateOnNewDocument(() => {
            window.chrome = {
                runtime: {
                    connect: () => { },
                    sendMessage: () => { },
                    onMessage: {
                        addListener: () => { },
                        removeListener: () => { },
                    },
                },
                loadTimes: function () {
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
                },
                csi: function () {
                    return {
                        onloadT: Date.now(),
                        pageT: Date.now(),
                        startE: Date.now(),
                        tran: 15,
                    };
                },
                app: {},
            };
        });
    }
    static async mockPlugins(page) {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'plugins', {
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
        await page.evaluateOnNewDocument(() => {
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);
        });
    }
    static async mockCanvas(page) {
        await page.evaluateOnNewDocument(() => {
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
        await page.evaluateOnNewDocument(() => {
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
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'language', {
                get: () => 'en-US',
            });
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });
        });
    }
    static async mockBattery(page) {
        await page.evaluateOnNewDocument(() => {
            if ('getBattery' in navigator) {
                const originalGetBattery = navigator.getBattery;
                navigator.getBattery = function () {
                    return originalGetBattery.call(navigator).then((battery) => {
                        Object.defineProperty(battery, 'charging', { get: () => true });
                        Object.defineProperty(battery, 'chargingTime', { get: () => 0 });
                        Object.defineProperty(battery, 'dischargingTime', { get: () => Infinity });
                        Object.defineProperty(battery, 'level', { get: () => 1 });
                        return battery;
                    });
                };
            }
        });
    }
    static async fixMediaDevices(page) {
        await page.evaluateOnNewDocument(() => {
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
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
            }
        });
    }
    static async mockNotifications(page) {
        await page.evaluateOnNewDocument(() => {
            if ('Notification' in window) {
                Object.defineProperty(Notification, 'permission', {
                    get: () => 'default',
                });
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
        await page.setUserAgent(userAgents[platform]);
        await page.evaluateOnNewDocument((platformValue) => {
            Object.defineProperty(navigator, 'platform', {
                get: () => platformValue,
            });
            Object.defineProperty(navigator, 'vendor', {
                get: () => 'Google Inc.',
            });
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8,
            });
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8,
            });
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