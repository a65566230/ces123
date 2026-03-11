import type { Browser, Page } from 'puppeteer';
export interface Config {
    llm: LLMConfig;
    puppeteer: PuppeteerConfig;
    mcp: MCPConfig;
    cache: CacheConfig;
    storage: StorageConfig;
    worker: WorkerConfig;
    llmCache: LLMCacheConfig;
    rateLimit: RateLimitConfig;
    performance: PerformanceConfig;
}
export interface LLMConfig {
    provider: 'openai' | 'anthropic';
    openai?: {
        apiKey: string;
        model: string;
        baseURL?: string;
    };
    anthropic?: {
        apiKey: string;
        model: string;
    };
}
export interface PuppeteerConfig {
    headless: boolean;
    timeout: number;
    args?: string[];
    viewport?: {
        width: number;
        height: number;
    };
    userAgent?: string;
    maxCollectedUrls?: number;
    maxFilesPerCollect?: number;
    maxTotalContentSize?: number;
    maxSingleFileSize?: number;
}
export interface MCPConfig {
    name: string;
    version: string;
}
export interface CacheConfig {
    enabled: boolean;
    dir: string;
    ttl: number;
}
export interface StorageConfig {
    path: string;
    cacheSize: number;
}
export interface WorkerConfig {
    maxWorkers: number;
    taskTimeoutMs: number;
}
export interface LLMCacheConfig {
    enabled: boolean;
    maxEntries: number;
    ttlSeconds: number;
}
export interface RateLimitConfig {
    maxCalls: number;
    windowMs: number;
}
export interface PerformanceConfig {
    maxConcurrentAnalysis: number;
    maxCodeSizeMB: number;
}
export interface CollectCodeOptions {
    url: string;
    depth?: number;
    timeout?: number;
    waitProfile?: 'interactive' | 'network-quiet' | 'spa' | 'streaming';
    includeInline?: boolean;
    includeExternal?: boolean;
    includeDynamic?: boolean;
    includeServiceWorker?: boolean;
    includeWebWorker?: boolean;
    filterRules?: string[];
    smartMode?: 'summary' | 'priority' | 'incremental' | 'full';
    compress?: boolean;
    streaming?: boolean;
    maxTotalSize?: number;
    maxFileSize?: number;
    priorities?: string[];
}
export interface CodeFile {
    url: string;
    content: string;
    size: number;
    type: 'inline' | 'external' | 'dynamic' | 'service-worker' | 'web-worker';
    loadTime?: number;
    metadata?: Record<string, unknown>;
}
export interface CollectCodeResult {
    files: CodeFile[];
    dependencies: DependencyGraph;
    totalSize: number;
    collectTime: number;
    summaries?: Array<{
        url: string;
        size: number;
        type: string;
        hasEncryption: boolean;
        hasAPI: boolean;
        hasObfuscation: boolean;
        functions: string[];
        imports: string[];
        preview: string;
    }>;
}
export interface DependencyGraph {
    nodes: DependencyNode[];
    edges: DependencyEdge[];
}
export interface DependencyNode {
    id: string;
    url: string;
    type: string;
}
export interface DependencyEdge {
    from: string;
    to: string;
    type: 'import' | 'require' | 'script';
}
export interface DeobfuscateOptions {
    code: string;
    llm?: 'gpt-4' | 'claude';
    aggressive?: boolean;
    preserveLogic?: boolean;
    renameVariables?: boolean;
    inlineFunctions?: boolean;
}
export interface DeobfuscateResult {
    code: string;
    readabilityScore: number;
    confidence: number;
    obfuscationType: ObfuscationType[];
    transformations: Transformation[];
    analysis: string;
}
export type ObfuscationType = 'javascript-obfuscator' | 'webpack' | 'uglify' | 'vm-protection' | 'self-modifying' | 'invisible-unicode' | 'control-flow-flattening' | 'string-array-rotation' | 'dead-code-injection' | 'opaque-predicates' | 'jsfuck' | 'aaencode' | 'jjencode' | 'packer' | 'eval-obfuscation' | 'base64-encoding' | 'hex-encoding' | 'jscrambler' | 'urlencoded' | 'custom' | 'unknown';
export interface Transformation {
    type: string;
    description: string;
    success: boolean;
}
export interface UnderstandCodeOptions {
    code: string;
    context?: Record<string, unknown>;
    focus?: 'structure' | 'business' | 'security' | 'all';
}
export interface UnderstandCodeResult {
    structure: CodeStructure;
    techStack: TechStack;
    businessLogic: BusinessLogic;
    dataFlow: DataFlow;
    securityRisks: SecurityRisk[];
    qualityScore: number;
    codePatterns?: Array<{
        name: string;
        location: number;
        description: string;
    }>;
    antiPatterns?: Array<{
        name: string;
        location: number;
        severity: string;
        recommendation: string;
    }>;
    complexityMetrics?: {
        cyclomaticComplexity: number;
        cognitiveComplexity: number;
        maintainabilityIndex: number;
        halsteadMetrics: {
            vocabulary: number;
            length: number;
            difficulty: number;
            effort: number;
        };
    };
}
export interface CodeStructure {
    functions: FunctionInfo[];
    classes: ClassInfo[];
    modules: ModuleInfo[];
    callGraph: CallGraph;
}
export interface FunctionInfo {
    name: string;
    params: string[];
    returnType?: string;
    location: CodeLocation;
    complexity: number;
}
export interface ClassInfo {
    name: string;
    methods: FunctionInfo[];
    properties: PropertyInfo[];
    location: CodeLocation;
}
export interface PropertyInfo {
    name: string;
    type?: string;
    value?: unknown;
}
export interface ModuleInfo {
    name: string;
    exports: string[];
    imports: string[];
}
export interface CallGraph {
    nodes: CallGraphNode[];
    edges: CallGraphEdge[];
}
export interface CallGraphNode {
    id: string;
    name: string;
    type: 'function' | 'method' | 'constructor';
}
export interface CallGraphEdge {
    from: string;
    to: string;
    callCount?: number;
}
export interface TechStack {
    framework?: string;
    bundler?: string;
    uiLibrary?: string;
    stateManagement?: string;
    cryptoLibrary?: string[];
    other: string[];
}
export interface BusinessLogic {
    mainFeatures: string[];
    entities: string[];
    rules: string[];
    dataModel: Record<string, unknown>;
}
export interface DataFlow {
    graph: DataFlowGraph;
    sources: DataSource[];
    sinks: DataSink[];
    taintPaths: TaintPath[];
}
export interface DataFlowGraph {
    nodes: DataFlowNode[];
    edges: DataFlowEdge[];
}
export interface DataFlowNode {
    id: string;
    type: 'source' | 'sink' | 'transform';
    name: string;
    location: CodeLocation;
}
export interface DataFlowEdge {
    from: string;
    to: string;
    data: string;
}
export interface DataSource {
    type: 'user_input' | 'storage' | 'network' | 'other';
    location: CodeLocation;
}
export interface DataSink {
    type: 'dom' | 'network' | 'storage' | 'eval' | 'xss' | 'sql-injection' | 'other';
    location: CodeLocation;
}
export interface TaintPath {
    source: DataSource;
    sink: DataSink;
    path: CodeLocation[];
    risk?: 'high' | 'medium' | 'low';
}
export interface SecurityRisk {
    type: 'xss' | 'sql-injection' | 'csrf' | 'sensitive-data' | 'other';
    severity: 'critical' | 'high' | 'medium' | 'low';
    location: CodeLocation;
    description: string;
    recommendation: string;
}
export interface CodeLocation {
    file: string;
    line: number;
    column?: number;
}
export interface DetectCryptoOptions {
    code: string;
    testData?: unknown;
}
export interface DetectCryptoResult {
    algorithms: CryptoAlgorithm[];
    libraries: CryptoLibrary[];
    confidence: number;
}
export interface CryptoAlgorithm {
    name: string;
    type: 'symmetric' | 'asymmetric' | 'hash' | 'encoding';
    confidence: number;
    location: CodeLocation;
    parameters?: CryptoParameters;
    usage: string;
}
export interface CryptoParameters {
    key?: string;
    iv?: string;
    mode?: string;
    padding?: string;
}
export interface CryptoLibrary {
    name: string;
    version?: string;
    confidence: number;
}
export interface HookOptions {
    target: string;
    type: 'function' | 'xhr' | 'fetch' | 'websocket' | 'localstorage' | 'cookie' | 'eval' | 'object-method';
    action?: 'log' | 'block' | 'modify';
    customCode?: string;
    condition?: HookCondition;
    performance?: boolean;
    regex?: boolean;
}
export interface HookCondition {
    argumentFilter?: (args: unknown[]) => boolean;
    returnFilter?: (result: unknown) => boolean;
    maxCalls?: number;
    minInterval?: number;
}
export interface HookCondition {
    params?: unknown[];
    returnValue?: unknown;
    callCount?: number;
}
export type HookHandler = (context: HookContext) => void | Promise<void>;
export interface HookContext {
    target: string;
    args: unknown[];
    returnValue?: unknown;
    callStack: CallStackFrame[];
    timestamp: number;
}
export interface CallStackFrame {
    functionName: string;
    fileName: string;
    lineNumber: number;
    columnNumber: number;
}
export interface HookResult {
    hookId: string;
    script: string;
    instructions: string;
}
export interface HookRecord {
    hookId: string;
    timestamp: number;
    context: HookContext;
}
export interface BrowserContext {
    browser: Browser;
    page: Page;
    url: string;
}
export interface Result<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}
export interface Session {
    id: string;
    url: string;
    createdAt: number;
    updatedAt: number;
    data: SessionData;
}
export interface SessionData {
    code?: CollectCodeResult;
    deobfuscated?: DeobfuscateResult;
    analysis?: UnderstandCodeResult;
    crypto?: DetectCryptoResult;
    hooks?: HookRecord[];
}
export interface DetectedEnvironmentVariables {
    window: string[];
    document: string[];
    navigator: string[];
    location: string[];
    screen: string[];
    other: string[];
}
export interface MissingAPI {
    name: string;
    type: 'function' | 'object' | 'property';
    path: string;
    suggestion: string;
}
export interface EmulationCode {
    nodejs: string;
    python: string;
}
export interface EnvironmentEmulatorOptions {
    code: string;
    targetRuntime?: 'nodejs' | 'python' | 'both';
    autoFetch?: boolean;
    browserUrl?: string;
    browserType?: 'chrome' | 'firefox' | 'safari';
    includeComments?: boolean;
    extractDepth?: number;
    useAI?: boolean;
}
export interface EnvironmentEmulatorResult {
    detectedVariables: DetectedEnvironmentVariables;
    emulationCode: EmulationCode;
    missingAPIs: MissingAPI[];
    variableManifest: Record<string, any>;
    recommendations: string[];
    stats: {
        totalVariables: number;
        autoFilledVariables: number;
        manualRequiredVariables: number;
    };
    aiAnalysis?: any;
}
export type VMType = 'custom' | 'obfuscator.io' | 'jsfuck' | 'jjencode' | 'unknown';
export type InstructionType = 'load' | 'store' | 'arithmetic' | 'control' | 'call' | 'unknown';
export type ComplexityLevel = 'low' | 'medium' | 'high';
export interface VMInstruction {
    opcode: number | string;
    name: string;
    type: InstructionType;
    description: string;
    args?: number;
}
export interface VMFeatures {
    instructionCount: number;
    interpreterLocation: string;
    complexity: ComplexityLevel;
    hasSwitch: boolean;
    hasInstructionArray: boolean;
    hasProgramCounter: boolean;
}
export interface UnresolvedPart {
    location: string;
    reason: string;
    suggestion?: string;
}
export interface JSVMPDeobfuscatorOptions {
    code: string;
    aggressive?: boolean;
    extractInstructions?: boolean;
    timeout?: number;
    maxIterations?: number;
}
export interface JSVMPDeobfuscatorResult {
    isJSVMP: boolean;
    vmType?: VMType;
    vmFeatures?: VMFeatures;
    instructions?: VMInstruction[];
    deobfuscatedCode: string;
    confidence: number;
    warnings: string[];
    unresolvedParts?: UnresolvedPart[];
    stats?: {
        originalSize: number;
        deobfuscatedSize: number;
        reductionRate: number;
        processingTime: number;
    };
}
export interface ScopeVariable {
    name: string;
    value: any;
    type: string;
    scope: 'global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module';
    writable?: boolean;
    configurable?: boolean;
    enumerable?: boolean;
    objectId?: string;
}
export interface BreakpointHitEvent {
    breakpointId: string;
    breakpointInfo?: any;
    location: {
        scriptId: string;
        lineNumber: number;
        columnNumber: number;
        url?: string;
    };
    callFrames: any[];
    timestamp: number;
    variables?: ScopeVariable[];
    reason: string;
}
export type BreakpointHitCallback = (event: BreakpointHitEvent) => void | Promise<void>;
export interface DebuggerSession {
    version: string;
    timestamp: number;
    breakpoints: Array<{
        location: {
            scriptId?: string;
            url?: string;
            lineNumber: number;
            columnNumber?: number;
        };
        condition?: string;
        enabled: boolean;
    }>;
    pauseOnExceptions: 'none' | 'uncaught' | 'all';
    metadata?: {
        url?: string;
        description?: string;
        tags?: string[];
        [key: string]: any;
    };
}
export interface GetScopeVariablesOptions {
    callFrameId?: string;
    includeObjectProperties?: boolean;
    maxDepth?: number;
    skipErrors?: boolean;
}
export interface GetScopeVariablesResult {
    success: boolean;
    variables: ScopeVariable[];
    callFrameId: string;
    callFrameInfo?: {
        functionName: string;
        location: string;
    };
    errors?: Array<{
        scope: string;
        error: string;
    }>;
    totalScopes: number;
    successfulScopes: number;
}
declare global {
    interface Window {
        __aiHooks?: Record<string, any[]>;
        __aiHookMetadata?: Record<string, {
            id: string;
            createdAt: number;
            enabled: boolean;
        }>;
    }
}
//# sourceMappingURL=index.d.ts.map
