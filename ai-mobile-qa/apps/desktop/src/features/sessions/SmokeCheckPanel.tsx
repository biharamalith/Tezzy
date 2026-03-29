import { useState, useEffect, useRef } from "react";
import {
    invokeRunSmokeCheck,
    invokeStopSmokeCheck,
    invokeGetUiSnapshot,
    invokeActionTap,
    invokeActionBack,
    invokeActionInput,
    invokeActionSwipe,
    invokeActionScreenshot,
    invokeAiVisionScreenshot,
    listenRunProgress,
    RunProgressEvent,
    SmokeCheckResult,
    SmokeFinding,
    SmokeStepRecord,
    AiErroredScreenRecord,
    invokeWriteAiErroredScreensReport,
    UnlistenFn,
} from "../../lib/tauri";

import { aiRunStep } from "../../lib/aiEngine";
import type { ActionRecord, ScenarioExecutionState, GoalProgress } from "../../types/scenario";
import {
    saveExecutionState,
    deleteExecutionState,
    listIncompleteRuns,
    getIncompleteRunMetadata,
} from "../../lib/executionStatePersistence";
import {
    checkMaxStepsPerGoal,
    checkTimeout,
    shouldStopOnFailure,
    formatConstraintViolation,
    createConstraintViolationFinding,
} from "../../lib/scenarioConstraints";

const accent = "#9D7BFF";
const warn = "#E3B341";
const error = "#F85149";
const success = "#3FB950";

// ── helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
    if (status === "running") return accent;
    if (status === "warn") return warn;
    if (status === "error" || status === "crash") return error;
    if (status === "done" || status === "complete") return success;
    if (status === "stopped") return "#8B949E";
    return "#8B949E";
}

function resultIcon(status: string): string {
    if (status === "ok") return "✓";
    if (status === "dead_tap") return "○";
    if (status === "loop") return "↻";
    if (status === "crash") return "✕";
    if (status === "stopped") return "■";
    if (status === "warn") return "△";
    return "•";
}

function findingIcon(severity: string): string {
    if (severity === "error") return "●";
    if (severity === "warn") return "▲";
    return "ℹ";
}

function findingColor(severity: string): string {
    if (severity === "error") return error;
    if (severity === "warn") return warn;
    return accent;
}

function toFiniteNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function readElementCenter(el: any): { x: number; y: number } | null {
    const x = toFiniteNumber(el?.center_x ?? el?.x ?? el?.bounds_center_x);
    const y = toFiniteNumber(el?.center_y ?? el?.y ?? el?.bounds_center_y);
    if (x === null || y === null) return null;
    return { x, y };
}

function pickElementByKeywords(
    elements: Array<any>,
    keywords: string[],
    opts?: { minY?: number },
): { x: number; y: number } | null {
    const minY = opts?.minY ?? 0;
    const scoreMatch = (el: any): number => {
        const text = [el?.text, el?.content_desc, el?.resource_id, el?.class, el?.hint]
            .map((v) => String(v ?? "").toLowerCase())
            .join(" ");
        let score = 0;
        for (const key of keywords) {
            if (text.includes(key)) score += 1;
        }
        if (String(el?.clickable ?? "").toLowerCase() === "true") score += 0.5;
        return score;
    };

    let best: { x: number; y: number; score: number } | null = null;
    for (const el of elements) {
        const center = readElementCenter(el);
        if (!center) continue;
        if (center.y < minY) continue;
        const score = scoreMatch(el);
        if (score <= 0) continue;
        if (!best || score > best.score) {
            best = { x: center.x, y: center.y, score };
        }
    }
    if (!best) return null;
    return { x: best.x, y: best.y };
}

function isLowValueAiAction(action: any): boolean {
    const t = String(action?.type ?? "");
    if (!t) return true;
    if (t === "wait_ms" || t === "screenshot") return true;
    if (t === "swipe") {
        const dir = String(action?.params?.direction ?? "").toLowerCase();
        // In repeated loops, generic upward swipes are often no-progress actions.
        if (dir === "up") return true;
    }
    return false;
}

function isSwipeAction(action: any): boolean {
    return String(action?.type ?? "") === "swipe";
}

function trailingSwipeCount(actions: Array<Record<string, unknown>>): number {
    let count = 0;
    for (let i = actions.length - 1; i >= 0; i -= 1) {
        const t = String((actions[i] as any)?.type ?? "");
        if (t !== "swipe") break;
        count += 1;
    }
    return count;
}

function pickTapFirstTarget(
    elements: Array<any>,
    screenSize?: { width: number; height: number },
): { x: number; y: number } | null {
    const h = Math.max(640, Number(screenSize?.height ?? 1920));

    // Prefer obviously actionable controls first.
    const highPriority = pickElementByKeywords(
        elements,
        [
            "continue",
            "next",
            "ok",
            "allow",
            "open",
            "menu",
            "home",
            "search",
            "profile",
            "settings",
            "explore",
            "discover",
            "shop",
            "category",
            "tab",
        ],
        { minY: Math.floor(h * 0.08) },
    );
    if (highPriority) return highPriority;

    const norm = (v: unknown) => String(v ?? "").toLowerCase();
    for (const el of elements) {
        const center = readElementCenter(el);
        if (!center) continue;
        const clickable = norm(el?.clickable) === "true";
        const cls = `${norm(el?.class)} ${norm(el?.class_full)}`;
        const txt = `${norm(el?.text)} ${norm(el?.content_desc)} ${norm(el?.resource_id)}`;
        if (!clickable) continue;
        if (center.y < Math.floor(h * 0.08)) continue;
        if (cls.includes("edittext") || cls.includes("textfield")) continue;
        if (!txt.trim()) continue;
        return { x: Math.floor(center.x), y: Math.floor(center.y) };
    }
    return null;
}

function buildNavigationRecoveryAction(
    step: number,
    sameHashCount: number,
    uiElements: Array<any>,
    screenSize?: { width: number; height: number },
): { type: string; params: Record<string, unknown> } | null {
    if (sameHashCount < 2) return null;

    const w = Math.max(320, Number(screenSize?.width ?? 1080));
    const h = Math.max(640, Number(screenSize?.height ?? 1920));
    const minBottomY = Math.floor(h * 0.76);

    const drawerTarget = pickElementByKeywords(
        uiElements,
        ["menu", "drawer", "navigation", "hamburger", "open navigation"],
        { minY: 0 },
    );
    const bottomNavTarget = pickElementByKeywords(
        uiElements,
        [
            "home",
            "search",
            "discover",
            "explore",
            "profile",
            "account",
            "orders",
            "settings",
            "cart",
            "wishlist",
            "me",
        ],
        { minY: minBottomY },
    );

    const phase = step % 4;
    if (phase === 0 && drawerTarget) {
        return { type: "tap_xy", params: { x: Math.floor(drawerTarget.x), y: Math.floor(drawerTarget.y) } };
    }
    if (phase === 1 && bottomNavTarget) {
        return { type: "tap_xy", params: { x: Math.floor(bottomNavTarget.x), y: Math.floor(bottomNavTarget.y) } };
    }

    // Keep swipe-based drawer open as last resort only when clearly stuck.
    if (phase === 0 && sameHashCount >= 4) {
        return {
            type: "swipe",
            params: {
                x1: Math.floor(w * 0.04),
                y1: Math.floor(h * 0.55),
                x2: Math.floor(w * 0.72),
                y2: Math.floor(h * 0.55),
                duration_ms: 320,
            },
        };
    }

    const lane = phase === 2 ? 0.5 : phase === 3 ? 0.8 : 0.2;
    return {
        type: "tap_xy",
        params: {
            x: Math.floor(w * lane),
            y: Math.floor(h * 0.92),
        },
    };
}

const OVERFLOW_MATCHERS = [
    "a renderflex overflowed",
    "renderflex overflowed",
    "overflowed by",
    "bottom overflowed",
    "right overflowed",
    "left overflowed",
    "top overflowed",
    "overflow",
];

function textMentionsOverflow(value: unknown): boolean {
    const lower = String(value ?? "").toLowerCase();
    if (!lower) return false;
    return OVERFLOW_MATCHERS.some((token) => lower.includes(token));
}

function detectAiOverflowSignal(aiOut: any): { detected: boolean; evidence: string[] } {
    const evidence: string[] = [];
    const pushEvidence = (value: unknown) => {
        const text = String(value ?? "").trim();
        if (!text) return;
        if (!textMentionsOverflow(text)) return;
        if (evidence.includes(text)) return;
        evidence.push(text);
    };

    const blockerFlags = Array.isArray(aiOut?.analysis?.blocker_flags)
        ? aiOut.analysis.blocker_flags
        : [];
    for (const flag of blockerFlags) {
        pushEvidence(flag);
        if (evidence.length >= 5) break;
    }

    const triage = aiOut?.triage;
    const findings = Array.isArray(triage?.deduped_findings)
        ? triage.deduped_findings
        : Array.isArray(triage?.new_findings)
            ? triage.new_findings
            : [];

    for (const finding of findings) {
        if (!finding || typeof finding !== "object") continue;
        const fields = [
            finding.kind,
            finding.issue,
            finding.type,
            finding.category,
            finding.code,
            finding.title,
            finding.message,
            finding.reason,
            finding.summary,
        ];
        for (const field of fields) {
            pushEvidence(field);
            if (evidence.length >= 5) break;
        }

        const evidenceList = Array.isArray(finding.evidence) ? finding.evidence : [];
        for (const item of evidenceList) {
            pushEvidence(item);
            if (evidence.length >= 5) break;
        }

        if (evidence.length >= 5) break;
    }

    return { detected: evidence.length > 0, evidence };
}

function detectFlutterOverflowFromElements(
    elements: Array<any>,
): { detected: boolean; issue: string; evidence: string[] } {
    const evidence: string[] = [];
    for (const el of elements) {
        const textBits = [
            el?.text,
            el?.content_desc,
            el?.resource_id,
            el?.hint,
            el?.label,
            el?.name,
            el?.description,
            el?.class,
            el?.class_full,
        ]
            .map((v) => String(v ?? "").trim())
            .filter(Boolean);
        if (textBits.length === 0) continue;

        const joined = textBits.join(" | ");
        if (textMentionsOverflow(joined)) {
            evidence.push(joined);
            if (evidence.length >= 3) break;
        }
    }

    return {
        detected: evidence.length > 0,
        issue: "flutter_renderflex_overflow",
        evidence,
    };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function SmokeCheckPanel() {
    const [running, setRunning] = useState(false);
    const [maxSteps, setMaxSteps] = useState(20);
    const [delayMs, setDelayMs] = useState(1500);
    const [timeoutSeconds, setTimeoutSeconds] = useState(300); // 5 minutes default
    const [progress, setProgress] = useState<RunProgressEvent[]>([]);
    const [result, setResult] = useState<SmokeCheckResult | null>(null);
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const [incompleteRuns, setIncompleteRuns] = useState<Array<{
        run_id: string;
        scenario_name: string;
        scenario_id: string;
        current_goal_index: number;
        total_goals: number;
        goals_completed: number;
        goals_failed: number;
        started_at: number;
        elapsed_seconds: number;
    }>>([]);
    const feedRef = useRef<HTMLDivElement>(null);
    const unlistenRef = useRef<UnlistenFn | undefined>(undefined);
    const stopRequestedRef = useRef(false);
    const seenElementKeys = useRef<string[]>([]);
    const loopCount = useRef<number>(0);
    const lastScreenHash = useRef<string | null>(null);
    const noElementCount = useRef<number>(0);
    const completedScreens = useRef<Set<string>>(new Set());
    const recentActionsRef = useRef<ActionRecord[]>([]);

    function sleep(ms: number) {
        return new Promise<void>((resolve) => setTimeout(resolve, ms));
    }

    function pickLikelyTextField(
        elements: Array<any>,
        fieldHint: string | null,
        textBeingTyped: string = "",
    ): { x: number; y: number } | null {
        let hint = (fieldHint ?? "").trim().toLowerCase();

        // Auto-guess hint based on text content to distinguish email vs password fields
        if (!hint && textBeingTyped) {
            const lowerText = textBeingTyped.toLowerCase();
            if (lowerText.includes("@")) {
                hint = "email";
            } else if (lowerText === "123456" || lowerText.includes("pass")) {
                hint = "password";
            }
        }

        const norm = (s: any) => String(s ?? "").toLowerCase();
        const isEdit = (el: any) => {
            const c = norm(el.class);
            const cf = norm(el.class_full);
            return c.includes("edittext") || cf.includes("edittext") || c.includes("textfield") || cf.includes("textfield");
        };
        const matchesHint = (el: any) => {
            if (!hint) return true;
            return (
                norm(el.resource_id).includes(hint) ||
                norm(el.content_desc).includes(hint) ||
                norm(el.text).includes(hint) ||
                norm(el.hint).includes(hint)
            );
        };

        const editFields = elements
            .filter((el) => el && typeof el === "object")
            .filter((el) => isEdit(el));

        const candidates = editFields.filter((el) => matchesHint(el));

        let best = candidates[0];
        // Fallback: If looking for password and missed, assume 2nd text field is password
        if (!best && hint.includes("password") && editFields.length >= 2) {
            best = editFields[1];
        } else if (!best) {
            best = editFields[0];
        }

        if (!best) return null;
        const x = Number(best.center_x);
        const y = Number(best.center_y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    async function executeAiAction(
        action: any,
        ctx?: { ui_elements?: any[], screen_size?: { width: number, height: number } },
    ): Promise<{ actionLabel: string; resultStatus: string }> {
        const type = String(action?.type ?? "");
        const params = (action?.params ?? {}) as Record<string, any>;

        if (type === "tap_xy") {
            const x = Number(params.x ?? params.center_x ?? params.cx);
            const y = Number(params.y ?? params.center_y ?? params.cy);
            await invokeActionTap(x, y);
            return { actionLabel: `tap_xy(${x},${y})`, resultStatus: "ok" };
        }
        if (type === "back") {
            await invokeActionBack();
            return { actionLabel: "back", resultStatus: "ok" };
        }
        if (type === "input_text") {
            const text = String(params.text ?? "");
            const uiElements = ctx?.ui_elements ?? [];
            const fieldHint = params.field ? String(params.field) : null;

            // Best-effort: focus a likely text field before typing.
            const target = pickLikelyTextField(uiElements, fieldHint, text);
            if (target) {
                try {
                    await invokeActionTap(target.x, target.y);
                    await sleep(150);
                } catch {
                    // ignore and try typing anyway
                }
            }

            try {
                await invokeActionInput(text);
                return { actionLabel: `input_text`, resultStatus: "ok" };
            } catch (err) {
                const msg = String(err);
                // If nothing was focused, Appium may fail with "no such element".
                // Retry once after tapping the first EditText we can find.
                if (msg.toLowerCase().includes("no such element") && !target) {
                    const retryTarget = pickLikelyTextField(uiElements, null, text);
                    if (retryTarget) {
                        await invokeActionTap(retryTarget.x, retryTarget.y);
                        await sleep(150);
                        await invokeActionInput(text);
                        return { actionLabel: `input_text(retry)`, resultStatus: "ok" };
                    }
                }
                throw err;
            }
        }
        if (type === "swipe") {
            let x1 = Number(params.x1 ?? params.start_x);
            let y1 = Number(params.y1 ?? params.start_y);
            let x2 = Number(params.x2 ?? params.end_x);
            let y2 = Number(params.y2 ?? params.end_y);
            const durationMs = Number(params.durationMs ?? params.duration_ms ?? 300);

            // Handle direction-based swipes
            const dir = String(params.direction ?? "").toLowerCase();
            const w = ctx?.screen_size?.width ?? 1080;
            const h = ctx?.screen_size?.height ?? 1920;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            if (dir === "up") {
                x1 = cx; y1 = Math.floor(h * 0.8);
                x2 = cx; y2 = Math.floor(h * 0.2);
            } else if (dir === "down") {
                x1 = cx; y1 = Math.floor(h * 0.2);
                x2 = cx; y2 = Math.floor(h * 0.8);
            } else if (dir === "left") {
                x1 = Math.floor(w * 0.8); y1 = cy;
                x2 = Math.floor(w * 0.2); y2 = cy;
            } else if (dir === "right") {
                x1 = Math.floor(w * 0.2); y1 = cy;
                x2 = Math.floor(w * 0.8); y2 = cy;
            }

            if (Number.isNaN(x1)) x1 = cx;
            if (Number.isNaN(y1)) y1 = Math.floor(h * 0.8);
            if (Number.isNaN(x2)) x2 = cx;
            if (Number.isNaN(y2)) y2 = Math.floor(h * 0.2);

            await invokeActionSwipe(x1, y1, x2, y2, durationMs);
            return { actionLabel: `swipe(${x1},${y1}→${x2},${y2})`, resultStatus: "ok" };
        }
        if (type === "wait_ms") {
            const ms = Number(params.ms ?? params.wait_ms ?? params.duration_ms ?? 1000);
            await sleep(ms);
            return { actionLabel: `wait_ms(${ms})`, resultStatus: "ok" };
        }
        if (type === "screenshot") {
            await invokeActionScreenshot();
            return { actionLabel: "screenshot", resultStatus: "ok" };
        }
        if (type === "stop") {
            return { actionLabel: "stop", resultStatus: "stopped" };
        }

        // Unknown action type
        return { actionLabel: `unknown:${type || "(missing)"}`, resultStatus: "warn" };
    }

    // Auto-scroll the step feed to the bottom
    useEffect(() => {
        const feed = feedRef.current;
        if (feed) feed.scrollTop = feed.scrollHeight;
    }, [progress]);

    // Clean up listener on unmount
    useEffect(() => {
        return () => { unlistenRef.current?.(); };
    }, []);

    // ── Detect incomplete runs on startup (Requirement 30.3, 30.4) ──
    useEffect(() => {
        const detectIncompleteRuns = async () => {
            try {
                const runIds = await listIncompleteRuns();
                
                if (runIds.length === 0) {
                    console.log("No incomplete runs detected");
                    return;
                }

                console.log(`Detected ${runIds.length} incomplete run(s):`, runIds);

                // Get metadata for each incomplete run
                const incompleteRunsMetadata = [];
                for (const runId of runIds) {
                    const metadata = await getIncompleteRunMetadata(runId);
                    if (metadata) {
                        incompleteRunsMetadata.push(metadata);
                    }
                }

                // Store incomplete run info for UI (Phase 3 will use this)
                setIncompleteRuns(incompleteRunsMetadata);

                // Log summary for debugging
                if (incompleteRunsMetadata.length > 0) {
                    console.log("Incomplete runs available for resume:");
                    incompleteRunsMetadata.forEach(run => {
                        console.log(`  - ${run.scenario_name} (${run.run_id})`);
                        console.log(`    Progress: ${run.goals_completed}/${run.total_goals} goals completed`);
                        console.log(`    Elapsed: ${run.elapsed_seconds}s`);
                    });
                }
            } catch (error) {
                console.error("Failed to detect incomplete runs:", error);
                // Non-critical error, don't show to user
            }
        };

        detectIncompleteRuns();
    }, []); // Run once on mount

    const handleStart = async () => {
        setRunning(true);
        setProgress([]);
        setResult(null);
        setErrMsg(null);
        stopRequestedRef.current = false;

        // Subscribe to per-step events
        unlistenRef.current?.();
        unlistenRef.current = await listenRunProgress((evt) => {
            setProgress((prev) => [...prev, evt]);
        });

        try {
            const res = await invokeRunSmokeCheck(maxSteps, delayMs);
            setResult(res);
        } catch (err) {
            setErrMsg(String(err));
        } finally {
            unlistenRef.current?.();
            unlistenRef.current = undefined;
            setRunning(false);
        }
    };

    const handleStartAi = async () => {
        setRunning(true);
        setProgress([]);
        setResult(null);
        setErrMsg(null);
        stopRequestedRef.current = false;
        
        // Reset seen element keys for new run
        seenElementKeys.current = [];
        
        // Reset loop tracking for new run
        loopCount.current = 0;
        lastScreenHash.current = null;
        
        // Reset no element count for new run
        noElementCount.current = 0;
        
        // Reset completed screens for new run
        completedScreens.current = new Set();
        
        // Reset recent actions for new run
        recentActionsRef.current = [];

        // No Rust-emitted run_progress stream for this path.
        unlistenRef.current?.();
        unlistenRef.current = undefined;

        const runId = `ai-${Date.now()}`;
        const scenarioStartTime = Date.now(); // Track start time for timeout constraint
        const findings: SmokeFinding[] = [];
        const steps: SmokeStepRecord[] = [];
        const erroredScreens: AiErroredScreenRecord[] = [];
        const seenHashCounts: Record<string, number> = {};
        const reportedErrorScreenKeys = new Set<string>();

        let lastAction: Record<string, unknown> | null = null;
        let lastResult: string | null = null;
        let failureStreak = 0;
        let triageFindings: Array<Record<string, unknown>> = [];

        try {
            for (let step = 1; step <= maxSteps; step++) {
                if (stopRequestedRef.current) {
                    break;
                }

                // ── Check timeout constraint before each step ──
                const timeoutResult = checkTimeout(scenarioStartTime, timeoutSeconds);
                if (timeoutResult.violated) {
                    const violationMsg = formatConstraintViolation(timeoutResult);
                    console.warn(violationMsg);
                    findings.push({
                        step,
                        severity: "error",
                        message: timeoutResult.message || "Timeout exceeded",
                    });
                    steps.push({
                        step_num: step,
                        action: "timeout",
                        result_status: "stopped",
                        screenshot: null,
                    });
                    setProgress((prev) => [
                        ...prev,
                        { step, total: maxSteps, action: "timeout", status: "error", screenshot: null },
                    ]);
                    break;
                }

                const snap = await invokeGetUiSnapshot();
                const hash = snap.screen_hash;
                seenHashCounts[hash] = (seenHashCounts[hash] ?? 0) + 1;

                // ── Vision screenshot: capture screen + run vision analysis ──────
                let stepScreenshotPath: string | null = null;
                let screenshotSummary: string | null = null;
                let screenshotB64: string | null = null;

                try {
                    const vs = await invokeAiVisionScreenshot(step, hash);
                    stepScreenshotPath = vs.screenshot_path;
                    screenshotB64 = vs.screenshot_b64 ?? null;

                    if (vs.vision) {
                        screenshotSummary = vs.vision.summary || null;

                        // Record each vision-detected error/warn as an errored screen
                        if (vs.vision.has_issues) {
                            for (const issue of vs.vision.issues) {
                                if (issue.severity === "warn" || issue.severity === "error") {
                                    const visionKey = `${hash}:vision:${issue.type}`;
                                    if (!reportedErrorScreenKeys.has(visionKey)) {
                                        reportedErrorScreenKeys.add(visionKey);
                                        const severity = issue.severity as "error" | "warn";
                                        findings.push({
                                            step,
                                            severity,
                                            message: `Vision: ${issue.type} on screen ${hash} — ${issue.description}`,
                                        });
                                        erroredScreens.push({
                                            step,
                                            screen_hash: hash,
                                            issue: issue.type,
                                            evidence: [
                                                issue.description,
                                                ...(issue.region ? [`region: ${issue.region}`] : []),
                                            ],
                                            screenshot: stepScreenshotPath,
                                        });
                                    }
                                }
                            }
                        }
                    }
                } catch {
                    // Vision is non-fatal — continue the loop
                }

                const overflowSignal = detectFlutterOverflowFromElements(snap.ui_elements as any[]);
                const runtimeSignals: Array<Record<string, unknown>> = [];
                let overflowDetection: Record<string, unknown> = {};

                if (overflowSignal.detected) {
                    const overflowKey = `${hash}:${overflowSignal.issue}`;
                    if (!reportedErrorScreenKeys.has(overflowKey)) {
                        reportedErrorScreenKeys.add(overflowKey);
                        findings.push({
                            step,
                            severity: "error",
                            message: `Flutter overflow detected on screen ${hash}`,
                        });
                        erroredScreens.push({
                            step,
                            screen_hash: hash,
                            issue: overflowSignal.issue,
                            evidence: overflowSignal.evidence,
                            screenshot: stepScreenshotPath,
                        });
                    }
                    runtimeSignals.push({
                        kind: "overflow",
                        source: "ui_hierarchy_text",
                        issue: overflowSignal.issue,
                        step,
                        screen_hash: hash,
                    });
                    overflowDetection = {
                        detected: true,
                        issue: overflowSignal.issue,
                        evidence: overflowSignal.evidence,
                        source: "ui_hierarchy_text",
                        step,
                        screen_hash: hash,
                        screenshot: stepScreenshotPath,
                    };
                }

                const aiOut = await aiRunStep({
                    step,
                    screen_hash: hash,
                    ui_elements: snap.ui_elements as any,
                    screenshot_summary: screenshotSummary,
                    screenshot_b64: screenshotB64,

                    last_action: lastAction,
                    last_result: lastResult,

                    // Start simple: explore mode; bootstrap can be layered in later.
                    mode: "explore",
                    seen_hash_counts: seenHashCounts,
                    seen_element_keys: seenElementKeys.current,
                    recent_actions: recentActionsRef.current.slice(-10).map(r => r.action as Record<string, unknown>),
                    failure_streak: failureStreak,
                    loop_count: loopCount.current,
                    no_element_count: noElementCount.current,

                    // ai-engine planner expects w/h (run_step also accepts width/height).
                    screen_size: { w: snap.screen_size.width, h: snap.screen_size.height },
                    credentials: null,

                    runtime_signals: runtimeSignals,
                    overflow_detection: overflowDetection,
                    prior_findings: triageFindings,
                });

                const triage = (aiOut.triage ?? null) as any;
                if (triage && typeof triage === "object") {
                    const deduped = Array.isArray(triage.deduped_findings)
                        ? triage.deduped_findings
                        : [];
                    const fresh = Array.isArray(triage.new_findings)
                        ? triage.new_findings
                        : [];
                    triageFindings = deduped.length > 0
                        ? (deduped as Array<Record<string, unknown>>)
                        : (fresh as Array<Record<string, unknown>>);
                }

                const aiOverflowSignal = detectAiOverflowSignal(aiOut);
                if (aiOverflowSignal.detected) {
                    const overflowKey = `${hash}:ai_overflow_signal`;
                    if (!reportedErrorScreenKeys.has(overflowKey)) {
                        reportedErrorScreenKeys.add(overflowKey);

                        findings.push({
                            step,
                            severity: "error",
                            message: `AI triage detected overflow signal on screen ${hash}`,
                        });
                        erroredScreens.push({
                            step,
                            screen_hash: hash,
                            issue: "flutter_overflow_ai_signal",
                            evidence: aiOverflowSignal.evidence,
                            screenshot: stepScreenshotPath,
                        });
                    }
                }

                let nextAction = (aiOut.next_action ?? {}) as any;
                let type = String(nextAction?.type ?? "");

                const sameHashCount = seenHashCounts[hash] ?? 1;
                const swipeStreak = trailingSwipeCount(recentActionsRef.current.map(r => r.action as Record<string, unknown>));
                const forcedTapAction = isSwipeAction(nextAction) && swipeStreak >= 1
                    ? (() => {
                        const tapTarget = pickTapFirstTarget(snap.ui_elements as any[], snap.screen_size);
                        if (!tapTarget) return null;
                        return {
                            type: "tap_xy",
                            params: { x: tapTarget.x, y: tapTarget.y },
                        };
                    })()
                    : null;

                const forcedNavAction = !forcedTapAction && isLowValueAiAction(nextAction)
                    ? buildNavigationRecoveryAction(
                        step,
                        sameHashCount,
                        snap.ui_elements as any[],
                        snap.screen_size,
                    )
                    : null;
                if (forcedTapAction) {
                    nextAction = forcedTapAction;
                    type = String(nextAction.type);
                } else if (forcedNavAction) {
                    nextAction = forcedNavAction;
                    type = String(nextAction.type);
                }

                if (!aiOut.should_continue || type === "stop") {
                    steps.push({ step_num: step, action: "stop", result_status: "stopped", screenshot: null });
                    setProgress((prev) => [
                        ...prev,
                        { step, total: maxSteps, action: "stop", status: "done", screenshot: null },
                    ]);
                    break;
                }

                try {
                    const exec = await executeAiAction(nextAction, {
                        ui_elements: snap.ui_elements as any[],
                        screen_size: snap.screen_size
                    });
                    steps.push({
                        step_num: step,
                        action: exec.actionLabel,
                        result_status: exec.resultStatus,
                        screenshot: null,
                    });
                    setProgress((prev) => [
                        ...prev,
                        { step, total: maxSteps, action: exec.actionLabel, status: "running", screenshot: stepScreenshotPath },
                    ]);

                    lastAction = nextAction;
                    lastResult = exec.resultStatus;
                    
                    // Track action with proper ActionRecord structure
                    const actionRecord: ActionRecord = {
                        step,
                        action: {
                            type: String(nextAction?.type ?? ""),
                            params: (nextAction?.params ?? {}) as Record<string, unknown>,
                        },
                        screen_hash: hash,
                        result: exec.resultStatus as any, // Map to ActionResult type
                        contributed_to_goal: false, // Will be updated when goal tracking is implemented
                    };
                    
                    recentActionsRef.current.push(actionRecord);
                    // Keep only last 10 actions
                    if (recentActionsRef.current.length > 10) {
                        recentActionsRef.current = recentActionsRef.current.slice(-10);
                    }

                    // Update loop count tracking
                    if (hash === lastScreenHash.current) {
                        loopCount.current += 1;
                    } else {
                        loopCount.current = 0;
                        lastScreenHash.current = hash;
                    }

                    // Update no element count
                    if (snap.ui_elements.length === 0) {
                        noElementCount.current += 1;
                    } else {
                        noElementCount.current = 0;
                    }

                    // Track tapped elements
                    if (nextAction.type === "tap_xy" && snap.ui_elements) {
                        const tappedX = Number(nextAction.params?.x ?? 0);
                        const tappedY = Number(nextAction.params?.y ?? 0);
                        
                        // Find the element that was tapped
                        for (const el of snap.ui_elements as any[]) {
                            if (el && typeof el === "object") {
                                const elX = Number(el.center_x ?? 0);
                                const elY = Number(el.center_y ?? 0);
                                const distance = Math.sqrt(Math.pow(elX - tappedX, 2) + Math.pow(elY - tappedY, 2));
                                
                                // If tap is within 50px of element center, consider it tapped
                                if (distance < 50) {
                                    const elementKey = `${el.resource_id ?? ""}::${el.bounds ?? ""}`;
                                    if (!seenElementKeys.current.includes(elementKey)) {
                                        seenElementKeys.current.push(elementKey);
                                    }
                                    break;
                                }
                            }
                        }
                    }

                    // Check if screen is completed (all clickable elements tapped)
                    const clickableElements = (snap.ui_elements as any[]).filter(
                        el => el && el.clickable === "true"
                    );
                    const allClickableTapped = clickableElements.every(el => {
                        const elementKey = `${el.resource_id ?? ""}::${el.bounds ?? ""}`;
                        return seenElementKeys.current.includes(elementKey);
                    });
                    if (allClickableTapped && clickableElements.length > 0) {
                        completedScreens.current.add(hash);
                    }

                    // ── Persist execution state after each action ──
                    try {
                        const executionState: ScenarioExecutionState = {
                            run_id: runId,
                            scenario: {
                                id: "exploration-mode",
                                name: "AI Exploration",
                                description: "Autonomous AI exploration without predefined goals",
                                app_name: "unknown",
                                goals: [],
                            },
                            current_goal_index: 0,
                            goal_progress: new Map(),
                            seen_element_keys: new Set(seenElementKeys.current),
                            seen_hash_counts: new Map(Object.entries(seenHashCounts).map(([k, v]) => [k, v])),
                            completed_screens: completedScreens.current,
                            loop_count: loopCount.current,
                            no_element_count: noElementCount.current,
                            recent_actions: recentActionsRef.current,
                            failure_streak: failureStreak,
                            goals_completed: 0,
                            goals_failed: 0,
                            total_findings: findings.map(f => ({
                                ...f,
                                severity: (f.severity === "error" || f.severity === "warn" || f.severity === "info") 
                                    ? f.severity 
                                    : "info"
                            })) as any,
                            mode: "explore",
                            login_step: 0,
                            started_at: scenarioStartTime,
                        };
                        
                        await saveExecutionState(runId, executionState);
                    } catch (stateErr) {
                        // State persistence is non-critical, log but don't break execution
                        console.error("Failed to persist execution state:", stateErr);
                    }

                    // ── Check max_steps constraint (acts as max_steps_per_goal for exploration) ──
                    // Note: In scenario-based execution, this will check per-goal constraints
                    const mockGoalProgress: GoalProgress = {
                        goal_id: "exploration",
                        status: "in_progress",
                        steps_taken: step,
                        success_criteria_met: [],
                        success_criteria_pending: [],
                        findings: [],
                        screenshots: [],
                        actions_log: recentActionsRef.current,
                    };
                    
                    const maxStepsResult = checkMaxStepsPerGoal(mockGoalProgress, maxSteps);
                    if (maxStepsResult.violated) {
                        const violationMsg = formatConstraintViolation(maxStepsResult);
                        console.warn(violationMsg);
                        findings.push({
                            step,
                            severity: "warn",
                            message: maxStepsResult.message || "Max steps reached",
                        });
                        // Don't break - let the loop naturally end at maxSteps
                    }

                    // Wait between steps (like the heuristic smoke check)
                    if (delayMs > 0) {
                        await sleep(delayMs);
                    }

                    failureStreak = exec.resultStatus === "ok" ? 0 : failureStreak + 1;
                } catch (err) {
                    failureStreak += 1;
                    const msg = String(err);
                    findings.push({ step, severity: "error", message: msg });
                    steps.push({ step_num: step, action: "error", result_status: "crash", screenshot: null });
                    setProgress((prev) => [
                        ...prev,
                        { step, total: maxSteps, action: "error", status: "error", screenshot: null },
                    ]);
                    break;
                }
            }

            const stepsDone = steps.length;
            const finalStatus = stopRequestedRef.current ? "stopped" : "complete";
            let reportPath: string | null = null;

            if (stepsDone >= 20) {
                try {
                    reportPath = await invokeWriteAiErroredScreensReport(
                        runId,
                        stepsDone,
                        erroredScreens,
                    );
                } catch (err) {
                    findings.push({
                        step: stepsDone,
                        severity: "warn",
                        message: `Failed to write AI errored screens report: ${String(err)}`,
                    });
                }
            }

            setResult({
                run_id: runId,
                device_serial: "local",
                max_steps: maxSteps,
                steps_done: stepsDone,
                final_status: finalStatus,
                findings,
                steps,
                report_path: reportPath,
            });

            // ── Clean up execution state on completion ──
            try {
                await deleteExecutionState(runId);
                console.log(`Execution state cleaned up for run: ${runId}`);
            } catch (cleanupErr) {
                console.error("Failed to cleanup execution state:", cleanupErr);
                // Non-critical, don't throw
            }
        } catch (err) {
            setErrMsg(String(err));
        } finally {
            setRunning(false);
        }
    };

    const handleStop = () => {
        invokeStopSmokeCheck();
        stopRequestedRef.current = true;
    };

    // Most recent progress event
    const latest = progress[progress.length - 1];
    const stepsDone = result?.steps_done ?? (latest ? latest.step : 0);
    const totalSteps = result?.max_steps ?? maxSteps;
    const progressPct = totalSteps > 0 ? Math.round((stepsDone / totalSteps) * 100) : 0;

    return (
        <div style={{
            border: "1px solid #1a2030",
            borderRadius: "14px",
            background: "#0A0D14",
            overflow: "hidden",
        }}>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 18px 10px",
                borderBottom: "1px solid #1a2030",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {/* Icon */}
                    <div style={{
                        width: 28, height: 28, borderRadius: "8px",
                        background: "rgba(157,123,255,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#E6EDF3" }}>
                        Auto Smoke Check
                    </span>
                    {running && (
                        <span style={{
                            background: "rgba(157,123,255,0.15)", color: accent,
                            borderRadius: "10px", padding: "1px 8px", fontSize: "10px", fontWeight: 700,
                            animation: "pulse 1.5s ease-in-out infinite",
                        }}>
                            Running
                        </span>
                    )}
                    {result && !running && (
                        <span style={{
                            background: result.final_status === "complete"
                                ? "rgba(63,185,80,0.12)"
                                : result.final_status === "crash"
                                    ? "rgba(248,81,73,0.12)"
                                    : "rgba(227,179,65,0.12)",
                            color: result.final_status === "complete" ? success
                                : result.final_status === "crash" ? error : warn,
                            borderRadius: "10px", padding: "1px 8px", fontSize: "10px", fontWeight: 700,
                        }}>
                            {result.final_status}
                        </span>
                    )}
                </div>

                {/* Controls */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {/* Steps control */}
                    {!running && (
                        <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#6E7681" }}>
                            Steps
                            <input
                                type="number"
                                min={1}
                                max={50}
                                value={maxSteps}
                                onChange={(e) => setMaxSteps(Math.max(1, Math.min(50, Number(e.target.value))))}
                                style={{
                                    width: "44px",
                                    background: "#0F1520",
                                    border: "1px solid #20252E",
                                    borderRadius: "6px",
                                    color: "#C9D1D9",
                                    fontSize: "11px",
                                    padding: "3px 6px",
                                    outline: "none",
                                }}
                            />
                        </label>
                    )}
                    {/* Delay control */}
                    {!running && (
                        <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#6E7681" }}>
                            Delay
                            <select
                                value={delayMs}
                                onChange={(e) => setDelayMs(Number(e.target.value))}
                                style={{
                                    background: "#0F1520",
                                    border: "1px solid #20252E",
                                    borderRadius: "6px",
                                    color: "#C9D1D9",
                                    fontSize: "11px",
                                    padding: "3px 6px",
                                    outline: "none",
                                    cursor: "pointer",
                                }}
                            >
                                <option value={500}>0.5 s</option>
                                <option value={1000}>1 s</option>
                                <option value={1500}>1.5 s</option>
                                <option value={2000}>2 s</option>
                                <option value={3000}>3 s</option>
                            </select>
                        </label>
                    )}
                    {/* Action button */}
                    {running ? (
                        <button
                            onClick={handleStop}
                            style={{
                                border: `1px solid ${error}44`,
                                borderRadius: "8px",
                                padding: "5px 14px",
                                background: "rgba(248,81,73,0.08)",
                                color: error,
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            ■ Stop
                        </button>
                    ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <button
                                onClick={handleStart}
                                style={{
                                    border: `1px solid ${accent}55`,
                                    borderRadius: "8px",
                                    padding: "5px 14px",
                                    background: "rgba(157,123,255,0.1)",
                                    color: accent,
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    transition: "background 0.15s",
                                }}
                            >
                                ▶ Run
                            </button>

                            <button
                                onClick={handleStartAi}
                                style={{
                                    border: `1px solid ${accent}55`,
                                    borderRadius: "8px",
                                    padding: "5px 14px",
                                    background: "rgba(157,123,255,0.1)",
                                    color: accent,
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    transition: "background 0.15s",
                                }}
                            >
                                ▶ Start AI Test Run
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Progress bar ────────────────────────────────────────────── */}
            {(running || result) && (
                <div style={{ padding: "8px 18px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "10px", color: "#6E7681" }}>
                            {running ? latest?.action ?? "Starting…" : result?.final_status ?? ""}
                        </span>
                        <span style={{ fontSize: "10px", color: "#6E7681" }}>
                            {stepsDone} / {totalSteps}
                        </span>
                    </div>
                    <div style={{
                        height: "4px", borderRadius: "2px",
                        background: "#1a2030", overflow: "hidden",
                    }}>
                        <div style={{
                            height: "100%", borderRadius: "2px",
                            width: `${progressPct}%`,
                            background: result?.final_status === "crash" ? error
                                : result?.final_status === "loop" ? warn
                                    : accent,
                            transition: "width 0.3s ease",
                        }} />
                    </div>
                </div>
            )}

            {/* ── Error message ────────────────────────────────────────────── */}
            {errMsg && (
                <div style={{
                    margin: "10px 18px 0",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(248,81,73,0.07)",
                    border: "1px solid rgba(248,81,73,0.2)",
                    fontSize: "11px",
                    color: error,
                }}>
                    {errMsg}
                </div>
            )}

            {/* ── Step feed ───────────────────────────────────────────────── */}
            {progress.length > 0 && (
                <div
                    ref={feedRef}
                    style={{
                        maxHeight: "160px",
                        overflowY: "auto",
                        padding: "6px 18px",
                        marginTop: "6px",
                    }}
                >
                    {progress
                        .filter((p) => p.status !== "done" && p.action !== "done" && p.action !== "stopped")
                        .map((p, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "3px 0",
                                    borderBottom: "1px solid #10141c",
                                }}
                            >
                                <span style={{
                                    fontSize: "9px",
                                    fontWeight: 700,
                                    color: "#2a3040",
                                    width: "24px",
                                    flexShrink: 0,
                                    textAlign: "right",
                                }}>
                                    {p.step}
                                </span>
                                <span style={{
                                    fontSize: "11px",
                                    color: statusColor(p.status),
                                    fontWeight: 600,
                                    flexShrink: 0,
                                }}>
                                    {resultIcon(p.status)}
                                </span>
                                <span style={{
                                    fontSize: "11px",
                                    color: "#8B949E",
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}>
                                    {p.action}
                                </span>
                            </div>
                        ))}
                </div>
            )}

            {/* ── Findings summary ─────────────────────────────────────────── */}
            {result && result.findings.length > 0 && (
                <div style={{
                    margin: "8px 18px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(227,179,65,0.05)",
                    border: "1px solid rgba(227,179,65,0.15)",
                }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: warn, marginBottom: "4px", letterSpacing: "0.4px" }}>
                        {result.findings.length} FINDING{result.findings.length !== 1 ? "S" : ""}
                    </div>
                    {result.findings.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "2px" }}>
                            <span style={{ fontSize: "10px", color: findingColor(f.severity), flexShrink: 0, marginTop: "1px" }}>
                                {findingIcon(f.severity)}
                            </span>
                            <span style={{
                                fontSize: "10px",
                                color: "#8B949E",
                                lineHeight: 1.5,
                                overflow: "hidden",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                            }}>
                                <strong style={{ color: findingColor(f.severity) }}>
                                    [step {f.step}]
                                </strong>{" "}
                                {f.message}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Report link ──────────────────────────────────────────────── */}
            {result?.report_path && (
                <div style={{
                    padding: "6px 18px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "10px",
                    color: "#6E7681",
                }}>
                    <span>📄</span>
                    <span style={{ color: accent, fontWeight: 600 }}>Report:</span>
                    <span
                        title={result.report_path}
                        style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily: "monospace",
                            fontSize: "10px",
                            color: "#8B949E",
                            flex: 1,
                        }}
                    >
                        {result.report_path.split(/[/\\]/).pop()}
                    </span>
                    <button
                        onClick={() => {
                            // Open the folder containing the report using Tauri shell API
                            import("@tauri-apps/api/shell").then(({ open }) => {
                                const dir = result.report_path!.replace(/[/\\][^/\\]+$/, "");
                                open(dir).catch(() => { });
                            });
                        }}
                        style={{
                            flexShrink: 0,
                            border: `1px solid ${accent}33`,
                            borderRadius: "5px",
                            padding: "2px 8px",
                            background: "rgba(157,123,255,0.07)",
                            color: accent,
                            fontSize: "10px",
                            fontWeight: 700,
                            cursor: "pointer",
                        }}
                    >
                        Open folder
                    </button>
                </div>
            )}

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}
