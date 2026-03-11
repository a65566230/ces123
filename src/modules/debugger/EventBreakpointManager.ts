// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class EventBreakpointManager {
    cdpSession;
    eventBreakpoints = new Map();
    breakpointCounter = 0;
    static MOUSE_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave'];
    static KEYBOARD_EVENTS = ['keydown', 'keyup', 'keypress'];
    static TIMER_EVENTS = ['setTimeout', 'setInterval', 'requestAnimationFrame'];
    static WEBSOCKET_EVENTS = ['message', 'open', 'close', 'error'];
    constructor(cdpSession) {
        this.cdpSession = cdpSession;
        logger.info('EventBreakpointManager initialized with shared CDP session');
    }
    async setEventListenerBreakpoint(eventName, targetName) {
        try {
            await this.cdpSession.send('DOMDebugger.setEventListenerBreakpoint', {
                eventName,
                targetName,
            });
            const breakpointId = `event_${++this.breakpointCounter}`;
            this.eventBreakpoints.set(breakpointId, {
                id: breakpointId,
                eventName,
                targetName,
                enabled: true,
                hitCount: 0,
                createdAt: Date.now(),
            });
            logger.info(`Event listener breakpoint set: ${eventName}`, { breakpointId, targetName });
            return breakpointId;
        }
        catch (error) {
            logger.error('Failed to set event listener breakpoint:', error);
            throw error;
        }
    }
    async removeEventListenerBreakpoint(breakpointId) {
        const breakpoint = this.eventBreakpoints.get(breakpointId);
        if (!breakpoint) {
            return false;
        }
        try {
            await this.cdpSession.send('DOMDebugger.removeEventListenerBreakpoint', {
                eventName: breakpoint.eventName,
                targetName: breakpoint.targetName,
            });
            this.eventBreakpoints.delete(breakpointId);
            logger.info(`Event listener breakpoint removed: ${breakpointId}`);
            return true;
        }
        catch (error) {
            logger.error('Failed to remove event listener breakpoint:', error);
            throw error;
        }
    }
    async setMouseEventBreakpoints() {
        const breakpointIds = [];
        for (const event of EventBreakpointManager.MOUSE_EVENTS) {
            const id = await this.setEventListenerBreakpoint(event);
            breakpointIds.push(id);
        }
        logger.info(`Set ${breakpointIds.length} mouse event breakpoints`);
        return breakpointIds;
    }
    async setKeyboardEventBreakpoints() {
        const breakpointIds = [];
        for (const event of EventBreakpointManager.KEYBOARD_EVENTS) {
            const id = await this.setEventListenerBreakpoint(event);
            breakpointIds.push(id);
        }
        logger.info(`Set ${breakpointIds.length} keyboard event breakpoints`);
        return breakpointIds;
    }
    async setTimerEventBreakpoints() {
        const breakpointIds = [];
        for (const event of EventBreakpointManager.TIMER_EVENTS) {
            const id = await this.setEventListenerBreakpoint(event);
            breakpointIds.push(id);
        }
        logger.info(`Set ${breakpointIds.length} timer event breakpoints`);
        return breakpointIds;
    }
    async setWebSocketEventBreakpoints() {
        const breakpointIds = [];
        for (const event of EventBreakpointManager.WEBSOCKET_EVENTS) {
            const id = await this.setEventListenerBreakpoint(event, 'WebSocket');
            breakpointIds.push(id);
        }
        logger.info(`Set ${breakpointIds.length} WebSocket event breakpoints`);
        return breakpointIds;
    }
    getAllEventBreakpoints() {
        return Array.from(this.eventBreakpoints.values());
    }
    getEventBreakpoint(breakpointId) {
        return this.eventBreakpoints.get(breakpointId);
    }
    async clearAllEventBreakpoints() {
        const breakpoints = Array.from(this.eventBreakpoints.values());
        for (const bp of breakpoints) {
            try {
                await this.cdpSession.send('DOMDebugger.removeEventListenerBreakpoint', {
                    eventName: bp.eventName,
                    targetName: bp.targetName,
                });
            }
            catch (error) {
                logger.warn(`Failed to remove event breakpoint ${bp.id}:`, error);
            }
        }
        this.eventBreakpoints.clear();
        logger.info('All event breakpoints cleared');
    }
    async close() {
        try {
            await this.clearAllEventBreakpoints();
            logger.info('EventBreakpointManager closed');
        }
        catch (error) {
            logger.error('Failed to close EventBreakpointManager:', error);
            throw error;
        }
    }
}
//# sourceMappingURL=EventBreakpointManager.js.map