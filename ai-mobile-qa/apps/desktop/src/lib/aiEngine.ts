import { invoke } from "@tauri-apps/api/tauri";

export type PlannerMode = "reach_home" | "explore";

export type SessionBootstrapInput = {
    app_name: string;
    platform?: "android";
    max_steps: number;
    credentials: {
        email: string;
        password: string;
        optional_otp_note?: string | null;
    };
    home_markers: string[];
    flow_hints?: string[] | null;
    constraints?: Record<string, unknown>;
};

export type SessionBootstrapOutput = {
    run_goal: string;
    mode: PlannerMode;
    success_criteria: string[];
    stop_conditions: string[];
    risk_rules: string[];
};

export type RunStepInput = {
    step: number;
    screen_hash: string;
    ui_elements: Array<Record<string, unknown>>;
    screenshot_summary?: string | null;
    screenshot_b64?: string | null;

    last_action?: Record<string, unknown> | null;
    last_result?: string | null;

    mode: PlannerMode;
    seen_hash_counts: Record<string, number>;
    seen_element_keys: string[];
    recent_actions: Array<Record<string, unknown>>;
    failure_streak: number;
    loop_count: number;
    no_element_count: number;

    screen_size: { w: number; h: number } | { width: number; height: number };
    credentials?: Record<string, unknown> | null;

    runtime_signals?: Array<Record<string, unknown>>;
    overflow_detection?: Record<string, unknown>;
    prior_findings?: Array<Record<string, unknown>>;
};

export type RunStepOutput = {
    triage?: Record<string, unknown> | null;
    analysis: Record<string, unknown>;
    plan: Record<string, unknown>;
    critic: Record<string, unknown>;
    next_action: Record<string, unknown>;
    should_continue: boolean;
};

export async function aiSessionBootstrap(payload: SessionBootstrapInput): Promise<SessionBootstrapOutput> {
    return invoke<SessionBootstrapOutput>("ai_session_bootstrap_cmd", { payload });
}

export async function aiRunStep(payload: RunStepInput): Promise<RunStepOutput> {
    return invoke<RunStepOutput>("ai_run_step_cmd", { payload });
}
