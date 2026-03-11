// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class StreamingCollector {
    DEFAULT_CHUNK_SIZE = 100 * 1024;
    DEFAULT_MAX_CHUNKS = 50;
    async *streamFile(file, options = {}) {
        const chunkSize = options.chunkSize || this.DEFAULT_CHUNK_SIZE;
        const maxChunks = options.maxChunks || this.DEFAULT_MAX_CHUNKS;
        const content = file.content;
        const totalSize = content.length;
        const totalChunks = Math.min(Math.ceil(totalSize / chunkSize), maxChunks);
        logger.debug(`Streaming file: ${file.url} (${totalChunks} chunks)`);
        for (let i = 0; i < totalChunks; i++) {
            const offset = i * chunkSize;
            const chunk = content.substring(offset, offset + chunkSize);
            yield {
                chunkIndex: i,
                totalChunks,
                url: file.url,
                content: chunk,
                isLast: i === totalChunks - 1,
                metadata: {
                    fileSize: totalSize,
                    chunkSize: chunk.length,
                    offset,
                },
            };
        }
    }
    async *streamFiles(files, options = {}) {
        for (const file of files) {
            for await (const chunk of this.streamFile(file, options)) {
                yield chunk;
            }
        }
    }
    async collectStream(stream) {
        const files = new Map();
        for await (const chunk of stream) {
            if (!files.has(chunk.url)) {
                files.set(chunk.url, []);
            }
            files.get(chunk.url).push(chunk.content);
        }
        const result = new Map();
        for (const [url, chunks] of files.entries()) {
            result.set(url, chunks.join(''));
        }
        return result;
    }
    async *streamByPriority(files, priorities, options = {}) {
        const scored = files.map(file => ({
            file,
            score: this.calculatePriority(file, priorities),
        }));
        scored.sort((a, b) => b.score - a.score);
        for (const { file } of scored) {
            for await (const chunk of this.streamFile(file, options)) {
                yield chunk;
            }
        }
    }
    calculatePriority(file, priorities) {
        let score = 0;
        for (let i = 0; i < priorities.length; i++) {
            const pattern = priorities[i];
            if (pattern && new RegExp(pattern, 'i').test(file.url)) {
                score += (priorities.length - i) * 10;
            }
        }
        if (/encrypt|crypto|cipher/i.test(file.content))
            score += 50;
        if (/fetch|xhr|ajax/i.test(file.content))
            score += 30;
        return score;
    }
    async *streamCompressed(files, options = {}) {
        for await (const chunk of this.streamFiles(files, options)) {
            if (chunk.content.length > 10 * 1024) {
                yield {
                    chunk,
                    compressed: false,
                };
            }
            else {
                yield {
                    chunk,
                    compressed: false,
                };
            }
        }
    }
    async *streamFiltered(files, filter, options = {}) {
        const filtered = files.filter(filter);
        for await (const chunk of this.streamFiles(filtered, options)) {
            yield chunk;
        }
    }
    async *streamSummaries(files) {
        for (const file of files) {
            const preview = file.content.substring(0, 500);
            yield {
                url: file.url,
                size: file.size,
                type: file.type,
                preview,
                hasEncryption: /encrypt|crypto|cipher/i.test(file.content),
                hasAPI: /fetch|xhr|ajax|request/i.test(file.content),
            };
        }
    }
    async getStreamStats(stream) {
        let totalChunks = 0;
        let totalSize = 0;
        const urls = new Set();
        for await (const chunk of stream) {
            totalChunks++;
            totalSize += chunk.content.length;
            urls.add(chunk.url);
        }
        return {
            totalChunks,
            totalSize,
            files: urls.size,
        };
    }
}
//# sourceMappingURL=StreamingCollector.js.map