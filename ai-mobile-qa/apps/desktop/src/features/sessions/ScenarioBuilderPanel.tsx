import { useState, useEffect, useCallback } from "react";
import {
    listScenarios,
    saveScenario,
    deleteScenario,
    validateAndSaveScenario,
} from "../../lib/scenarioStorage";
import type { SmokeScenario, ScenarioGoal, GoalType, GoalHints } from "../../types/scenario";

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG      = "#0D1117";
const SURFACE = "#080C12";
const CARD    = "#0F1420";
const CARD2   = "#141925";
const ACCENT  = "#9D7BFF";
const SUCCESS = "#3FB950";
const ERR     = "#F85149";
const WARN    = "#E3B341";
const BORDER  = "#1C2333";
const TEXT    = "#E6EDF3";
const MUTED   = "#8B949E";
const DIM     = "#6E7681";
const GHOST   = "#4a5568";

// ── Goal type metadata ────────────────────────────────────────────────────────
const GOAL_TYPE_META: Record<GoalType, { label: string; color: string; emoji: string; description: string }> = {
    login:          { label: "Login",          color: "#58A6FF", emoji: "🔐", description: "Complete login flow with credentials" },
    navigate:       { label: "Navigate",       color: SUCCESS,   emoji: "🧭", description: "Navigate to a specific screen" },
    form_fill:      { label: "Form Fill",      color: WARN,      emoji: "✏️",  description: "Fill and submit a form" },
    verify:         { label: "Verify",         color: ACCENT,    emoji: "✅", description: "Verify UI state without interaction" },
    explore_section:{ label: "Explore",        color: "#FF7B72", emoji: "🔍", description: "Explore a bounded section of the app" },
    custom:         { label: "Custom",         color: MUTED,     emoji: "⚙️",  description: "Free-form goal with custom logic" },
};

// ── Built-in templates (mirrors backend scenarios.json) ───────────────────────
const BUILT_IN_TEMPLATES: Array<{ id: string; name: string; description: string; emoji: string; goals: Partial<ScenarioGoal>[] }> = [
    {
        id: "tpl-basic-login", name: "Basic Login", emoji: "🔐",
        description: "Verify user can log in with valid credentials and reach home screen",
        goals: [{ id: "goal-1", description: "Complete login flow and reach home screen", type: "login",
            success_criteria: ["Screen type is 'home'", "User profile or account icon is visible", "No error messages displayed"],
            hints: { expected_screens: ["login", "home"], required_actions: ["input_text:email", "input_text:password", "tap:login_button"] } }],
    },
    {
        id: "tpl-login-logout", name: "Login → Logout", emoji: "🔄",
        description: "Complete login/logout cycle to verify authentication flow",
        goals: [
            { id: "goal-1", description: "Login with valid credentials", type: "login",
              success_criteria: ["Screen type is 'home'", "User is authenticated"],
              hints: { expected_screens: ["login", "home"] } },
            { id: "goal-2", description: "Navigate to account settings and logout", type: "navigate",
              success_criteria: ["Logout button is visible", "Successfully logged out", "Returned to login screen"],
              hints: { expected_screens: ["settings", "account", "login"], required_actions: ["tap:menu", "tap:logout"] } },
        ],
    },
    {
        id: "tpl-nav-tour", name: "Navigation Tour", emoji: "🗺️",
        description: "Visit all main sections of the app to verify navigation",
        goals: [
            { id: "goal-1", description: "Navigate to Home section", type: "navigate", success_criteria: ["Home screen is visible", "Main content loaded"], hints: { expected_screens: ["home"] } },
            { id: "goal-2", description: "Navigate to Explore section", type: "navigate", success_criteria: ["Explore screen is visible", "Content is displayed"], hints: { expected_screens: ["explore"] } },
            { id: "goal-3", description: "Navigate to Profile section", type: "navigate", success_criteria: ["Profile screen is visible", "User information displayed"], hints: { expected_screens: ["profile"] } },
            { id: "goal-4", description: "Navigate to Settings section", type: "navigate", success_criteria: ["Settings screen is visible", "Settings options are present"], hints: { expected_screens: ["settings"] } },
        ],
    },
    {
        id: "tpl-form-submission", name: "Form Submission", emoji: "📝",
        description: "Fill out and submit a form with validation",
        goals: [
            { id: "goal-1", description: "Navigate to form screen", type: "navigate", success_criteria: ["Form is visible", "All required fields are present"], hints: { expected_screens: ["home", "form"] } },
            { id: "goal-2", description: "Fill and submit form", type: "form_fill", success_criteria: ["All fields filled successfully", "Form submitted without errors", "Success confirmation displayed"], form_data: { name: "Test User", email: "test@example.com", message: "This is a test submission" } },
        ],
    },
    {
        id: "tpl-settings-verify", name: "Settings Verification", emoji: "⚙️",
        description: "Navigate to Settings and verify all options are present",
        goals: [
            { id: "goal-1", description: "Navigate to Settings screen", type: "navigate", success_criteria: ["Settings screen is visible", "Settings title displayed"], hints: { expected_screens: ["home", "settings"], required_actions: ["tap:menu", "tap:settings"] } },
            { id: "goal-2", description: "Verify all settings options are present", type: "verify", success_criteria: ["Account settings option visible", "Notification settings option visible", "Privacy settings option visible", "No overflow or rendering errors"] },
        ],
    },
    {
        id: "tpl-search-flow", name: "Search Flow", emoji: "🔍",
        description: "Perform search and verify results are displayed correctly",
        goals: [
            { id: "goal-1", description: "Navigate to search", type: "navigate", success_criteria: ["Search input is visible", "Search is ready for input"], hints: { expected_screens: ["home", "search"], required_actions: ["tap:search_icon"] } },
            { id: "goal-2", description: "Enter search query and view results", type: "custom", success_criteria: ["Search query entered", "Search results displayed", "Results are relevant", "No errors in results display"], hints: { required_actions: ["input_text:search", "tap:search_button"] } },
        ],
    },
    {
        id: "tpl-cart-checkout", name: "Cart Checkout", emoji: "🛒",
        description: "Add item to cart and complete checkout flow",
        goals: [
            { id: "goal-1", description: "Browse and select a product", type: "navigate", success_criteria: ["Product detail screen visible", "Add to cart button present"], hints: { expected_screens: ["home", "product_list", "product_detail"] } },
            { id: "goal-2", description: "Add product to cart", type: "custom", success_criteria: ["Product added to cart", "Cart icon shows item count", "Success message displayed"], hints: { required_actions: ["tap:add_to_cart"] } },
            { id: "goal-3", description: "Navigate to cart and checkout", type: "navigate", success_criteria: ["Cart screen visible", "Product appears in cart", "Checkout button present"], hints: { expected_screens: ["cart"] } },
        ],
    },
    {
        id: "tpl-profile-update", name: "Profile Update", emoji: "👤",
        description: "Navigate to profile, update user information, and save changes",
        goals: [
            { id: "goal-1", description: "Navigate to profile edit screen", type: "navigate", success_criteria: ["Profile edit form is visible", "Current profile data displayed"], hints: { expected_screens: ["home", "profile", "profile_edit"], required_actions: ["tap:profile", "tap:edit"] } },
            { id: "goal-2", description: "Update profile fields", type: "form_fill", success_criteria: ["All fields updated successfully", "Save button is enabled", "No validation errors"], form_data: { display_name: "Updated Test User", bio: "QA automation test profile", location: "Test City" } },
            { id: "goal-3", description: "Save changes and verify update", type: "verify", success_criteria: ["Changes saved successfully", "Success message displayed", "Profile updated with new information"], hints: { required_actions: ["tap:save_button"] } },
        ],
    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function newGoalId() { return `goal-${Date.now().toString(36)}`; }
function newScenarioId() { return `scenario-${Date.now().toString(36)}`; }

function makeBlankScenario(): SmokeScenario {
    return {
        id: newScenarioId(),
        name: "New Scenario",
        description: "",
        app_name: "",
        goals: [],
        constraints: { max_steps_per_goal: 20, timeout_seconds: 300, stop_on_first_failure: false },
    };
}

function makeBlankGoal(): ScenarioGoal {
    return { id: newGoalId(), description: "", type: "navigate", success_criteria: [""], hints: { expected_screens: [], required_actions: [], avoid_actions: [] } };
}

// ── Small reusable UI ─────────────────────────────────────────────────────────
function Btn({ onClick, children, color = ACCENT, disabled = false, small = false, danger = false }: {
    onClick: () => void; children: React.ReactNode; color?: string;
    disabled?: boolean; small?: boolean; danger?: boolean;
}) {
    const bg = danger ? "rgba(248,81,73,0.1)" : `rgba(${hexToRgb(color)},0.1)`;
    const border = danger ? ERR : color;
    return (
        <button onClick={onClick} disabled={disabled} style={{
            background: bg, border: `1px solid ${border}`,
            color: danger ? ERR : color, borderRadius: 7,
            padding: small ? "4px 10px" : "7px 16px",
            fontSize: small ? 11 : 12, fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            transition: "all 0.15s", outline: "none",
            display: "inline-flex", alignItems: "center", gap: 5,
        }}>
            {children}
        </button>
    );
}

function hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
}

function Label({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase", color: DIM, marginBottom: 5 }}>{children}</div>;
}

function Input({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
    return (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            style={{
                width: "100%", boxSizing: "border-box",
                background: "#090D14", border: `1px solid ${BORDER}`,
                color: TEXT, borderRadius: 7, padding: "7px 10px",
                fontSize: 12, outline: "none",
                transition: "border-color 0.15s",
            }}
            onFocus={e => { e.target.style.borderColor = ACCENT; }}
            onBlur={e => { e.target.style.borderColor = BORDER; }}
        />
    );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
    return (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
            style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                background: "#090D14", border: `1px solid ${BORDER}`,
                color: TEXT, borderRadius: 7, padding: "7px 10px",
                fontSize: 12, outline: "none", fontFamily: "inherit",
                transition: "border-color 0.15s",
            }}
            onFocus={e => { e.target.style.borderColor = ACCENT; }}
            onBlur={e => { e.target.style.borderColor = BORDER; }}
        />
    );
}

function GoalTypeBadge({ type }: { type: GoalType }) {
    const meta = GOAL_TYPE_META[type];
    return (
        <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
            background: `rgba(${hexToRgb(meta.color)},0.12)`,
            color: meta.color, letterSpacing: "0.3px",
        }}>
            {meta.emoji} {meta.label}
        </span>
    );
}

// ── Goal Editor Modal ─────────────────────────────────────────────────────────
function GoalEditorModal({ goal, onSave, onCancel }: {
    goal: ScenarioGoal;
    onSave: (g: ScenarioGoal) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState<ScenarioGoal>({ ...goal, hints: { ...goal.hints }, success_criteria: [...goal.success_criteria] });
    const [formDataRaw, setFormDataRaw] = useState(goal.form_data ? JSON.stringify(goal.form_data, null, 2) : "");

    const update = (patch: Partial<ScenarioGoal>) => setDraft(d => ({ ...d, ...patch }));
    const updateHints = (patch: Partial<GoalHints>) => setDraft(d => ({ ...d, hints: { ...d.hints, ...patch } }));

    const setCriterion = (i: number, val: string) => {
        const next = [...draft.success_criteria];
        next[i] = val;
        update({ success_criteria: next });
    };
    const addCriterion = () => update({ success_criteria: [...draft.success_criteria, ""] });
    const removeCriterion = (i: number) => update({ success_criteria: draft.success_criteria.filter((_, j) => j !== i) });

    const handleSave = () => {
        let form_data: Record<string, string> | undefined;
        if (formDataRaw.trim()) {
            try { form_data = JSON.parse(formDataRaw); } catch { form_data = undefined; }
        }
        onSave({ ...draft, form_data, success_criteria: draft.success_criteria.filter(c => c.trim()) });
    };

    const meta = GOAL_TYPE_META[draft.type];

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
                background: CARD, border: `1px solid ${BORDER}`,
                borderRadius: 14, padding: 24, width: 560, maxHeight: "80vh",
                overflow: "auto", display: "flex", flexDirection: "column", gap: 16,
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>{meta.emoji}</span>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Edit Goal</div>
                            <div style={{ fontSize: 11, color: DIM }}>{meta.description}</div>
                        </div>
                    </div>
                    <button onClick={onCancel} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
                </div>

                {/* Goal Type */}
                <div>
                    <Label>Goal Type</Label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(Object.keys(GOAL_TYPE_META) as GoalType[]).map(t => {
                            const m = GOAL_TYPE_META[t];
                            const active = draft.type === t;
                            return (
                                <button key={t} onClick={() => update({ type: t })} style={{
                                    padding: "5px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                                    border: `1px solid ${active ? m.color : BORDER}`,
                                    background: active ? `rgba(${hexToRgb(m.color)},0.14)` : "transparent",
                                    color: active ? m.color : MUTED, cursor: "pointer", outline: "none",
                                    transition: "all 0.13s",
                                }}>
                                    {m.emoji} {m.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Description */}
                <div>
                    <Label>Description</Label>
                    <Input value={draft.description} onChange={v => update({ description: v })} placeholder="What should the AI accomplish?" />
                </div>

                {/* Success Criteria */}
                <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <Label>Success Criteria</Label>
                        <Btn onClick={addCriterion} small color={SUCCESS}>+ Add</Btn>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {draft.success_criteria.map((c, i) => (
                            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <span style={{ color: SUCCESS, fontSize: 12, flexShrink: 0 }}>✓</span>
                                <Input value={c} onChange={v => setCriterion(i, v)} placeholder="e.g. Home screen is visible" />
                                <button onClick={() => removeCriterion(i)} style={{ background: "none", border: "none", color: ERR, cursor: "pointer", fontSize: 14, flexShrink: 0, padding: "0 4px" }}>✕</button>
                            </div>
                        ))}
                        {draft.success_criteria.length === 0 && (
                            <div style={{ color: GHOST, fontSize: 11, fontStyle: "italic" }}>No criteria yet — click "+ Add" to define when this goal is done.</div>
                        )}
                    </div>
                </div>

                {/* Start Screen Detection */}
                <div style={{ border: `1px solid #FF7B7255`, borderRadius: 9, padding: 12, display: "flex", flexDirection: "column", gap: 12, background: "rgba(255,123,114,0.03)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 14 }}>🎯</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#FF7B72", letterSpacing: "0.5px" }}>START SCREEN DETECTION</span>
                    </div>
                    <div style={{ fontSize: 11, color: GHOST, lineHeight: 1.5 }}>
                        The agent will verify it's on the correct screen before executing this goal.
                        If not found, it navigates there in <strong style={{ color: "#FF7B72" }}>max 4 steps</strong> using bottom nav or back.
                    </div>
                    <div>
                        <Label>Keywords to detect on screen (comma-separated)</Label>
                        <Input
                            value={(draft.start_screen_keywords ?? []).join(", ")}
                            onChange={v => update({ start_screen_keywords: v.split(",").map(s => s.trim()).filter(Boolean) })}
                            placeholder='e.g. Profile, Edit Profile, Update Info'
                        />
                        <div style={{ fontSize: 10, color: GHOST, marginTop: 4 }}>
                            Text visible on screen or in UI element labels. Match = correct screen found. ✓
                        </div>
                    </div>
                    <div>
                        <Label>Bottom Nav / Menu label to tap first (optional)</Label>
                        <Input
                            value={draft.start_nav_tap_label ?? ""}
                            onChange={v => update({ start_nav_tap_label: v.trim() || undefined })}
                            placeholder='e.g. Profile, Settings, Home, Me'
                        />
                        <div style={{ fontSize: 10, color: GHOST, marginTop: 4 }}>
                            If set, the agent taps this nav tab <em>first</em>, then verifies with keywords above.
                        </div>
                    </div>
                </div>

                {/* Hints */}
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 9, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.5px" }}>HINTS (optional)</div>
                    <div>
                        <Label>Expected Screens (comma-separated)</Label>
                        <Input
                            value={(draft.hints?.expected_screens ?? []).join(", ")}
                            onChange={v => updateHints({ expected_screens: v.split(",").map(s => s.trim()).filter(Boolean) })}
                            placeholder="e.g. login, home, dashboard"
                        />
                    </div>
                    <div>
                        <Label>Required Actions (comma-separated)</Label>
                        <Input
                            value={(draft.hints?.required_actions ?? []).join(", ")}
                            onChange={v => updateHints({ required_actions: v.split(",").map(s => s.trim()).filter(Boolean) })}
                            placeholder="e.g. input_text:email, tap:login_button"
                        />
                    </div>
                    <div>
                        <Label>Avoid Actions (comma-separated)</Label>
                        <Input
                            value={(draft.hints?.avoid_actions ?? []).join(", ")}
                            onChange={v => updateHints({ avoid_actions: v.split(",").map(s => s.trim()).filter(Boolean) })}
                            placeholder="e.g. back, swipe:up"
                        />
                    </div>
                </div>

                {/* Form Data (for form_fill) */}
                {draft.type === "form_fill" && (
                    <div>
                        <Label>Form Data (JSON)</Label>
                        <Textarea
                            value={formDataRaw}
                            onChange={setFormDataRaw}
                            placeholder={'{\n  "email": "user@example.com",\n  "password": "secret"\n}'}
                            rows={5}
                        />
                    </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
                    <Btn onClick={onCancel} color={MUTED}>Cancel</Btn>
                    <Btn onClick={handleSave} color={ACCENT}>Save Goal</Btn>
                </div>
            </div>
        </div>
    );
}

// ── Template Picker Modal ─────────────────────────────────────────────────────
function TemplatePickerModal({ onPick, onCancel }: {
    onPick: (tpl: typeof BUILT_IN_TEMPLATES[number]) => void;
    onCancel: () => void;
}) {
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
                background: CARD, border: `1px solid ${BORDER}`,
                borderRadius: 14, padding: 24, width: 600, maxHeight: "75vh",
                overflow: "auto", display: "flex", flexDirection: "column", gap: 16,
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Choose a Template</div>
                        <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>Start from a pre-built scenario and customize it</div>
                    </div>
                    <button onClick={onCancel} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 18 }}>✕</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {BUILT_IN_TEMPLATES.map(tpl => (
                        <button key={tpl.id} onClick={() => onPick(tpl)} style={{
                            background: CARD2, border: `1px solid ${BORDER}`,
                            borderRadius: 10, padding: "12px 14px",
                            textAlign: "left", cursor: "pointer", outline: "none",
                            transition: "all 0.15s",
                        }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = ACCENT; (e.currentTarget as HTMLElement).style.background = "rgba(157,123,255,0.06)"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = BORDER; (e.currentTarget as HTMLElement).style.background = CARD2; }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 18 }}>{tpl.emoji}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{tpl.name}</span>
                            </div>
                            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4, marginBottom: 8 }}>{tpl.description}</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {tpl.goals.map((g, i) => (
                                    <GoalTypeBadge key={i} type={(g.type ?? "custom") as GoalType} />
                                ))}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props {
    onRunScenario?: (scenario: SmokeScenario) => void;
}

export default function ScenarioBuilderPanel({ onRunScenario }: Props) {
    const [scenarios, setScenarios]           = useState<SmokeScenario[]>([]);
    const [selectedId, setSelectedId]         = useState<string | null>(null);
    const [draft, setDraft]                   = useState<SmokeScenario | null>(null);
    const [loading, setLoading]               = useState(false);
    const [saving, setSaving]                 = useState(false);
    const [saveError, setSaveError]           = useState<string | null>(null);
    const [saveOk, setSaveOk]                 = useState(false);
    const [editingGoal, setEditingGoal]       = useState<ScenarioGoal | null>(null);
    const [editingGoalIdx, setEditingGoalIdx] = useState<number | null>(null);
    const [showTemplates, setShowTemplates]   = useState(false);
    const [confirmDelete, setConfirmDelete]   = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listScenarios();
            const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
            setScenarios(sorted);
            if (selectedId && !sorted.find(s => s.id === selectedId)) {
                setSelectedId(sorted[0]?.id ?? null);
                setDraft(sorted[0] ?? null);
            } else if (!selectedId && sorted.length > 0) {
                setSelectedId(sorted[0].id);
                setDraft(JSON.parse(JSON.stringify(sorted[0])));
            }
        } catch { /* silent */ }
        finally { setLoading(false); }
    }, [selectedId]);

    useEffect(() => { void refresh(); }, []);

    const selectScenario = (s: SmokeScenario) => {
        setSelectedId(s.id);
        setDraft(JSON.parse(JSON.stringify(s)));
        setSaveError(null);
        setSaveOk(false);
        setConfirmDelete(false);
    };

    const handleNew = () => {
        const blank = makeBlankScenario();
        setDraft(blank);
        setSelectedId(blank.id);
        setSaveError(null);
        setSaveOk(false);
    };

    const handleFromTemplate = (tpl: typeof BUILT_IN_TEMPLATES[number]) => {
        setShowTemplates(false);
        const scenario: SmokeScenario = {
            id: newScenarioId(),
            name: tpl.name,
            description: tpl.description,
            app_name: "",
            goals: tpl.goals.map((g, i) => ({
                id: g.id ?? `goal-${i + 1}`,
                description: g.description ?? "",
                type: (g.type ?? "custom") as GoalType,
                success_criteria: g.success_criteria ?? [],
                hints: g.hints,
                form_data: g.form_data,
            })),
            constraints: { max_steps_per_goal: 20, timeout_seconds: 300, stop_on_first_failure: false },
        };
        setDraft(scenario);
        setSelectedId(scenario.id);
        setSaveError(null);
        setSaveOk(false);
    };

    const handleSave = async () => {
        if (!draft) return;
        setSaving(true);
        setSaveError(null);
        setSaveOk(false);
        try {
            await validateAndSaveScenario(draft);
            setSaveOk(true);
            await refresh();
            setTimeout(() => setSaveOk(false), 2500);
        } catch (err) {
            setSaveError(String(err));
        } finally {
            setSaving(false);
        }
    };

    const handleRun = async () => {
        if (!draft || !onRunScenario) return;

        setSaveError(null);
        setSaveOk(false);
        try {
            // Run should always target a persisted, valid scenario.
            await validateAndSaveScenario(draft);
            await refresh();
            setSaveOk(true);
            onRunScenario(draft);
        } catch (err) {
            setSaveError(String(err));
        }
    };

    const handleDelete = async () => {
        if (!draft) return;
        try {
            await deleteScenario(draft.id);
            setDraft(null);
            setSelectedId(null);
            setConfirmDelete(false);
            await refresh();
        } catch (err) {
            setSaveError(String(err));
        }
    };

    const updateDraft = (patch: Partial<SmokeScenario>) => {
        setDraft(d => d ? { ...d, ...patch } : d);
        setSaveOk(false);
    };

    // Goal ops
    const openNewGoal = () => {
        setEditingGoal(makeBlankGoal());
        setEditingGoalIdx(null);
    };
    const openEditGoal = (g: ScenarioGoal, idx: number) => {
        setEditingGoal({ ...g });
        setEditingGoalIdx(idx);
    };
    const saveGoal = (g: ScenarioGoal) => {
        if (!draft) return;
        const goals = [...draft.goals];
        if (editingGoalIdx !== null) { goals[editingGoalIdx] = g; } else { goals.push(g); }
        updateDraft({ goals });
        setEditingGoal(null);
        setEditingGoalIdx(null);
    };
    const deleteGoal = (idx: number) => {
        if (!draft) return;
        updateDraft({ goals: draft.goals.filter((_, i) => i !== idx) });
    };
    const moveGoal = (idx: number, dir: -1 | 1) => {
        if (!draft) return;
        const goals = [...draft.goals];
        const target = idx + dir;
        if (target < 0 || target >= goals.length) return;
        [goals[idx], goals[target]] = [goals[target], goals[idx]];
        updateDraft({ goals });
    };

    const isDirty = draft && !scenarios.find(s => s.id === draft.id && JSON.stringify(s) === JSON.stringify(draft));
    const isNew   = draft && !scenarios.find(s => s.id === draft.id);

    return (
        <div style={{
            display: "flex", height: "100%", minHeight: 0, background: BG,
            fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
        }}>
            {/* Modals */}
            {editingGoal && (
                <GoalEditorModal
                    goal={editingGoal}
                    onSave={saveGoal}
                    onCancel={() => { setEditingGoal(null); setEditingGoalIdx(null); }}
                />
            )}
            {showTemplates && (
                <TemplatePickerModal onPick={handleFromTemplate} onCancel={() => setShowTemplates(false)} />
            )}

            {/* ── LEFT: Scenario Library ── */}
            <div style={{
                width: 240, flexShrink: 0,
                background: SURFACE, borderRight: `1px solid ${BORDER}`,
                display: "flex", flexDirection: "column", overflow: "hidden",
            }}>
                {/* Header */}
                <div style={{ padding: "14px 14px 10px", borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: GHOST, marginBottom: 10 }}>
                        Scenario Library
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={handleNew} title="New blank scenario" style={{
                            flex: 1, padding: "6px 0", borderRadius: 7, border: `1px solid ${BORDER}`,
                            background: "rgba(157,123,255,0.08)", color: ACCENT,
                            fontSize: 11, fontWeight: 600, cursor: "pointer", outline: "none",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                        }}>
                            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> New
                        </button>
                        <button onClick={() => setShowTemplates(true)} title="Start from template" style={{
                            flex: 1, padding: "6px 0", borderRadius: 7, border: `1px solid ${BORDER}`,
                            background: "transparent", color: MUTED,
                            fontSize: 11, fontWeight: 600, cursor: "pointer", outline: "none",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                        }}>
                            <span style={{ fontSize: 12 }}>📋</span> Template
                        </button>
                    </div>
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
                    {loading && (
                        <div style={{ padding: "16px", color: MUTED, fontSize: 11, textAlign: "center" }}>Loading…</div>
                    )}
                    {!loading && scenarios.length === 0 && !draft && (
                        <div style={{ padding: "20px 14px", color: GHOST, fontSize: 11, textAlign: "center", lineHeight: 1.6 }}>
                            No scenarios yet.<br />Click <strong style={{ color: ACCENT }}>+ New</strong> or pick a <strong style={{ color: MUTED }}>Template</strong> to get started.
                        </div>
                    )}
                    {scenarios.map(s => {
                        const active = selectedId === s.id;
                        return (
                            <button key={s.id} onClick={() => selectScenario(s)} style={{
                                width: "100%", textAlign: "left", padding: "9px 14px",
                                borderTop: "none", borderRight: "none", borderBottom: "none",
                                borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
                                background: active ? "rgba(157,123,255,0.09)" : "transparent",
                                cursor: "pointer", outline: "none", transition: "all 0.12s",
                            }}>
                                <div style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? TEXT : MUTED, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {s.name}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 10, color: DIM }}>{s.goals.length} goal{s.goals.length !== 1 ? "s" : ""}</span>
                                    {s.app_name && <span style={{ fontSize: 10, color: GHOST, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {s.app_name}</span>}
                                </div>
                            </button>
                        );
                    })}
                    {/* unsaved new scenario in list */}
                    {draft && isNew && (
                        <button style={{
                            width: "100%", textAlign: "left", padding: "9px 14px",
                            borderTop: "none", borderRight: "none", borderBottom: "none",
                            borderLeft: `2px solid ${ACCENT}`,
                            background: "rgba(157,123,255,0.09)",
                            cursor: "pointer", outline: "none",
                        }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: ACCENT, marginBottom: 2 }}>{draft.name || "Untitled"}</div>
                            <div style={{ fontSize: 10, color: WARN }}>● unsaved</div>
                        </button>
                    )}
                </div>
            </div>

            {/* ── RIGHT: Editor ── */}
            {!draft ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: GHOST }}>
                    <div style={{ fontSize: 48 }}>📋</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: MUTED }}>No Scenario Selected</div>
                    <div style={{ fontSize: 12, color: GHOST, textAlign: "center", maxWidth: 300, lineHeight: 1.6 }}>
                        Create a new scenario or pick a template to define a test flow for the AI agent.
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                        <Btn onClick={handleNew} color={ACCENT}>+ New Scenario</Btn>
                        <Btn onClick={() => setShowTemplates(true)} color={MUTED}>📋 Use Template</Btn>
                    </div>
                </div>
            ) : (
                <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>

                    {/* ── Top bar ── */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>
                                {draft.name || <span style={{ color: GHOST }}>Untitled Scenario</span>}
                            </div>
                            {isNew && <span style={{ fontSize: 10, color: WARN, background: "rgba(227,179,65,0.1)", border: "1px solid rgba(227,179,65,0.3)", borderRadius: 4, padding: "2px 7px", fontWeight: 700 }}>UNSAVED</span>}
                            {!isNew && isDirty && <span style={{ fontSize: 10, color: ACCENT, background: "rgba(157,123,255,0.1)", border: `1px solid rgba(157,123,255,0.3)`, borderRadius: 4, padding: "2px 7px", fontWeight: 700 }}>MODIFIED</span>}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {saveOk && <span style={{ fontSize: 11, color: SUCCESS }}>✓ Saved</span>}
                            {saveError && <span style={{ fontSize: 11, color: ERR, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={saveError}>⚠ {saveError}</span>}
                            {onRunScenario && (
                                <Btn onClick={handleRun} color={SUCCESS} disabled={!draft.goals.length || !draft.app_name.trim()}>
                                    ▶ Run
                                </Btn>
                            )}
                            <Btn onClick={handleSave} color={ACCENT} disabled={saving}>
                                {saving ? "Saving…" : "💾 Save"}
                            </Btn>
                            {!isNew && !confirmDelete && (
                                <Btn onClick={() => setConfirmDelete(true)} danger small>🗑</Btn>
                            )}
                            {confirmDelete && (
                                <>
                                    <span style={{ fontSize: 11, color: ERR }}>Delete?</span>
                                    <Btn onClick={handleDelete} danger small>Yes</Btn>
                                    <Btn onClick={() => setConfirmDelete(false)} color={MUTED} small>No</Btn>
                                </>
                            )}
                        </div>
                    </div>

                    {/* ── Scenario Metadata ── */}
                    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.5px" }}>SCENARIO INFO</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                            <div>
                                <Label>Scenario Name</Label>
                                <Input value={draft.name} onChange={v => updateDraft({ name: v })} placeholder="e.g. Login → Home Screen" />
                            </div>
                            <div>
                                <Label>App Package / Name</Label>
                                <Input value={draft.app_name} onChange={v => updateDraft({ app_name: v })} placeholder="e.g. com.myapp.package" />
                            </div>
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Textarea value={draft.description} onChange={v => updateDraft({ description: v })} placeholder="What does this scenario test?" rows={2} />
                        </div>
                    </div>

                    {/* ── Credentials (shown when any goal is login type) ── */}
                    {draft.goals.some(g => g.type === "login") && (
                        <div style={{ background: CARD, border: `1px solid #58A6FF33`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span>🔐</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#58A6FF", letterSpacing: "0.5px" }}>LOGIN CREDENTIALS</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                                <div>
                                    <Label>Email / Username</Label>
                                    <Input
                                        value={draft.credentials?.email ?? ""}
                                        onChange={v => updateDraft({ credentials: { email: v, password: draft.credentials?.password ?? "" } })}
                                        placeholder="user@example.com"
                                    />
                                </div>
                                <div>
                                    <Label>Password</Label>
                                    <Input
                                        type="password"
                                        value={draft.credentials?.password ?? ""}
                                        onChange={v => updateDraft({ credentials: { email: draft.credentials?.email ?? "", password: v } })}
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Goals ── */}
                    <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Goals</div>
                                <div style={{ fontSize: 11, color: GHOST, marginTop: 2 }}>The AI executes these in order. Each must be completed before the next begins.</div>
                            </div>
                            <Btn onClick={openNewGoal} color={SUCCESS}>+ Add Goal</Btn>
                        </div>

                        {draft.goals.length === 0 && (
                            <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 12, padding: "28px 20px", textAlign: "center", color: GHOST }}>
                                <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 4 }}>No Goals Yet</div>
                                <div style={{ fontSize: 11, color: GHOST, marginBottom: 14 }}>Add at least one goal to define what the AI should accomplish.</div>
                                <Btn onClick={openNewGoal} color={SUCCESS}>+ Add First Goal</Btn>
                            </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {draft.goals.map((g, idx) => {
                                const meta = GOAL_TYPE_META[g.type];
                                return (
                                    <div key={g.id} style={{
                                        background: CARD, border: `1px solid ${BORDER}`,
                                        borderRadius: 11, padding: "14px 16px",
                                        display: "flex", alignItems: "flex-start", gap: 12,
                                        transition: "border-color 0.15s",
                                    }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = meta.color + "55"; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = BORDER; }}
                                    >
                                        {/* Step number */}
                                        <div style={{
                                            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                                            background: `rgba(${hexToRgb(meta.color)},0.15)`,
                                            border: `1px solid ${meta.color}55`,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            fontSize: 11, fontWeight: 700, color: meta.color,
                                        }}>
                                            {idx + 1}
                                        </div>

                                        {/* Content */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                                                <GoalTypeBadge type={g.type} />
                                                <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>{g.description || <span style={{ color: GHOST, fontStyle: "italic" }}>No description</span>}</span>
                                            </div>
                                            {g.success_criteria.length > 0 && (
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                                                    {g.success_criteria.slice(0, 3).map((c, i) => (
                                                        <span key={i} style={{ fontSize: 10, color: SUCCESS, background: "rgba(63,185,80,0.08)", border: "1px solid rgba(63,185,80,0.2)", borderRadius: 4, padding: "2px 7px" }}>✓ {c}</span>
                                                    ))}
                                                    {g.success_criteria.length > 3 && (
                                                        <span style={{ fontSize: 10, color: GHOST, padding: "2px 4px" }}>+{g.success_criteria.length - 3} more</span>
                                                    )}
                                                </div>
                                            )}
                                            {g.hints?.expected_screens && g.hints.expected_screens.length > 0 && (
                                                <div style={{ fontSize: 10, color: DIM, marginTop: 5 }}>
                                                    🧭 Screens: {g.hints.expected_screens.join(" → ")}
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                                            <button onClick={() => moveGoal(idx, -1)} disabled={idx === 0} style={{ background: "none", border: "none", color: idx === 0 ? GHOST : MUTED, cursor: idx === 0 ? "default" : "pointer", fontSize: 13, padding: "2px 4px" }}>↑</button>
                                            <button onClick={() => moveGoal(idx, 1)} disabled={idx === draft.goals.length - 1} style={{ background: "none", border: "none", color: idx === draft.goals.length - 1 ? GHOST : MUTED, cursor: idx === draft.goals.length - 1 ? "default" : "pointer", fontSize: 13, padding: "2px 4px" }}>↓</button>
                                            <button onClick={() => openEditGoal(g, idx)} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 5, cursor: "pointer", fontSize: 11, padding: "3px 8px", outline: "none" }}>Edit</button>
                                            <button onClick={() => deleteGoal(idx)} style={{ background: "none", border: "none", color: ERR, cursor: "pointer", fontSize: 13, padding: "2px 4px" }}>✕</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Constraints ── */}
                    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.5px" }}>CONSTRAINTS</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                            <div>
                                <Label>Max Steps / Goal</Label>
                                <Input
                                    value={String(draft.constraints?.max_steps_per_goal ?? 20)}
                                    onChange={v => updateDraft({ constraints: { ...draft.constraints, max_steps_per_goal: parseInt(v) || 20 } })}
                                />
                            </div>
                            <div>
                                <Label>Timeout (seconds)</Label>
                                <Input
                                    value={String(draft.constraints?.timeout_seconds ?? 300)}
                                    onChange={v => updateDraft({ constraints: { ...draft.constraints, timeout_seconds: parseInt(v) || 300 } })}
                                />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <Label>Stop on First Failure</Label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", paddingTop: 4 }}>
                                    <input
                                        type="checkbox"
                                        checked={draft.constraints?.stop_on_first_failure ?? false}
                                        onChange={e => updateDraft({ constraints: { ...draft.constraints, stop_on_first_failure: e.target.checked } })}
                                        style={{ accentColor: ACCENT, width: 14, height: 14 }}
                                    />
                                    <span style={{ fontSize: 12, color: TEXT }}>Enabled</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Bottom pad */}
                    <div style={{ height: 20 }} />
                </div>
            )}
        </div>
    );
}
