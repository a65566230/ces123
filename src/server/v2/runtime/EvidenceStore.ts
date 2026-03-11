// @ts-nocheck

let evidenceCounter = 0;
function nextEvidenceId() {
    evidenceCounter += 1;
    return `evd_${Date.now()}_${evidenceCounter}`;
}
export class EvidenceStore {
    evidence = new Map();
    create(kind, summary, data, sessionId) {
        const record = {
            id: nextEvidenceId(),
            kind,
            summary,
            data,
            sessionId,
            createdAt: new Date().toISOString(),
        };
        this.evidence.set(record.id, record);
        return record;
    }
    get(evidenceId) {
        return this.evidence.get(evidenceId);
    }
    listBySession(sessionId) {
        return Array.from(this.evidence.values()).filter((item) => item.sessionId === sessionId);
    }
    clearSession(sessionId) {
        for (const [evidenceId, item] of this.evidence.entries()) {
            if (item.sessionId === sessionId) {
                this.evidence.delete(evidenceId);
            }
        }
    }
}
//# sourceMappingURL=EvidenceStore.js.map