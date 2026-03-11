// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class CaptchaDetector {
    static EXCLUDE_SELECTORS = [
        '[class*="video"]',
        '[class*="player"]',
        '[id*="video"]',
        '[id*="player"]',
        '[class*="swiper"]',
        '[class*="carousel"]',
        '[class*="banner"]',
        '[class*="gallery"]',
        '[class*="douyin"]',
        '[class*="tiktok"]',
        '[class*="scroll"]',
        '[class*="scrollbar"]',
        '[class*="progress"]',
        '[class*="range"]',
        '[class*="volume"]',
    ];
    static CAPTCHA_SELECTORS = {
        slider: [
            '.captcha-slider',
            '.verify-slider',
            '#captcha-slider',
            '.slide-verify',
            '#nc_1_wrapper',
            '.nc-container',
            '.geetest_slider',
            '.geetest_holder',
            '.tcaptcha-transform',
            '.JDJRV-slide-inner',
            '.yidun_slider',
            '[class*="captcha"][class*="slider"]',
            '[class*="verify"][class*="slider"]',
            '[id*="captcha"][id*="slider"]',
            '[id*="verify"][id*="slider"]',
        ],
        image: [
            '[class*="captcha-image"]',
            '[id*="captcha-image"]',
            '.verify-img',
            '.captcha-img',
            'img[src*="captcha"]',
            'img[alt*="验证码"]',
            'img[alt*="captcha"]',
        ],
        recaptcha: [
            'iframe[src*="recaptcha"]',
            '.g-recaptcha',
            '#g-recaptcha',
            '[class*="recaptcha"]',
            'iframe[title*="reCAPTCHA"]',
        ],
        hcaptcha: [
            'iframe[src*="hcaptcha"]',
            '.h-captcha',
            '#h-captcha',
            '[class*="hcaptcha"]',
            'iframe[title*="hCaptcha"]',
        ],
        cloudflare: [
            '#challenge-form',
            '.cf-challenge',
            '[id*="cf-challenge"]',
            'iframe[src*="challenges.cloudflare.com"]',
            '#cf-wrapper',
            '.ray-id',
        ],
        generic: [
            '[class*="captcha"]',
            '[id*="captcha"]',
            '[class*="verify"]',
            '[id*="verify"]',
            '[class*="challenge"]',
            '[id*="challenge"]',
            'iframe[src*="captcha"]',
            'iframe[src*="verify"]',
        ],
    };
    static CAPTCHA_KEYWORDS = {
        title: [
            '验证', '安全验证', '滑动验证', '点击验证', '人机验证', '行为验证',
            '智能验证', '拖动验证', '图形验证', '验证中', '正在验证',
            'captcha', 'challenge', 'verify', 'verification', 'robot', 'human',
            'security check', 'bot check', 'anti-bot', 'cloudflare',
            'geetest', 'recaptcha', 'hcaptcha', 'turnstile',
        ],
        url: [
            'captcha', 'challenge', 'verify', 'verification',
            'robot-check', 'security-check', 'bot-check',
            'cdn-cgi/challenge', 'cloudflare', 'akamai',
            'geetest', 'recaptcha', 'hcaptcha', 'turnstile',
            'datadome', 'perimeter', 'px-captcha',
        ],
        text: [
            '请完成安全验证', '拖动滑块', '点击验证', '滑动验证',
            '请按住滑块', '向右滑动', '拖动滑块完成验证',
            '点击按钮进行验证', '完成验证', '人机验证',
            '请证明你不是机器人', '安全检查中',
            'Please verify', 'Verify you are human', 'Complete the security check',
            'Slide to verify', 'Click to verify', 'Drag the slider',
            'Prove you are human', 'I am not a robot',
            'Checking your browser', 'Just a moment',
            'Checking if the site connection is secure',
            'This process is automatic',
            'Protected by', 'Powered by',
        ],
    };
    static EXCLUDE_KEYWORDS = {
        title: [
            '验证码登录',
            '手机验证码',
            '邮箱验证码',
            '短信验证码',
            '获取验证码',
            '发送验证码',
            '输入验证码',
            'verification code',
            'enter code',
            'sms code',
        ],
        url: [
            'verify-email',
            'verify-phone',
            'email-verification',
            'account-verification',
            'verify-account',
        ],
        text: [
            '请输入验证码',
            '获取验证码',
            '发送验证码',
            '验证码已发送',
            '重新发送验证码',
            'Enter verification code',
            'Get code',
            'Send code',
        ],
    };
    async detect(page) {
        try {
            logger.info('🔍 开始检测验证码...');
            const urlCheck = await this.checkUrl(page);
            if (urlCheck.detected) {
                return urlCheck;
            }
            const titleCheck = await this.checkTitle(page);
            if (titleCheck.detected) {
                return titleCheck;
            }
            const domCheck = await this.checkDOMElements(page);
            if (domCheck.detected) {
                return domCheck;
            }
            const textCheck = await this.checkPageText(page);
            if (textCheck.detected) {
                return textCheck;
            }
            const vendorCheck = await this.checkVendorSpecific(page);
            if (vendorCheck.detected) {
                return vendorCheck;
            }
            logger.info('✅ 未检测到验证码');
            return { detected: false, confidence: 0 };
        }
        catch (error) {
            logger.error('验证码检测失败', error);
            return { detected: false, confidence: 0 };
        }
    }
    async checkUrl(page) {
        const url = page.url();
        const lowerUrl = url.toLowerCase();
        for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.url) {
            if (lowerUrl.includes(excludeKeyword)) {
                logger.debug(`✅ URL包含排除关键词,非验证码: ${excludeKeyword}`);
                return { detected: false, confidence: 0, falsePositiveReason: `排除关键词: ${excludeKeyword}` };
            }
        }
        for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.url) {
            if (lowerUrl.includes(keyword)) {
                let type = 'url_redirect';
                let vendor = 'unknown';
                let confidence = 70;
                if (url.includes('cloudflare') || url.includes('cdn-cgi')) {
                    type = 'cloudflare';
                    vendor = 'cloudflare';
                    confidence = 95;
                }
                else if (url.includes('recaptcha')) {
                    type = 'recaptcha';
                    vendor = 'recaptcha';
                    confidence = 95;
                }
                else if (url.includes('hcaptcha')) {
                    type = 'hcaptcha';
                    vendor = 'hcaptcha';
                    confidence = 95;
                }
                else if (url.includes('geetest')) {
                    type = 'slider';
                    vendor = 'geetest';
                    confidence = 90;
                }
                if (confidence < 80) {
                    const domCheck = await this.verifyByDOM(page);
                    if (!domCheck) {
                        logger.debug(`⚠️ URL包含关键词但DOM验证失败,可能是误报: ${keyword}`);
                        return { detected: false, confidence: 0, falsePositiveReason: `URL关键词但无DOM验证: ${keyword}` };
                    }
                    confidence = 85;
                }
                logger.warn(`⚠️ URL包含验证码关键词: ${keyword} (置信度: ${confidence}%)`);
                return {
                    detected: true,
                    type,
                    url,
                    vendor,
                    confidence,
                };
            }
        }
        return { detected: false, confidence: 0 };
    }
    async checkTitle(page) {
        const title = await page.title();
        const lowerTitle = title.toLowerCase();
        for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.title) {
            if (lowerTitle.includes(excludeKeyword.toLowerCase())) {
                logger.debug(`✅ 标题包含排除关键词,非验证码: ${excludeKeyword}`);
                return { detected: false, confidence: 0, falsePositiveReason: `排除关键词: ${excludeKeyword}` };
            }
        }
        for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.title) {
            if (lowerTitle.includes(keyword)) {
                const domCheck = await this.verifyByDOM(page);
                if (!domCheck) {
                    logger.debug(`⚠️ 标题包含关键词但DOM验证失败,可能是误报: ${keyword}`);
                    return { detected: false, confidence: 0, falsePositiveReason: `标题关键词但无DOM验证: ${keyword}` };
                }
                logger.warn(`⚠️ 页面标题包含验证码关键词: ${keyword}`);
                return {
                    detected: true,
                    type: 'page_redirect',
                    title,
                    confidence: 85,
                };
            }
        }
        return { detected: false, confidence: 0 };
    }
    async checkDOMElements(page) {
        for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.slider) {
            const element = await page.$(selector);
            if (element) {
                const isVisible = await element.isIntersectingViewport();
                if (isVisible) {
                    const isRealSlider = await this.verifySliderElement(page, selector);
                    if (!isRealSlider) {
                        logger.debug(`⚠️ 元素匹配但不是真正的滑块验证码: ${selector}`);
                        continue;
                    }
                    logger.warn(`⚠️ 检测到滑块验证码: ${selector}`);
                    let vendor = 'unknown';
                    if (selector.includes('geetest'))
                        vendor = 'geetest';
                    else if (selector.includes('nc_') || selector.includes('aliyun'))
                        vendor = 'aliyun';
                    else if (selector.includes('tcaptcha') || selector.includes('tencent'))
                        vendor = 'tencent';
                    return {
                        detected: true,
                        type: 'slider',
                        selector,
                        vendor,
                        confidence: 95,
                    };
                }
            }
        }
        for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.recaptcha) {
            const element = await page.$(selector);
            if (element) {
                logger.warn(`⚠️ 检测到reCAPTCHA: ${selector}`);
                return {
                    detected: true,
                    type: 'recaptcha',
                    selector,
                    vendor: 'recaptcha',
                    confidence: 98,
                };
            }
        }
        for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.hcaptcha) {
            const element = await page.$(selector);
            if (element) {
                logger.warn(`⚠️ 检测到hCaptcha: ${selector}`);
                return {
                    detected: true,
                    type: 'hcaptcha',
                    selector,
                    vendor: 'hcaptcha',
                    confidence: 98,
                };
            }
        }
        for (const selector of CaptchaDetector.CAPTCHA_SELECTORS.cloudflare) {
            const element = await page.$(selector);
            if (element) {
                logger.warn(`⚠️ 检测到Cloudflare验证: ${selector}`);
                return {
                    detected: true,
                    type: 'cloudflare',
                    selector,
                    vendor: 'cloudflare',
                    confidence: 97,
                };
            }
        }
        return { detected: false, confidence: 0 };
    }
    async checkPageText(page) {
        const bodyText = await page.evaluate(() => document.body.innerText);
        for (const excludeKeyword of CaptchaDetector.EXCLUDE_KEYWORDS.text) {
            if (bodyText.includes(excludeKeyword)) {
                logger.debug(`✅ 文本包含排除关键词,非验证码: ${excludeKeyword}`);
                return { detected: false, confidence: 0, falsePositiveReason: `排除关键词: ${excludeKeyword}` };
            }
        }
        for (const keyword of CaptchaDetector.CAPTCHA_KEYWORDS.text) {
            if (bodyText.includes(keyword)) {
                const domCheck = await this.verifyByDOM(page);
                if (!domCheck) {
                    logger.debug(`⚠️ 文本包含关键词但DOM验证失败,可能是误报: ${keyword}`);
                    return { detected: false, confidence: 0, falsePositiveReason: `文本关键词但无DOM验证: ${keyword}` };
                }
                logger.warn(`⚠️ 页面文本包含验证码关键词: ${keyword}`);
                return {
                    detected: true,
                    type: 'unknown',
                    confidence: 75,
                    details: { keyword },
                };
            }
        }
        return { detected: false, confidence: 0 };
    }
    async checkVendorSpecific(page) {
        const geetestCheck = await page.evaluate(() => {
            return !!window.initGeetest || document.querySelector('.geetest_holder');
        });
        if (geetestCheck) {
            logger.warn('⚠️ 检测到极验验证码');
            return {
                detected: true,
                type: 'slider',
                vendor: 'geetest',
                confidence: 95,
            };
        }
        const tencentCheck = await page.evaluate(() => {
            return !!window.TencentCaptcha || document.querySelector('.tcaptcha-transform');
        });
        if (tencentCheck) {
            logger.warn('⚠️ 检测到腾讯验证码');
            return {
                detected: true,
                type: 'slider',
                vendor: 'tencent',
                confidence: 95,
            };
        }
        return { detected: false, confidence: 0 };
    }
    async waitForCompletion(page, timeout = 300000) {
        logger.info('⏳ 等待用户完成验证码...');
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const result = await this.detect(page);
            if (!result.detected) {
                logger.info('✅ 验证码已完成');
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        logger.error('❌ 验证码完成超时');
        return false;
    }
    async verifyByDOM(page) {
        try {
            const hasSlider = await page.evaluate(() => {
                const sliderSelectors = [
                    '.captcha-slider',
                    '.geetest_slider',
                    '.tcaptcha-transform',
                    '#nc_1_wrapper',
                    '.slide-verify',
                ];
                return sliderSelectors.some(sel => document.querySelector(sel) !== null);
            });
            const hasRecaptcha = await page.evaluate(() => {
                return !!document.querySelector('iframe[src*="recaptcha"]') ||
                    !!document.querySelector('.g-recaptcha');
            });
            const hasHcaptcha = await page.evaluate(() => {
                return !!document.querySelector('iframe[src*="hcaptcha"]') ||
                    !!document.querySelector('.h-captcha');
            });
            const hasCloudflare = await page.evaluate(() => {
                return !!document.querySelector('#challenge-form') ||
                    !!document.querySelector('.cf-challenge');
            });
            return hasSlider || hasRecaptcha || hasHcaptcha || hasCloudflare;
        }
        catch (error) {
            logger.error('DOM验证失败', error);
            return false;
        }
    }
    async verifySliderElement(page, selector) {
        try {
            const excludeSelectors = CaptchaDetector.EXCLUDE_SELECTORS;
            const result = await page.evaluate((sel, excludeSels) => {
                const element = document.querySelector(sel);
                if (!element)
                    return false;
                for (const excludeSel of excludeSels) {
                    if (element.matches(excludeSel)) {
                        console.log(`[CaptchaDetector] 元素匹配排除选择器: ${excludeSel}`);
                        return false;
                    }
                    if (element.closest(excludeSel)) {
                        console.log(`[CaptchaDetector] 父元素匹配排除选择器: ${excludeSel}`);
                        return false;
                    }
                }
                const rect = element.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0)
                    return false;
                const className = element.className.toLowerCase();
                const id = element.id.toLowerCase();
                const excludeKeywords = [
                    'video', 'player', 'swiper', 'carousel', 'banner',
                    'gallery', 'douyin', 'tiktok', 'scroll', 'progress',
                    'range', 'volume', 'seek', 'timeline'
                ];
                for (const keyword of excludeKeywords) {
                    if (className.includes(keyword) || id.includes(keyword)) {
                        console.log(`[CaptchaDetector] 类名/ID包含排除关键词: ${keyword}`);
                        return false;
                    }
                }
                const hasCaptchaKeyword = className.includes('captcha') ||
                    className.includes('verify') ||
                    className.includes('challenge') ||
                    id.includes('captcha') ||
                    id.includes('verify') ||
                    id.includes('challenge');
                const style = window.getComputedStyle(element);
                const hasDraggableStyle = style.cursor === 'move' ||
                    style.cursor === 'grab' ||
                    style.cursor === 'grabbing';
                const hasSliderClass = className.includes('slider') ||
                    className.includes('slide');
                const hasDragAttribute = element.hasAttribute('draggable') ||
                    element.hasAttribute('data-slide') ||
                    element.hasAttribute('data-captcha') ||
                    element.hasAttribute('data-verify');
                let parent = element.parentElement;
                let hasParentCaptcha = false;
                for (let i = 0; i < 3 && parent; i++) {
                    const parentClass = parent.className.toLowerCase();
                    const parentId = parent.id.toLowerCase();
                    if (parentClass.includes('captcha') ||
                        parentClass.includes('verify') ||
                        parentClass.includes('challenge') ||
                        parentId.includes('captcha') ||
                        parentId.includes('verify')) {
                        hasParentCaptcha = true;
                        break;
                    }
                    parent = parent.parentElement;
                }
                const width = rect.width;
                const height = rect.height;
                const hasReasonableSize = (width >= 30 && width <= 500) &&
                    (height >= 30 && height <= 200);
                if (!hasReasonableSize) {
                    console.log(`[CaptchaDetector] 尺寸不合理: ${width}x${height}`);
                    return false;
                }
                const conditionA = hasCaptchaKeyword && (hasSliderClass || hasDraggableStyle);
                const conditionB = hasParentCaptcha && hasSliderClass && hasDragAttribute;
                const isVendorSpecific = className.includes('geetest') ||
                    className.includes('nc_') ||
                    className.includes('tcaptcha') ||
                    className.includes('yidun') ||
                    id.includes('nc_1_wrapper');
                const isValid = conditionA || conditionB || isVendorSpecific;
                if (!isValid) {
                    console.log(`[CaptchaDetector] 验证失败 - captcha:${hasCaptchaKeyword}, slider:${hasSliderClass}, parent:${hasParentCaptcha}`);
                }
                return isValid;
            }, selector, excludeSelectors);
            return result;
        }
        catch (error) {
            logger.error('验证滑块元素失败', error);
            return false;
        }
    }
}
//# sourceMappingURL=CaptchaDetector.js.map