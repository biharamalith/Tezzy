/**
 * Scenario Type Definitions for AI-Assisted Smoke Testing
 * 
 * This file defines the core types for scenario-based testing in Tezzy.
 * Scenarios provide structured test flows with explicit goals and success criteria.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Goal Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported goal types for scenario testing
 */
export type GoalType =
  | "login"           // Complete login flow with credentials
  | "navigate"        // Navigate to a specific screen
  | "form_fill"       // Fill and submit a form
  | "verify"          // Verify UI state without interaction
  | "explore_section" // Explore a bounded section of the app
  | "custom";         // Free-form goal with custom logic

/**
 * Goal status during execution
 */
export type GoalStatus = "not_started" | "in_progress" | "completed" | "failed";

/**
 * Action execution result
 */
export type ActionResult = "ok" | "failed" | "dead_tap" | "loop" | "stopped";

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Goal Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hints to guide the AI during goal execution
 */
export interface GoalHints {
  /** Expected screen types to visit (e.g., ["login", "home"]) */
  expected_screens?: string[];
  
  /** Required actions to perform (e.g., ["input_text:email", "tap:login_button"]) */
  required_actions?: string[];
  
  /** Actions to avoid (e.g., ["back", "swipe:up"]) */
  avoid_actions?: string[];
}

/**
 * A single goal within a scenario
 */
export interface ScenarioGoal {
  /** Unique identifier for this goal */
  id: string;
  
  /** Natural language description of the goal */
  description: string;
  
  /** Type of goal (determines AI behavior) */
  type: GoalType;
  
  /** Success criteria that must be met for goal completion */
  success_criteria: string[];
  
  /** Optional hints to guide the AI */
  hints?: GoalHints;
  
  /** Form data for form_fill goals (field name -> value) */
  form_data?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Credentials for login scenarios
 */
export interface ScenarioCredentials {
  email: string;
  password: string;
}

/**
 * Global constraints for scenario execution
 */
export interface ScenarioConstraints {
  /** Maximum steps allowed per goal */
  max_steps_per_goal?: number;
  
  /** Timeout in seconds for the entire scenario */
  timeout_seconds?: number;
  
  /** Whether to stop execution on first goal failure */
  stop_on_first_failure?: boolean;
}

/**
 * A complete test scenario definition
 */
export interface SmokeScenario {
  /** Unique identifier for this scenario */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Detailed description of what this scenario tests */
  description: string;
  
  /** Name of the app being tested */
  app_name: string;
  
  /** Optional credentials for login scenarios */
  credentials?: ScenarioCredentials;
  
  /** Sequential goals that define the test flow */
  goals: ScenarioGoal[];
  
  /** Optional global constraints */
  constraints?: ScenarioConstraints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal Progress Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record of a single action execution
 */
export interface ActionRecord {
  /** Step number when action was executed */
  step: number;
  
  /** Action details (type and params) */
  action: {
    type: string;
    params: Record<string, unknown>;
  };
  
  /** Screen hash when action was executed */
  screen_hash: string;
  
  /** Result of action execution */
  result: ActionResult;
  
  /** Whether this action contributed to goal progress */
  contributed_to_goal: boolean;
  
  /** Optional error message if action failed */
  error_message?: string;
}

/**
 * Finding detected during goal execution
 */
export interface SmokeFinding {
  /** Step number when finding was detected */
  step: number;
  
  /** Severity level */
  severity: "error" | "warn" | "info";
  
  /** Description of the finding */
  message: string;
  
  /** Optional goal ID this finding is associated with */
  goal_id?: string;
  
  /** Whether this finding blocks goal completion */
  blocks_goal?: boolean;
}

/**
 * Progress tracking for a single goal
 */
export interface GoalProgress {
  /** Goal identifier */
  goal_id: string;
  
  /** Current status */
  status: GoalStatus;
  
  /** Number of steps taken for this goal */
  steps_taken: number;
  
  /** Success criteria that have been satisfied */
  success_criteria_met: string[];
  
  /** Success criteria still pending */
  success_criteria_pending: string[];
  
  /** Findings detected during this goal */
  findings: SmokeFinding[];
  
  /** Screenshots captured during this goal */
  screenshots: string[];
  
  /** Log of all actions executed for this goal */
  actions_log: ActionRecord[];
  
  /** Timestamp when goal started */
  started_at?: number;
  
  /** Timestamp when goal completed/failed */
  completed_at?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Execution State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete execution state for a scenario run
 */
export interface ScenarioExecutionState {
  /** Unique run identifier */
  run_id: string;
  
  /** The scenario being executed */
  scenario: SmokeScenario;
  
  /** Index of the current goal being executed */
  current_goal_index: number;
  
  /** Progress tracking for each goal */
  goal_progress: Map<string, GoalProgress>;
  
  // ─── Enhanced Memory Tracking (fixes current issues) ───
  
  /** Persistent set of tapped element keys (resource_id::bounds) */
  seen_element_keys: Set<string>;
  
  /** Count of how many times each screen hash has been seen */
  seen_hash_counts: Map<string, number>;
  
  /** Set of screen hashes that have been fully explored */
  completed_screens: Set<string>;
  
  /** Counter that increments when revisiting same screen */
  loop_count: number;
  
  /** Counter for consecutive steps with no interactive elements */
  no_element_count: number;
  
  // ─── Action History ───
  
  /** Last 10 action records */
  recent_actions: ActionRecord[];
  
  /** Consecutive action execution failures */
  failure_streak: number;
  
  // ─── Scenario-Specific Tracking ───
  
  /** Number of goals completed successfully */
  goals_completed: number;
  
  /** Number of goals that failed */
  goals_failed: number;
  
  /** All findings across all goals */
  total_findings: SmokeFinding[];
  
  // ─── Mode Tracking ───
  
  /** Current execution mode */
  mode: "reach_home" | "explore" | "goal_directed";
  
  /** Login step progress (0=not started, 1=email entered, 2=password entered, 3=submitted) */
  login_step: 0 | 1 | 2 | 3;
  
  /** Timestamp when execution started */
  started_at: number;
  
  /** Timestamp when execution completed (if finished) */
  completed_at?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of scenario validation
 */
export interface ValidationResult {
  /** Whether the scenario is valid */
  valid: boolean;
  
  /** List of validation errors */
  errors: string[];
  
  /** List of validation warnings */
  warnings: string[];
  
  /** Estimated number of steps for this scenario */
  estimated_steps?: number;
  
  /** Estimated duration in seconds */
  estimated_duration_seconds?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Execution Results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Summary of scenario execution results
 */
export interface ScenarioExecutionResult {
  /** Run identifier */
  run_id: string;
  
  /** Scenario that was executed */
  scenario: SmokeScenario;
  
  /** Overall status */
  status: "pass" | "fail" | "partial";
  
  /** Results for each goal */
  goal_results: GoalProgress[];
  
  /** Total steps executed */
  total_steps: number;
  
  /** Total duration in seconds */
  total_duration_seconds: number;
  
  /** All findings from the run */
  findings: SmokeFinding[];
  
  /** Coverage percentage (goals completed / total goals) */
  coverage_percentage: number;
  
  /** Timestamp when execution started */
  started_at: number;
  
  /** Timestamp when execution completed */
  completed_at: number;
}
