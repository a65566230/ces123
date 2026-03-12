// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class DOMInspector {
    collector;
    cdpSession = null;
    constructor(collector) {
        this.collector = collector;
    }
    async querySelector(selector, _getAttributes = true) {
        try {
            const page = await this.collector.getActivePage();
            const elementInfo = await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (!element) {
                    return { found: false };
                }
                const attributes = {};
                const attrs = element.attributes;
                for (let i = 0; i < attrs.length; i++) {
                    const attr = attrs[i];
                    if (attr) {
                        attributes[attr.name] = attr.value;
                    }
                }
                const rect = element.getBoundingClientRect();
                const boundingBox = {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                };
                const style = window.getComputedStyle(element);
                const visible = style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0';
                return {
                    found: true,
                    nodeName: element.nodeName,
                    attributes,
                    textContent: element.textContent?.trim() || '',
                    boundingBox,
                    visible,
                };
            }, selector);
            logger.info(`querySelector: ${selector} - ${elementInfo.found ? 'found' : 'not found'}`);
            return elementInfo;
        }
        catch (error) {
            logger.error(`querySelector failed for ${selector}:`, error);
            return { found: false };
        }
    }
    async querySelectorAll(selector, limit = 50) {
        try {
            const page = await this.collector.getActivePage();
            const elements = await page.evaluate(({ selector: sel, limit: maxLimit }) => {
                const nodeList = document.querySelectorAll(sel);
                if (nodeList.length > maxLimit) {
                    console.warn(`[DOMInspector] Found ${nodeList.length} elements for "${sel}", limiting to ${maxLimit}`);
                }
                const results = [];
                for (let i = 0; i < Math.min(nodeList.length, maxLimit); i++) {
                    const element = nodeList[i];
                    if (!element)
                        continue;
                    const attributes = {};
                    const attrs = element.attributes;
                    for (let j = 0; j < attrs.length; j++) {
                        const attr = attrs[j];
                        if (attr) {
                            attributes[attr.name] = attr.value;
                        }
                    }
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    const textContent = element.textContent?.trim() || '';
                    const truncatedText = textContent.length > 500
                        ? textContent.substring(0, 500) + '...[truncated]'
                        : textContent;
                    results.push({
                        found: true,
                        nodeName: element.nodeName,
                        attributes,
                        textContent: truncatedText,
                        boundingBox: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                        },
                        visible: style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0',
                    });
                }
                return results;
            }, { selector, limit });
            logger.info(`querySelectorAll: ${selector} - found ${elements.length} elements (limit: ${limit})`);
            return elements;
        }
        catch (error) {
            logger.error(`querySelectorAll failed for ${selector}:`, error);
            return [];
        }
    }
    async getStructure(maxDepth = 3, includeText = true) {
        try {
            const page = await this.collector.getActivePage();
            const html = await page.content();
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const bodyContent = bodyMatch?.[1] || '';
            const childMatches = Array.from(bodyContent.matchAll(/<([A-Za-z0-9-]+)([^>]*)>/g)).slice(0, 60);
            const children = childMatches.map((match) => {
                const attrs = match[2] || '';
                const idMatch = attrs.match(/\sid="([^"]+)"/i);
                const classMatch = attrs.match(/\sclass="([^"]+)"/i);
                return {
                    tag: String(match[1] || '').toUpperCase(),
                    id: idMatch?.[1],
                    class: classMatch?.[1],
                };
            });
            const structure = {
                tag: 'BODY',
                children: children.slice(0, Math.max(1, maxDepth * 20)),
            };
            if (includeText) {
                structure.text = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
            }
            logger.info('DOM structure retrieved');
            return structure;
        }
        catch (error) {
            logger.error('getStructure failed:', error);
            return null;
        }
    }
    async findClickable(filterText) {
        try {
            const page = await this.collector.getActivePage();
            const clickableElements = await page.evaluate((filter) => {
                const results = [];
                const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
                buttons.forEach((btn) => {
                    const text = btn.textContent?.trim() || btn.value || '';
                    if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
                        return;
                    }
                    const rect = btn.getBoundingClientRect();
                    const style = window.getComputedStyle(btn);
                    const visible = style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 && rect.height > 0;
                    let selector = btn.tagName.toLowerCase();
                    if (btn.id) {
                        selector = `#${btn.id}`;
                    }
                    else if (btn.className) {
                        selector = `${btn.tagName.toLowerCase()}.${btn.className.split(' ')[0]}`;
                    }
                    results.push({
                        selector,
                        text,
                        type: 'button',
                        visible,
                        boundingBox: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                        },
                    });
                });
                const links = document.querySelectorAll('a[href]');
                links.forEach((link) => {
                    const text = link.textContent?.trim() || '';
                    if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
                        return;
                    }
                    const rect = link.getBoundingClientRect();
                    const style = window.getComputedStyle(link);
                    const visible = style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 && rect.height > 0;
                    let selector = 'a';
                    if (link.id) {
                        selector = `#${link.id}`;
                    }
                    else if (link.className) {
                        selector = `a.${link.className.split(' ')[0]}`;
                    }
                    results.push({
                        selector,
                        text,
                        type: 'link',
                        visible,
                        boundingBox: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                        },
                    });
                });
                return results;
            }, filterText);
            logger.info(`findClickable: found ${clickableElements.length} elements${filterText ? ` (filtered by: ${filterText})` : ''}`);
            return clickableElements;
        }
        catch (error) {
            logger.error('findClickable failed:', error);
            return [];
        }
    }
    async getComputedStyle(selector) {
        try {
            const page = await this.collector.getActivePage();
            const styles = await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (!element) {
                    return null;
                }
                const computed = window.getComputedStyle(element);
                const result = {};
                const importantProps = [
                    'display', 'visibility', 'opacity', 'position', 'zIndex',
                    'width', 'height', 'top', 'left', 'right', 'bottom',
                    'color', 'backgroundColor', 'fontSize', 'fontFamily',
                    'border', 'padding', 'margin', 'overflow',
                ];
                for (const prop of importantProps) {
                    result[prop] = computed.getPropertyValue(prop);
                }
                return result;
            }, selector);
            logger.info(`getComputedStyle: ${selector} - ${styles ? 'found' : 'not found'}`);
            return styles;
        }
        catch (error) {
            logger.error(`getComputedStyle failed for ${selector}:`, error);
            return null;
        }
    }
    async waitForElement(selector, timeout = 30000) {
        try {
            const page = await this.collector.getActivePage();
            await page.waitForSelector(selector, { timeout });
            return await this.querySelector(selector);
        }
        catch (error) {
            logger.error(`waitForElement timeout for ${selector}:`, error);
            return null;
        }
    }
    async observeDOMChanges(options = {}) {
        const page = await this.collector.getActivePage();
        await page.evaluate((opts) => {
            const targetNode = opts.selector
                ? document.querySelector(opts.selector)
                : document.body;
            if (!targetNode) {
                console.error('Target node not found for MutationObserver');
                return;
            }
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    console.log('[DOM Change]', {
                        type: mutation.type,
                        target: mutation.target,
                        addedNodes: mutation.addedNodes.length,
                        removedNodes: mutation.removedNodes.length,
                        attributeName: mutation.attributeName,
                    });
                });
            });
            observer.observe(targetNode, {
                childList: opts.childList !== false,
                attributes: opts.attributes !== false,
                characterData: opts.characterData !== false,
                subtree: opts.subtree !== false,
            });
            window.__domObserver = observer;
        }, options);
        logger.info('DOM change observer started');
    }
    async stopObservingDOM() {
        const page = await this.collector.getActivePage();
        await page.evaluate(() => {
            const observer = window.__domObserver;
            if (observer) {
                observer.disconnect();
                delete window.__domObserver;
            }
        });
        logger.info('DOM change observer stopped');
    }
    async findByText(text, tag) {
        try {
            const page = await this.collector.getActivePage();
            const elements = await page.evaluate(({ searchText, tagName }) => {
                const xpath = tagName
                    ? `//${tagName}[contains(text(), "${searchText}")]`
                    : `//*[contains(text(), "${searchText}")]`;
                const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                const elements = [];
                for (let i = 0; i < Math.min(result.snapshotLength, 100); i++) {
                    const element = result.snapshotItem(i);
                    if (!element)
                        continue;
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    let selector = element.tagName.toLowerCase();
                    if (element.id) {
                        selector = `#${element.id}`;
                    }
                    else if (element.className) {
                        const classes = element.className.split(' ').filter(c => c);
                        if (classes.length > 0) {
                            selector = `${element.tagName.toLowerCase()}.${classes[0]}`;
                        }
                    }
                    elements.push({
                        found: true,
                        nodeName: element.tagName,
                        textContent: element.textContent?.trim(),
                        selector,
                        boundingBox: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height,
                        },
                        visible: style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0',
                    });
                }
                return elements;
            }, { searchText: text, tagName: tag });
            logger.info(`findByText: "${text}" - found ${elements.length} elements`);
            return elements;
        }
        catch (error) {
            logger.error(`findByText failed for "${text}":`, error);
            return [];
        }
    }
    async getXPath(selector) {
        try {
            const page = await this.collector.getActivePage();
            const xpath = await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (!element) {
                    return null;
                }
                function getElementXPath(el) {
                    if (el.id) {
                        return `//*[@id="${el.id}"]`;
                    }
                    if (el === document.body) {
                        return '/html/body';
                    }
                    let ix = 0;
                    const siblings = el.parentNode?.children;
                    if (siblings) {
                        for (let i = 0; i < siblings.length; i++) {
                            const sibling = siblings[i];
                            if (!sibling)
                                continue;
                            if (sibling === el) {
                                const parentPath = el.parentElement
                                    ? getElementXPath(el.parentElement)
                                    : '';
                                return `${parentPath}/${el.tagName.toLowerCase()}[${ix + 1}]`;
                            }
                            if (sibling.tagName === el.tagName) {
                                ix++;
                            }
                        }
                    }
                    return '';
                }
                return getElementXPath(element);
            }, selector);
            logger.info(`getXPath: ${selector} -> ${xpath}`);
            return xpath;
        }
        catch (error) {
            logger.error(`getXPath failed for ${selector}:`, error);
            return null;
        }
    }
    async isInViewport(selector) {
        try {
            const page = await this.collector.getActivePage();
            const inViewport = await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (!element) {
                    return false;
                }
                const rect = element.getBoundingClientRect();
                return (rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth));
            }, selector);
            logger.info(`isInViewport: ${selector} - ${inViewport}`);
            return inViewport;
        }
        catch (error) {
            logger.error(`isInViewport failed for ${selector}:`, error);
            return false;
        }
    }
    async close() {
        if (this.cdpSession) {
            await this.cdpSession.detach();
            this.cdpSession = null;
            logger.info('DOM Inspector CDP session closed');
        }
    }
}
//# sourceMappingURL=DOMInspector.js.map
