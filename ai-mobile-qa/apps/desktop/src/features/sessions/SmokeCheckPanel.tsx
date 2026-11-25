import { useState, useEffect, useRef } from "react";
import {
    invokeRunSmokeCheck,
    invokeStopSmokeCheck,
    invokeGetUiSnapshot,
    invokeActionTap,
    invokeActionBack,
    invokeActionInput,
    invokeActionClearField,
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

import { aiRunStep, aiSessionBootstrap } from "../../lib/aiEngine";
import {
    listScenarios,
    validateAndSaveScenario,
} from "../../lib/scenarioStorage";
import type {
    ActionRecord,
    ScenarioExecutionState,
    GoalProgress,
    SmokeScenario,
    ScenarioGoal,
} from "../../types/scenario";
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

type SmokeCheckPanelProps = {
    prefillScenarioId?: string | null;
    prefillScenarioSignal?: number;
};

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

/**
 * Infer navigation keywords from ANY goal type — used for universal pre-nav.
 * Works for navigate, form_fill, verify, explore_section, custom, login.
 */
function inferGoalNavKeywords(goal: ScenarioGoal | null): string[] {
    if (!goal) return [];

    const keywords = new Set<string>();
    const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "screen", "page", "view", "goal"]);

    const pushWords = (value: string) => {
        const normalized = value
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/[^a-z0-9\s]/g, " ");
        for (const word of normalized.split(/\s+/)) {
            if (word.length >= 3 && !STOP_WORDS.has(word)) keywords.add(word);
        }
    };

    pushWords(goal.description ?? "");
    for (const screen of goal.hints?.expected_screens ?? []) pushWords(screen);
    for (const action of goal.hints?.required_actions ?? []) {
        const lower = String(action ?? "").toLowerCase().trim();
        const tapPrefix = "tap:";
        pushWords(lower.startsWith(tapPrefix) ? lower.slice(tapPrefix.length) : lower);
    }
    // Also include explicit keywords if set
    for (const kw of goal.start_screen_keywords ?? []) pushWords(kw);

    return Array.from(keywords);
}

// Keep backward-compat name used by buildGoalDirectedNavigationAction
function collectGoalNavigationKeywords(goal: ScenarioGoal | null): string[] {
    return inferGoalNavKeywords(goal);
}

function buildGoalDirectedNavigationAction(
    goal: ScenarioGoal | null,
    sameHashCount: number,
    uiElements: Array<any>,
    screenSize?: { width: number; height: number },
): { type: string; params: Record<string, unknown> } | null {
    // Works for ALL goal types — navigate, form_fill, verify, explore_section, custom
    if (!goal) return null;

    const goalKeywords = collectGoalNavigationKeywords(goal);
    if (goalKeywords.length === 0) return null;

    const h = Math.max(640, Number(screenSize?.height ?? 1920));
    const minBottomY = Math.floor(h * 0.76);

    const bottomNavGoalTarget = pickElementByKeywords(uiElements, goalKeywords, { minY: minBottomY });
    if (bottomNavGoalTarget) {
        return {
            type: "tap_xy",
            params: { x: Math.floor(bottomNavGoalTarget.x), y: Math.floor(bottomNavGoalTarget.y) },
        };
    }

    const visibleGoalTarget = pickElementByKeywords(uiElements, goalKeywords, { minY: 0 });
    if (visibleGoalTarget) {
        return {
            type: "tap_xy",
            params: { x: Math.floor(visibleGoalTarget.x), y: Math.floor(visibleGoalTarget.y) },
        };
    }

    if (sameHashCount >= 2) {
        const drawerTarget = pickElementByKeywords(
            uiElements,
            ["menu", "drawer", "navigation", "hamburger", "open navigation"],
            { minY: 0 },
        );
        if (drawerTarget) {
            return {
                type: "tap_xy",
                params: { x: Math.floor(drawerTarget.x), y: Math.floor(drawerTarget.y) },
            };
        }
    }

    return null;
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

function buildStarterScenario(appName: string): SmokeScenario {
    const goal: ScenarioGoal = {
        id: "goal-1",
        description: "Navigate to the main screen",
        type: "navigate",
        success_criteria: [
            "Main screen is visible",
            "Primary navigation is available",
        ],
        hints: {
            expected_screens: ["home", "main", "dashboard"],
            required_actions: ["tap:home", "tap:continue"],
        },
    };

    return {
        id: `scenario-${Date.now().toString(36)}`,
        name: "New Scenario",
        description: "Starter scenario created from Smoke Check",
        app_name: appName.trim() || "com.example.app",
        goals: [goal],
        constraints: {
            max_steps_per_goal: 20,
            timeout_seconds: 300,
            stop_on_first_failure: false,
        },
    };
}

/**
 * Checks whether the current screen contains any of the goal's start_screen_keywords.
 * Searches through UI element text fields AND the screenshot summary string.
 *
 * Returns false (not matched) when no keywords are given so that the pre-nav
 * phase always attempts navigation rather than assuming it's already in position.
 */
function screenMatchesKeywords(
    keywords: string[],
    uiElements: any[],
    screenshotSummary: string | null,
): boolean {
    if (!keywords.length) return false; // no keywords → can't confirm screen, attempt nav
    const lowerKws = keywords.map(k => k.toLowerCase());
    const haystack = [
        ...(uiElements ?? []).flatMap((el: any) => [
            el?.text, el?.content_desc, el?.resource_id, el?.hint, el?.label,
        ]),
        screenshotSummary,
    ].map(v => String(v ?? "").toLowerCase()).join(" ");
    return lowerKws.some(kw => kw && haystack.includes(kw));
}

/**
 * Returns bottom-nav tab elements sorted LEFT → RIGHT by X coordinate.
 * "Bottom nav" = clickable elements in the bottom 24% of the screen.
 */
function getBottomNavTabsOrdered(elements: any[], screenHeight: number): any[] {
    const minY = Math.floor(screenHeight * 0.76);
    return elements
        .filter((el: any) => {
            const cy = Number(el?.center_y ?? el?.y ?? 0);
            const clickable = String(el?.clickable ?? "").toLowerCase() === "true";
            return cy >= minY && clickable;
        })
        .sort((a, b) => Number(a.center_x ?? a.x ?? 0) - Number(b.center_x ?? b.x ?? 0));
}

/**
 * Returns the sidebar/hamburger button if visible (top-left area of screen).
 */
function findSidebarToggle(elements: any[], screenHeight: number): any | null {
    const maxY = Math.floor(screenHeight * 0.18);
    const sidebarKeywords = ["menu", "drawer", "navigation", "hamburger", "sidebar", "nav_drawer"];
    for (const el of elements) {
        const cy = Number(el?.center_y ?? el?.y ?? 0);
        const cx = Number(el?.center_x ?? el?.x ?? 0);
        if (cy > maxY) continue;
        const txt = [el?.text, el?.content_desc, el?.resource_id, el?.class]
            .map((v: any) => String(v ?? "").toLowerCase()).join(" ");
        if (sidebarKeywords.some(kw => txt.includes(kw))) {
            if (Number.isFinite(cx) && Number.isFinite(cy)) return el;
        }
    }
    // Fallback: any clickable element in the top-left corner
    for (const el of elements) {
        const cy = Number(el?.center_y ?? el?.y ?? 0);
        const cx = Number(el?.center_x ?? el?.x ?? 0);
        const clickable = String(el?.clickable ?? "").toLowerCase() === "true";
        if (cy <= maxY && cx <= 120 && clickable && Number.isFinite(cx) && Number.isFinite(cy)) {
            return el;
        }
    }
    return null;
}

/**
 * Navigates to the goal's start screen in at most 4 targeted steps.
 *
 * Strategy (strictly in order, no random taps):
 *   0. Check keywords — if already on start screen, done (0 steps).
 *   1. If start_nav_tap_label set → find & tap that exact nav element.
 *   2. Walk bottom-nav tabs LEFT → RIGHT, one per step. Check after each.
 *   3. Try sidebar/hamburger toggle. Check after.
 *   4. Press back ONCE as last resort. Check after.
 *
 * Stops as soon as keywords match. Returns steps consumed.
 */
async function navigateToGoalStartScreen(
    goal: ScenarioGoal,
    getSnapshot: () => Promise<{ ui_elements: any[]; screen_hash: string; screen_size: { width: number; height: number } }>,
    doTap: (x: number, y: number) => Promise<void>,
    doBack: () => Promise<void>,
    sleep: (ms: number) => Promise<void>,
    logStep: (msg: string) => void,
): Promise<number> {
    const MAX_STEPS = 4;
    const keywords = goal.start_screen_keywords ?? [];
    const navLabel = (goal.start_nav_tap_label ?? "").toLowerCase().trim();

    // ── Phase 0: already on start screen? ────────────────────────────────────
    let snap = await getSnapshot();
    if (screenMatchesKeywords(keywords, snap.ui_elements as any[], null)) {
        logStep(`[nav] Already on start screen — skipping pre-nav`);
        return 0;
    }

    let stepsUsed = 0;

    // ── Phase 1: tap the exact label the user specified ───────────────────────
    if (navLabel && stepsUsed < MAX_STEPS) {
        const elements = snap.ui_elements as any[];
        const match = elements.find((el: any) => {
            const txt = [el?.text, el?.content_desc, el?.resource_id]
                .map((v: any) => String(v ?? "").toLowerCase()).join(" ");
            return txt.includes(navLabel);
        });
        if (match) {
            const cx = Number(match.center_x ?? match.x);
            const cy = Number(match.center_y ?? match.y);
            if (Number.isFinite(cx) && Number.isFinite(cy)) {
                logStep(`[nav] Step ${stepsUsed + 1}: Tapping "${goal.start_nav_tap_label}" at (${cx},${cy})`);
                await doTap(cx, cy);
                stepsUsed++;
                await sleep(700);
                snap = await getSnapshot();
                if (screenMatchesKeywords(keywords, snap.ui_elements as any[], null)) {
                    logStep(`[nav] ✓ Found after tapping "${goal.start_nav_tap_label}"`);
                    return stepsUsed;
                }
            }
        }
    }

    // ── Phase 2: walk bottom-nav tabs LEFT → RIGHT ────────────────────────────
    if (stepsUsed < MAX_STEPS) {
        snap = await getSnapshot();
        const tabs = getBottomNavTabsOrdered(snap.ui_elements as any[], snap.screen_size.height);
        for (const tab of tabs) {
            if (stepsUsed >= MAX_STEPS) break;
            const cx = Number(tab.center_x ?? tab.x);
            const cy = Number(tab.center_y ?? tab.y);
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
            const label = tab.text || tab.content_desc || `(${cx},${cy})`;
            logStep(`[nav] Step ${stepsUsed + 1}: Bottom nav → "${label}" at (${cx},${cy})`);
            await doTap(cx, cy);
            stepsUsed++;
            await sleep(700);
            snap = await getSnapshot();
            if (screenMatchesKeywords(keywords, snap.ui_elements as any[], null)) {
                logStep(`[nav] ✓ Found after tapping bottom nav "${label}"`);
                return stepsUsed;
            }
        }
    }

    // ── Phase 3: try sidebar/hamburger ────────────────────────────────────────
    if (stepsUsed < MAX_STEPS) {
        snap = await getSnapshot();
        const sidebar = findSidebarToggle(snap.ui_elements as any[], snap.screen_size.height);
        if (sidebar) {
            const cx = Number(sidebar.center_x ?? sidebar.x);
            const cy = Number(sidebar.center_y ?? sidebar.y);
            logStep(`[nav] Step ${stepsUsed + 1}: Opening sidebar at (${cx},${cy})`);
            await doTap(cx, cy);
            stepsUsed++;
            await sleep(700);
            snap = await getSnapshot();
            if (screenMatchesKeywords(keywords, snap.ui_elements as any[], null)) {
                logStep(`[nav] ✓ Found after opening sidebar`);
                return stepsUsed;
            }
            // If sidebar opened, look for keyword match inside menu items
            if (keywords.length > 0 && stepsUsed < MAX_STEPS) {
                const elements = snap.ui_elements as any[];
                const menuMatch = elements.find((el: any) => {
                    const txt = [el?.text, el?.content_desc, el?.resource_id]
                        .map((v: any) => String(v ?? "").toLowerCase()).join(" ");
                    const clickable = String(el?.clickable ?? "").toLowerCase() === "true";
                    return clickable && keywords.some(kw => txt.includes(kw.toLowerCase()));
                });
                if (menuMatch) {
                    const cx2 = Number(menuMatch.center_x ?? menuMatch.x);
                    const cy2 = Number(menuMatch.center_y ?? menuMatch.y);
                    const lbl = menuMatch.text || menuMatch.content_desc || "";
                    logStep(`[nav] Step ${stepsUsed + 1}: Tapping sidebar item "${lbl}" at (${cx2},${cy2})`);
                    await doTap(cx2, cy2);
                    stepsUsed++;
                    await sleep(700);
                    snap = await getSnapshot();
                    if (screenMatchesKeywords(keywords, snap.ui_elements as any[], null)) {
                        logStep(`[nav] ✓ Found via sidebar item "${lbl}"`);
                        return stepsUsed;
                    }
                }
            }
        }
    }

    // ── Phase 4: back once (absolute last resort) ─────────────────────────────
    if (stepsUsed < MAX_STEPS && keywords.length > 0) {
        logStep(`[nav] Step ${stepsUsed + 1}: Back (last resort)`);
        await doBack();
        stepsUsed++;
        await sleep(500);
        snap = await getSnapshot();
        if (screenMatchesKeywords(keywords, snap.ui_elements as any[], null)) {
            logStep(`[nav] ✓ Found after back`);
            return stepsUsed;
        }
    }

    logStep(`[nav] ⚠ Start screen not confirmed in ${stepsUsed} step(s) — proceeding`);
    return stepsUsed;
}



// ── component ─────────────────────────────────────────────────────────────────

export default function SmokeCheckPanel({
    prefillScenarioId = null,
    prefillScenarioSignal = 0,
}: SmokeCheckPanelProps) {
    const [running, setRunning] = useState(false);
    const [maxSteps, setMaxSteps] = useState(20);
    const [delayMs, setDelayMs] = useState(1500);
    const [timeoutSeconds, setTimeoutSeconds] = useState(300); // 5 minutes default
    const [progress, setProgress] = useState<RunProgressEvent[]>([]);
    const [result, setResult] = useState<SmokeCheckResult | null>(null);
    const [errMsg, setErrMsg] = useState<string | null>(null);
    const [scenarioMode, setScenarioMode] = useState<"autonomous" | "scenario">("autonomous");
    const [scenarios, setScenarios] = useState<SmokeScenario[]>([]);
    const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
    const [scenarioLoading, setScenarioLoading] = useState(false);
    const [scenarioBusy, setScenarioBusy] = useState(false);
    const [scenarioError, setScenarioError] = useState<string | null>(null);
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
    const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
    const selectedScenarioGoal = selectedScenario?.goals?.[0] ?? null;

    const refreshScenarios = async (preserveSelection = true, preferredScenarioId: string | null = null) => {
        setScenarioLoading(true);
        setScenarioError(null);
        try {
            const loaded = await listScenarios();
            const sorted = [...loaded].sort((a, b) => a.name.localeCompare(b.name));
            setScenarios(sorted);
            setSelectedScenarioId((current) => {
                if (preferredScenarioId && sorted.some((scenario) => scenario.id === preferredScenarioId)) {
                    return preferredScenarioId;
                }
                if (preserveSelection && current && sorted.some((scenario) => scenario.id === current)) {
                    return current;
                }
                return sorted[0]?.id ?? "";
            });
        } catch (err) {
            setScenarios([]);
            setSelectedScenarioId("");
            setScenarioError(String(err));
        } finally {
            setScenarioLoading(false);
        }
    };

    const createScenarioFromUi = async () => {
        setScenarioBusy(true);
        setScenarioError(null);
        try {
            const starter = buildStarterScenario(selectedScenario?.app_name ?? "com.example.app");
            await validateAndSaveScenario(starter);
            await refreshScenarios(false);
            setSelectedScenarioId(starter.id);
            setScenarioMode("scenario");
        } catch (err) {
            setScenarioError(String(err));
        } finally {
            setScenarioBusy(false);
        }
    };

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

        // Sort by center_y ascending (top-to-bottom) so we always start from topmost field
        const editFields = elements
            .filter((el) => el && typeof el === "object")
            .filter((el) => isEdit(el))
            .sort((a, b) => Number(a.center_y ?? 0) - Number(b.center_y ?? 0));

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
                    await sleep(200);
                    // Clear existing content before typing — Appium /keys APPENDS, so we
                    // must select-all + delete first to avoid number-appending bugs.
                    await invokeActionClearField();
                    await sleep(100);
                } catch {
                    // ignore — typing will still proceed
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
                        await sleep(200);
                        await invokeActionClearField();
                        await sleep(100);
                        await invokeActionInput(text);
                        return { actionLabel: `input_text(retry+clear)`, resultStatus: "ok" };
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

    useEffect(() => {
        void refreshScenarios();
    }, []);

    useEffect(() => {
        if (!prefillScenarioId) return;
        setScenarioMode("scenario");
        void refreshScenarios(false, prefillScenarioId);
    }, [prefillScenarioId, prefillScenarioSignal]);

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

        if (scenarioMode === "scenario" && !selectedScenario) {
            setErrMsg("Select a scenario before starting scenario-based testing.");
            setRunning(false);
            return;
        }

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
        let activeMode: "reach_home" | "explore" = "explore";
        let scenarioGoalContext: Record<string, unknown> | null = null;
        let scenarioGoalProgress: Record<string, unknown> | null = null;

        // ── Multi-goal tracking ──────────────────────────────────────────────
        let currentGoalIndex = 0;
        let goalStepCount = 0;  // steps taken for current goal
        const maxStepsPerGoal = selectedScenario?.constraints?.max_steps_per_goal ?? maxSteps;

        if (scenarioMode === "scenario" && selectedScenario) {
            const selectedCredentials = selectedScenario.credentials
                ? {
                    email: selectedScenario.credentials.email,
                    password: selectedScenario.credentials.password,
                    optional_otp_note: null,
                }
                : { email: "", password: "", optional_otp_note: null };

            const homeMarkers = selectedScenario.goals[0]?.hints?.expected_screens ?? [];
            const flowHints = selectedScenario.goals.map((g) => g.description);

            try {
                const bootstrap = await aiSessionBootstrap({
                    app_name: selectedScenario.app_name,
                    platform: "android",
                    max_steps: maxSteps,
                    credentials: selectedCredentials,
                    home_markers: homeMarkers,
                    flow_hints: flowHints,
                    constraints: selectedScenario.constraints
                        ? ({ ...selectedScenario.constraints } as Record<string, unknown>)
                        : {},
                    scenario: {
                        id: selectedScenario.id,
                        name: selectedScenario.name,
                        description: selectedScenario.description,
                        goals: selectedScenario.goals as unknown as Array<Record<string, unknown>>,
                        credentials: selectedScenario.credentials ?? undefined,
                    },
                });

                activeMode = bootstrap.mode;
                const firstGoal = selectedScenario.goals[0] ?? null;
                if (firstGoal) {
                    scenarioGoalContext = firstGoal as unknown as Record<string, unknown>;
                    scenarioGoalProgress = {
                        steps_taken: 0,
                        criteria_met: [],
                        criteria_pending: firstGoal.success_criteria,
                    };
                }
            } catch (err) {
                setErrMsg(`Failed to bootstrap scenario: ${String(err)}`);
                setRunning(false);
                return;
            }
        }

        /** Helper: run pre-navigation to a goal's start screen for ANY goal type */
        const runPreNavToGoal = async (goal: ScenarioGoal, stepLabel: string) => {
            setProgress(prev => [...prev, {
                step: 0, total: maxSteps,
                action: `🎯 [${stepLabel}] Navigating to: "${goal.description}"`,
                status: "running", screenshot: null,
            }]);
            try {
                const preNavSteps = await navigateToGoalStartScreen(
                    goal,
                    () => invokeGetUiSnapshot(),
                    async (x, y) => { await invokeActionTap(x, y); },
                    async () => { await invokeActionBack(); },
                    (ms) => sleep(ms),
                    (msg) => {
                        console.log(msg);
                        setProgress(prev => [...prev, {
                            step: 0, total: maxSteps,
                            action: msg, status: "running", screenshot: null,
                        }]);
                    },
                );
                if (preNavSteps > 0) {
                    setProgress(prev => [...prev, {
                        step: 0, total: maxSteps,
                        action: `✓ [${stepLabel}] Start screen reached in ${preNavSteps} step(s)`,
                        status: "running", screenshot: null,
                    }]);
                }
            } catch (navErr) {
                console.warn("Pre-navigation failed:", navErr);
            }
        };

        // ── PRE-NAVIGATION: ALWAYS run for every scenario, infer keywords automatically ──
        if (scenarioMode === "scenario" && selectedScenario) {
            const firstGoal = selectedScenario.goals[0] ?? null;
            if (firstGoal) {
                // Build keyword-augmented goal so navigateToGoalStartScreen has keywords
                // even when the scenario author didn't fill in start_screen_keywords.
                const inferredKeywords = inferGoalNavKeywords(firstGoal);
                const augmentedGoal: ScenarioGoal = {
                    ...firstGoal,
                    start_screen_keywords: inferredKeywords.length > 0
                        ? inferredKeywords
                        : (firstGoal.start_screen_keywords ?? []),
                    // Auto-set start_nav_tap_label from description if not set
                    start_nav_tap_label: firstGoal.start_nav_tap_label
                        ?? inferredKeywords[0] ?? undefined,
                };
                await runPreNavToGoal(augmentedGoal, `Goal 1/${selectedScenario.goals.length}`);
            }
        }

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
                    // Small sleep to ensure the UI is fully rendered and idle before screenshot
                    await sleep(1200);
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

                    mode: activeMode,
                    seen_hash_counts: seenHashCounts,
                    seen_element_keys: seenElementKeys.current,
                    recent_actions: recentActionsRef.current.slice(-10).map(r => r.action as Record<string, unknown>),
                    failure_streak: failureStreak,
                    loop_count: loopCount.current,
                    no_element_count: noElementCount.current,

                    // ai-engine planner expects w/h (run_step also accepts width/height).
                    screen_size: { w: snap.screen_size.width, h: snap.screen_size.height },
                    credentials: scenarioMode === "scenario" && selectedScenario?.credentials
                        ? {
                            email: selectedScenario.credentials.email,
                            password: selectedScenario.credentials.password,
                        }
                        : null,
                    current_goal: scenarioGoalContext,
                    goal_progress: scenarioGoalProgress,

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

                // ── Goal advancement: track steps per goal, advance when exhausted ──
                if (scenarioMode === "scenario" && selectedScenario) {
                    goalStepCount++;
                    const currentGoal = selectedScenario.goals[currentGoalIndex] ?? null;

                    // Update goal progress context sent to AI
                    if (currentGoal) {
                        scenarioGoalContext = currentGoal as unknown as Record<string, unknown>;
                        scenarioGoalProgress = {
                            steps_taken: goalStepCount,
                            criteria_met: [],
                            criteria_pending: currentGoal.success_criteria,
                        };
                    }

                    // Advance to next goal when: AI says stop, or per-goal step budget exhausted
                    const goalDone = (!aiOut.should_continue && currentGoalIndex < selectedScenario.goals.length - 1)
                        || goalStepCount >= maxStepsPerGoal;

                    if (goalDone && currentGoalIndex < selectedScenario.goals.length - 1) {
                        const nextGoalIndex = currentGoalIndex + 1;
                        const nextGoal = selectedScenario.goals[nextGoalIndex];
                        setProgress(prev => [...prev, {
                            step, total: maxSteps,
                            action: `⏭ Goal ${currentGoalIndex + 1} done → starting Goal ${nextGoalIndex + 1}: "${nextGoal.description}"`,
                            status: "running", screenshot: null,
                        }]);
                        currentGoalIndex = nextGoalIndex;
                        goalStepCount = 0;

                        // Pre-nav to the next goal's start screen
                        const inferredKeywords = inferGoalNavKeywords(nextGoal);
                        const augmentedNextGoal: ScenarioGoal = {
                            ...nextGoal,
                            start_screen_keywords: inferredKeywords.length > 0
                                ? inferredKeywords
                                : (nextGoal.start_screen_keywords ?? []),
                            start_nav_tap_label: nextGoal.start_nav_tap_label
                                ?? inferredKeywords[0] ?? undefined,
                        };
                        await runPreNavToGoal(augmentedNextGoal, `Goal ${nextGoalIndex + 1}/${selectedScenario.goals.length}`);

                        // Update context with new goal after nav
                        scenarioGoalContext = nextGoal as unknown as Record<string, unknown>;
                        scenarioGoalProgress = {
                            steps_taken: 0,
                            criteria_met: [],
                            criteria_pending: nextGoal.success_criteria,
                        };
                        // Reset loop tracking for fresh goal
                        loopCount.current = 0;
                        lastScreenHash.current = null;
                        // Skip rest of this step iteration — refresh snapshot next loop
                        continue;
                    }

                    // All goals done — stop
                    if (goalDone && currentGoalIndex >= selectedScenario.goals.length - 1) {
                        setProgress(prev => [...prev, {
                            step, total: maxSteps,
                            action: `✅ All ${selectedScenario.goals.length} goal(s) completed!`,
                            status: "done", screenshot: null,
                        }]);
                        break;
                    }
                }

                // Use currently active goal (not always goals[0]) for overrides
                const activeGoalForOverride = scenarioMode === "scenario" && selectedScenario
                    ? (selectedScenario.goals[currentGoalIndex] ?? null)
                    : null;

                const sameHashCount = seenHashCounts[hash] ?? 1;
                const goalDirectedAction = scenarioMode === "scenario"
                    ? buildGoalDirectedNavigationAction(
                        activeGoalForOverride,
                        sameHashCount,
                        snap.ui_elements as any[],
                        snap.screen_size,
                    )
                    : null;
                const swipeStreak = trailingSwipeCount(recentActionsRef.current.map(r => r.action as Record<string, unknown>));
                const forcedTapAction = isSwipeAction(nextAction) && swipeStreak >= 1
                    ? (() => {
                        const tapTarget = pickTapFirstTarget(snap.ui_elements as any[], snap.screen_size);
                        if (!tapTarget) return null;
                        return { type: "tap_xy", params: { x: tapTarget.x, y: tapTarget.y } };
                    })()
                    : null;

                const forcedNavAction = !forcedTapAction && isLowValueAiAction(nextAction)
                    ? buildNavigationRecoveryAction(step, sameHashCount, snap.ui_elements as any[], snap.screen_size)
                    : null;

                if (goalDirectedAction && (isLowValueAiAction(nextAction) || sameHashCount >= 2)) {
                    nextAction = goalDirectedAction;
                    type = String(nextAction.type);
                } else if (forcedTapAction) {
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
                    
                    // Post-action screenshot to bridge the timing gap
                    await sleep(1200);
                    try {
                        await invokeActionScreenshot();
                    } catch (e) {
                        // ignore
                    }

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
                        const tappedX = Number(nextAction.params?.x ?? nextAction.params?.center_x ?? nextAction.params?.cx ?? 0);
                        const tappedY = Number(nextAction.params?.y ?? nextAction.params?.center_y ?? nextAction.params?.cy ?? 0);

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

            if (stepsDone > 0) {
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

                {/* Scenario mode */}
                <div style={{
                    marginTop: "10px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #1a2030",
                    background: "#0B1018",
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
                        <span style={{ fontSize: "10px", color: "#6E7681", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                            Scenario Mode
                        </span>
                        <span style={{ fontSize: "10px", color: scenarioMode === "scenario" ? success : warn, fontWeight: 700 }}>
                            {scenarioMode === "scenario" ? "Scenario-Based" : "Autonomous"}
                        </span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                        <button
                            onClick={() => setScenarioMode("autonomous")}
                            style={{
                                border: `1px solid ${scenarioMode === "autonomous" ? accent : "#1f2632"}`,
                                borderRadius: "8px",
                                padding: "5px 10px",
                                background: scenarioMode === "autonomous" ? "rgba(157,123,255,0.14)" : "#0F1520",
                                color: scenarioMode === "autonomous" ? accent : "#8B949E",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            Autonomous
                        </button>
                        <button
                            onClick={() => setScenarioMode("scenario")}
                            disabled={scenarios.length === 0}
                            style={{
                                border: `1px solid ${scenarioMode === "scenario" ? accent : "#1f2632"}`,
                                borderRadius: "8px",
                                padding: "5px 10px",
                                background: scenarioMode === "scenario" ? "rgba(157,123,255,0.14)" : "#0F1520",
                                color: scenarios.length === 0 ? "#4a5568" : scenarioMode === "scenario" ? accent : "#8B949E",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: scenarios.length === 0 ? "not-allowed" : "pointer",
                            }}
                        >
                            Scenario-Based
                        </button>
                        <button
                            onClick={() => void refreshScenarios()}
                            disabled={scenarioLoading}
                            style={{
                                border: "1px solid #1f2632",
                                borderRadius: "8px",
                                padding: "5px 10px",
                                background: "#0F1520",
                                color: scenarioLoading ? "#4a5568" : "#8B949E",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: scenarioLoading ? "not-allowed" : "pointer",
                            }}
                        >
                            {scenarioLoading ? "Refreshing..." : "Refresh"}
                        </button>
                        <button
                            onClick={() => void createScenarioFromUi()}
                            disabled={scenarioBusy}
                            style={{
                                border: "1px solid rgba(63,185,80,0.25)",
                                borderRadius: "8px",
                                padding: "5px 10px",
                                background: "rgba(63,185,80,0.08)",
                                color: scenarioBusy ? "#4a5568" : success,
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: scenarioBusy ? "not-allowed" : "pointer",
                            }}
                        >
                            {scenarioBusy ? "Creating..." : "New Scenario"}
                        </button>
                    </div>

                    {scenarioMode === "scenario" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                <select
                                    value={selectedScenarioId}
                                    onChange={(e) => setSelectedScenarioId(e.target.value)}
                                    style={{
                                        minWidth: "240px",
                                        flex: "1 1 240px",
                                        background: "#0F1520",
                                        border: "1px solid #20252E",
                                        borderRadius: "8px",
                                        color: "#C9D1D9",
                                        fontSize: "11px",
                                        padding: "6px 8px",
                                        outline: "none",
                                        cursor: "pointer",
                                    }}
                                >
                                    <option value="">Select a scenario...</option>
                                    {scenarios.map((scenario) => (
                                        <option key={scenario.id} value={scenario.id}>
                                            {scenario.name} · {scenario.goals.length} goals
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {selectedScenario ? (
                                <div style={{
                                    padding: "8px 10px",
                                    borderRadius: "8px",
                                    background: "rgba(157,123,255,0.06)",
                                    border: "1px solid rgba(157,123,255,0.12)",
                                    fontSize: "11px",
                                    color: "#C9D1D9",
                                    lineHeight: 1.5,
                                }}>
                                    <div style={{ fontWeight: 700, marginBottom: "3px", color: "#E6EDF3" }}>
                                        {selectedScenario.name}
                                    </div>
                                    <div>{selectedScenario.description}</div>
                                    <div style={{ color: "#8B949E", marginTop: "4px" }}>
                                        App: {selectedScenario.app_name} · Goals: {selectedScenario.goals.length}
                                        {selectedScenarioGoal ? ` · First goal: ${selectedScenarioGoal.type}` : ""}
                                    </div>
                                    <div style={{ color: "#8B949E", marginTop: "2px" }}>
                                        The planner uses the first goal as context for scenario-based runs.
                                    </div>
                                </div>
                            ) : (
                                <div style={{ fontSize: "11px", color: "#6E7681", lineHeight: 1.5 }}>
                                    Create a starter scenario or refresh the library, then select one here.
                                </div>
                            )}
                        </div>
                    )}

                    {scenarioError && (
                        <div style={{
                            marginTop: "8px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            background: "rgba(248,81,73,0.07)",
                            border: "1px solid rgba(248,81,73,0.2)",
                            fontSize: "11px",
                            color: error,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}>
                            {scenarioError}
                        </div>
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
                                disabled={scenarioMode === "scenario" && !selectedScenario}
                                style={{
                                    border: `1px solid ${accent}55`,
                                    borderRadius: "8px",
                                    padding: "5px 14px",
                                    background: "rgba(157,123,255,0.1)",
                                    color: scenarioMode === "scenario" && !selectedScenario ? "#4a5568" : accent,
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: scenarioMode === "scenario" && !selectedScenario ? "not-allowed" : "pointer",
                                    transition: "background 0.15s",
                                    opacity: scenarioMode === "scenario" && !selectedScenario ? 0.6 : 1,
                                }}
                            >
                                {scenarioMode === "scenario" ? "▶ Start Scenario Run" : "▶ Start AI Test Run"}
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
