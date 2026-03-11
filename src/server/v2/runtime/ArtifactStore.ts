// @ts-nocheck

let artifactCounter = 0;
function nextArtifactId() {
    artifactCounter += 1;
    return `art_${Date.now()}_${artifactCounter}`;
}
export class ArtifactStore {
    artifacts = new Map();
    create(kind, summary, data, sessionId) {
        const record = {
            id: nextArtifactId(),
            kind,
            summary,
            data,
            sessionId,
            createdAt: new Date().toISOString(),
        };
        this.artifacts.set(record.id, record);
        return record;
    }
    get(artifactId) {
        return this.artifacts.get(artifactId);
    }
    listBySession(sessionId) {
        return Array.from(this.artifacts.values()).filter((artifact) => artifact.sessionId === sessionId);
    }
    clearSession(sessionId) {
        for (const [artifactId, artifact] of this.artifacts.entries()) {
            if (artifact.sessionId === sessionId) {
                this.artifacts.delete(artifactId);
            }
        }
    }
}
//# sourceMappingURL=ArtifactStore.js.map