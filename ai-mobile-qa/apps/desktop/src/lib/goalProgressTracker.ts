/**
 * Goal Progress Tracker
 * 
 * Manages goal progress tracking for scenario execution.
 * Implements requirements 4.1-4.4 from the requirements document.
 */

import type { SmokeScenario, ScenarioGoal, GoalProgress, GoalStatus, SmokeFinding, ActionRecord } from "../types/scenario";

/**
 * Initialize goal progress tracking for all goals in a scenario
 * 
 * @param goals - Array of scenario goals to track
 * @returns Map of goal_id to GoalProgress
 */
export function initializeGoalProgress(goals: ScenarioGoal[]): Map<string, GoalProgress> {
  const progressMap = new Map<string, GoalProgress>();

  for (const goal of goals) {
    const progress: GoalProgress = {
      goal_id: goal.id,
      status: "not_started",
      steps_taken: 0,
      success_criteria_met: [],
      success_criteria_pending: [...goal.success_criteria], // Copy all criteria as pending
      findings: [],
      screenshots: [],
      actions_log: [],
    };

    progressMap.set(goal.id, progress);
  }

  return progressMap;
}

/**
 * Update goal progress with partial updates
 * 
 * @param progressMap - Map of goal progress to update
 * @param goalId - ID of the goal to update
 * @param update - Partial updates to apply
 */
export function updateGoalProgress(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  update: Partial<GoalProgress>
): void {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    console.warn(`Goal progress not found for goal_id: ${goalId}`);
    return;
  }

  // Apply updates
  Object.assign(progress, update);

  // Update timestamps based on status changes
  if (update.status === "in_progress" && !progress.started_at) {
    progress.started_at = Date.now();
  }

  if ((update.status === "completed" || update.status === "failed") && !progress.completed_at) {
    progress.completed_at = Date.now();
  }
}

/**
 * Screen state for success criteria evaluation
 */
export interface ScreenState {
  /** Current screen hash */
  screen_hash: string;
  
  /** UI elements on current screen */
  ui_elements: Array<Record<string, unknown>>;
  
  /** Screenshot summary from vision analysis */
  screenshot_summary?: string | null;
  
  /** Last action executed */
  last_action?: Record<string, unknown> | null;
  
  /** Last action result */
  last_result?: string | null;
}

/**
 * Evaluate which success criteria have been met based on current screen state
 * 
 * This is a heuristic evaluation that checks:
 * - Screen hash matches expected screens (if provided in hints)
 * - UI elements contain expected text/IDs
 * - Screenshot summary mentions success indicators
 * - Action results indicate success
 * 
 * @param goal - The goal being evaluated
 * @param screenState - Current screen state
 * @returns Array of success criteria that appear to be met
 */
export function evaluateSuccessCriteria(
  goal: ScenarioGoal,
  screenState: ScreenState
): string[] {
  const metCriteria: string[] = [];

  for (const criterion of goal.success_criteria) {
    if (isCriterionMet(criterion, goal, screenState)) {
      metCriteria.push(criterion);
    }
  }

  return metCriteria;
}

/**
 * Check if a single success criterion is met
 * 
 * @param criterion - Success criterion to check
 * @param goal - The goal being evaluated
 * @param screenState - Current screen state
 * @returns true if criterion appears to be met
 */
function isCriterionMet(
  criterion: string,
  goal: ScenarioGoal,
  screenState: ScreenState
): boolean {
  const lowerCriterion = criterion.toLowerCase();

  // Check if criterion mentions expected screens from hints
  if (goal.hints?.expected_screens) {
    for (const expectedScreen of goal.hints.expected_screens) {
      if (lowerCriterion.includes(expectedScreen.toLowerCase())) {
        // Check if current screen hash or UI elements suggest we're on this screen
        if (isOnExpectedScreen(expectedScreen, screenState)) {
          return true;
        }
      }
    }
  }

  // Check UI elements for text/IDs that match the criterion
  if (checkUiElementsForCriterion(lowerCriterion, screenState.ui_elements)) {
    return true;
  }

  // Check screenshot summary for criterion keywords
  if (screenState.screenshot_summary) {
    const lowerSummary = screenState.screenshot_summary.toLowerCase();
    // Extract key words from criterion (ignore common words)
    const keywords = extractKeywords(lowerCriterion);
    const matchCount = keywords.filter(kw => lowerSummary.includes(kw)).length;
    
    // If most keywords are present, consider criterion met
    if (keywords.length > 0 && matchCount / keywords.length >= 0.6) {
      return true;
    }
  }

  // Check if last action result indicates success for this goal type
  if (goal.type === "login" && lowerCriterion.includes("logged in")) {
    // Login success is indicated by successful action + not on login screen anymore
    if (screenState.last_result === "ok" && !isOnLoginScreen(screenState)) {
      return true;
    }
  }

  if (goal.type === "form_fill" && lowerCriterion.includes("submitted")) {
    // Form submission success indicated by successful action
    if (screenState.last_result === "ok") {
      return true;
    }
  }

  return false;
}

/**
 * Check if current screen matches an expected screen name
 */
function isOnExpectedScreen(expectedScreen: string, screenState: ScreenState): boolean {
  const lowerExpected = expectedScreen.toLowerCase();
  
  // Check UI elements for screen indicators
  for (const el of screenState.ui_elements) {
    const text = String(el.text ?? "").toLowerCase();
    const contentDesc = String(el.content_desc ?? "").toLowerCase();
    const resourceId = String(el.resource_id ?? "").toLowerCase();
    
    if (text.includes(lowerExpected) || 
        contentDesc.includes(lowerExpected) || 
        resourceId.includes(lowerExpected)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if UI elements contain text/IDs matching the criterion
 */
function checkUiElementsForCriterion(
  lowerCriterion: string,
  uiElements: Array<Record<string, unknown>>
): boolean {
  const keywords = extractKeywords(lowerCriterion);
  
  for (const el of uiElements) {
    const text = String(el.text ?? "").toLowerCase();
    const contentDesc = String(el.content_desc ?? "").toLowerCase();
    const resourceId = String(el.resource_id ?? "").toLowerCase();
    
    const combinedText = `${text} ${contentDesc} ${resourceId}`;
    
    // Check if multiple keywords are present
    const matchCount = keywords.filter(kw => combinedText.includes(kw)).length;
    if (keywords.length > 0 && matchCount / keywords.length >= 0.5) {
      return true;
    }
  }

  return false;
}

/**
 * Check if current screen appears to be a login screen
 */
function isOnLoginScreen(screenState: ScreenState): boolean {
  const loginKeywords = ["login", "sign in", "email", "password", "username"];
  
  let keywordCount = 0;
  for (const el of screenState.ui_elements) {
    const text = String(el.text ?? "").toLowerCase();
    const contentDesc = String(el.content_desc ?? "").toLowerCase();
    const resourceId = String(el.resource_id ?? "").toLowerCase();
    const hint = String(el.hint ?? "").toLowerCase();
    
    const combinedText = `${text} ${contentDesc} ${resourceId} ${hint}`;
    
    for (const keyword of loginKeywords) {
      if (combinedText.includes(keyword)) {
        keywordCount++;
        break; // Count each element only once
      }
    }
  }

  // If we find 2+ login-related elements, likely on login screen
  return keywordCount >= 2;
}

/**
 * Extract meaningful keywords from a criterion string
 * Filters out common words and returns significant terms
 */
function extractKeywords(text: string): string[] {
  const commonWords = new Set([
    "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "should", "could", "may", "might", "must", "can",
    "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "over",
    "user", "app", "screen", "page", "visible", "displayed", "shown",
  ]);

  return text
    .split(/\s+/)
    .map(word => word.replace(/[^a-z0-9]/g, ""))
    .filter(word => word.length > 2 && !commonWords.has(word));
}

/**
 * Mark a goal as started
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to start
 */
export function startGoal(progressMap: Map<string, GoalProgress>, goalId: string): void {
  updateGoalProgress(progressMap, goalId, {
    status: "in_progress",
    started_at: Date.now(),
  });
}

/**
 * Mark a goal as completed
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to complete
 */
export function completeGoal(progressMap: Map<string, GoalProgress>, goalId: string): void {
  updateGoalProgress(progressMap, goalId, {
    status: "completed",
    completed_at: Date.now(),
  });
}

/**
 * Mark a goal as failed
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal that failed
 */
export function failGoal(progressMap: Map<string, GoalProgress>, goalId: string): void {
  updateGoalProgress(progressMap, goalId, {
    status: "failed",
    completed_at: Date.now(),
  });
}

/**
 * Add an action to a goal's action log
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @param action - Action record to add
 */
export function logGoalAction(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  action: ActionRecord
): void {
  const progress = progressMap.get(goalId);
  if (!progress) return;

  progress.actions_log.push(action);
  progress.steps_taken++;
}

/**
 * Add a finding to a goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @param finding - Finding to add
 */
export function addGoalFinding(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  finding: SmokeFinding
): void {
  const progress = progressMap.get(goalId);
  if (!progress) return;

  progress.findings.push(finding);
}

/**
 * Add a screenshot to a goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @param screenshotPath - Path to the screenshot
 */
export function addGoalScreenshot(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  screenshotPath: string
): void {
  const progress = progressMap.get(goalId);
  if (!progress) return;

  progress.screenshots.push(screenshotPath);
}

/**
 * Get the current active goal (first goal that is in_progress or not_started)
 * 
 * @param progressMap - Map of goal progress
 * @param goals - Array of scenario goals in order
 * @returns The current active goal, or null if all goals are complete
 */
export function getCurrentGoal(
  progressMap: Map<string, GoalProgress>,
  goals: ScenarioGoal[]
): ScenarioGoal | null {
  for (const goal of goals) {
    const progress = progressMap.get(goal.id);
    if (!progress) continue;

    if (progress.status === "in_progress") {
      return goal;
    }

    if (progress.status === "not_started") {
      return goal;
    }
  }

  return null; // All goals completed or failed
}

/**
 * Check if all goals are completed
 * 
 * @param progressMap - Map of goal progress
 * @returns true if all goals have status "completed"
 */
export function areAllGoalsCompleted(progressMap: Map<string, GoalProgress>): boolean {
  for (const progress of progressMap.values()) {
    if (progress.status !== "completed") {
      return false;
    }
  }

  return progressMap.size > 0; // At least one goal must exist
}

/**
 * Check if any goal has failed
 * 
 * @param progressMap - Map of goal progress
 * @returns true if any goal has status "failed"
 */
export function hasAnyGoalFailed(progressMap: Map<string, GoalProgress>): boolean {
  for (const progress of progressMap.values()) {
    if (progress.status === "failed") {
      return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal Status Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark a goal as complete
 * 
 * Sets the goal status to "completed" and records completion timestamp.
 * Should be called when all success criteria have been met.
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to mark as complete
 */
export function markGoalComplete(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): void {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    console.warn(`Cannot mark goal as complete: goal_id ${goalId} not found`);
    return;
  }

  // Only mark as complete if currently in progress
  if (progress.status !== "in_progress") {
    console.warn(`Cannot mark goal as complete: goal ${goalId} is not in progress (status: ${progress.status})`);
    return;
  }

  updateGoalProgress(progressMap, goalId, {
    status: "completed",
    completed_at: Date.now(),
  });

  console.log(`Goal ${goalId} marked as completed after ${progress.steps_taken} steps`);
}

/**
 * Mark a goal as failed with a reason
 * 
 * Sets the goal status to "failed" and records completion timestamp.
 * Should be called when:
 * - Max steps exceeded for the goal
 * - Critical error occurred
 * - Goal cannot be completed
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to mark as failed
 * @param reason - Reason for failure (e.g., "max_steps_exceeded", "critical_error")
 */
export function markGoalFailed(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  reason: string
): void {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    console.warn(`Cannot mark goal as failed: goal_id ${goalId} not found`);
    return;
  }

  // Only mark as failed if not already completed
  if (progress.status === "completed") {
    console.warn(`Cannot mark goal as failed: goal ${goalId} is already completed`);
    return;
  }

  updateGoalProgress(progressMap, goalId, {
    status: "failed",
    completed_at: Date.now(),
  });

  // Add a finding to record the failure reason
  const failureFinding: SmokeFinding = {
    step: progress.steps_taken,
    severity: "error",
    message: `Goal "${goalId}" failed: ${reason}`,
  };

  addGoalFinding(progressMap, goalId, failureFinding);

  console.error(`Goal ${goalId} marked as failed: ${reason} (after ${progress.steps_taken} steps)`);
}

/**
 * Check and update goal status based on criteria evaluation
 * 
 * Evaluates the current goal's success criteria and updates status accordingly:
 * - Sets status to "completed" when all criteria are met
 * - Sets status to "failed" when max_steps exceeded or critical error
 * 
 * @param progressMap - Map of goal progress
 * @param goal - The goal being evaluated
 * @param screenState - Current screen state
 * @param maxStepsPerGoal - Maximum steps allowed per goal (optional)
 * @returns Updated goal status
 */
export function checkAndUpdateGoalStatus(
  progressMap: Map<string, GoalProgress>,
  goal: ScenarioGoal,
  screenState: ScreenState,
  maxStepsPerGoal?: number
): GoalStatus {
  const progress = progressMap.get(goal.id);
  
  if (!progress) {
    console.warn(`Cannot check goal status: goal_id ${goal.id} not found`);
    return "not_started";
  }

  // Skip if goal is already completed or failed
  if (progress.status === "completed" || progress.status === "failed") {
    return progress.status;
  }

  // Check if max steps exceeded
  if (maxStepsPerGoal && progress.steps_taken >= maxStepsPerGoal) {
    markGoalFailed(progressMap, goal.id, `max_steps_exceeded (${maxStepsPerGoal})`);
    return "failed";
  }

  // Evaluate success criteria
  const metCriteria = evaluateSuccessCriteria(goal, screenState);
  
  // Update met and pending criteria
  const newMetCriteria = [...new Set([...progress.success_criteria_met, ...metCriteria])];
  const newPendingCriteria = goal.success_criteria.filter(
    criterion => !newMetCriteria.includes(criterion)
  );

  updateGoalProgress(progressMap, goal.id, {
    success_criteria_met: newMetCriteria,
    success_criteria_pending: newPendingCriteria,
  });

  // Check if all criteria are met
  if (newPendingCriteria.length === 0 && newMetCriteria.length === goal.success_criteria.length) {
    markGoalComplete(progressMap, goal.id);
    return "completed";
  }

  return progress.status;
}

/**
 * Check if a goal should be marked as failed due to critical errors
 * 
 * Checks for conditions that indicate the goal cannot be completed:
 * - Too many consecutive action failures
 * - Stuck in a loop on the same screen
 * - No interactive elements for extended period
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to check
 * @param failureStreak - Number of consecutive action failures
 * @param loopCount - Number of times stuck on same screen
 * @param noElementCount - Number of consecutive steps with no elements
 * @returns true if goal should be marked as failed
 */
export function shouldFailGoalDueToCriticalError(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  failureStreak: number,
  loopCount: number,
  noElementCount: number
): { shouldFail: boolean; reason: string } {
  const progress = progressMap.get(goalId);
  
  if (!progress || progress.status !== "in_progress") {
    return { shouldFail: false, reason: "" };
  }

  // Check for excessive action failures
  if (failureStreak >= 5) {
    return {
      shouldFail: true,
      reason: `excessive_action_failures (${failureStreak} consecutive failures)`,
    };
  }

  // Check for being stuck in a loop
  if (loopCount >= 10) {
    return {
      shouldFail: true,
      reason: `stuck_in_loop (revisited same screen ${loopCount} times)`,
    };
  }

  // Check for no interactive elements
  if (noElementCount >= 5) {
    return {
      shouldFail: true,
      reason: `no_interactive_elements (${noElementCount} consecutive steps with no elements)`,
    };
  }

  return { shouldFail: false, reason: "" };
}

/**
 * Get a summary of goal progress for logging/debugging
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Human-readable summary string
 */
export function getGoalProgressSummary(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): string {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    return `Goal ${goalId}: not found`;
  }

  const duration = progress.completed_at && progress.started_at
    ? ((progress.completed_at - progress.started_at) / 1000).toFixed(1)
    : "ongoing";

  return [
    `Goal ${goalId}:`,
    `  Status: ${progress.status}`,
    `  Steps: ${progress.steps_taken}`,
    `  Criteria met: ${progress.success_criteria_met.length}/${progress.success_criteria_met.length + progress.success_criteria_pending.length}`,
    `  Duration: ${duration}s`,
    `  Findings: ${progress.findings.length}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Findings and Screenshots Tracking (Requirements 4.8, 4.9)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a finding to a specific goal
 * 
 * Findings are issues, warnings, or errors detected during goal execution.
 * Each finding is stored in the goal's findings array for later reporting.
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to add the finding to
 * @param finding - Finding to add (contains step, severity, message)
 */
export function addFinding(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  finding: SmokeFinding
): void {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    console.warn(`Cannot add finding: goal_id ${goalId} not found`);
    return;
  }

  progress.findings.push(finding);
  
  console.log(`Finding added to goal ${goalId}: [${finding.severity}] ${finding.message}`);
}

/**
 * Add a screenshot to a specific goal
 * 
 * Screenshots are captured during goal execution for visual evidence.
 * Each screenshot path is stored in the goal's screenshots array.
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to add the screenshot to
 * @param screenshotPath - File path to the screenshot
 */
export function addScreenshot(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  screenshotPath: string
): void {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    console.warn(`Cannot add screenshot: goal_id ${goalId} not found`);
    return;
  }

  progress.screenshots.push(screenshotPath);
  
  console.log(`Screenshot added to goal ${goalId}: ${screenshotPath}`);
}

/**
 * Get all findings for a specific goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Array of findings for the goal, or empty array if goal not found
 */
export function getGoalFindings(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): SmokeFinding[] {
  const progress = progressMap.get(goalId);
  return progress ? progress.findings : [];
}

/**
 * Get all screenshots for a specific goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Array of screenshot paths for the goal, or empty array if goal not found
 */
export function getGoalScreenshots(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): string[] {
  const progress = progressMap.get(goalId);
  return progress ? progress.screenshots : [];
}

/**
 * Get all findings across all goals
 * 
 * @param progressMap - Map of goal progress
 * @returns Array of all findings from all goals
 */
export function getAllFindings(progressMap: Map<string, GoalProgress>): SmokeFinding[] {
  const allFindings: SmokeFinding[] = [];
  
  for (const progress of progressMap.values()) {
    allFindings.push(...progress.findings);
  }
  
  return allFindings;
}

/**
 * Get findings by severity level
 * 
 * @param progressMap - Map of goal progress
 * @param severity - Severity level to filter by ("error", "warn", "info")
 * @returns Array of findings matching the severity level
 */
export function getFindingsBySeverity(
  progressMap: Map<string, GoalProgress>,
  severity: "error" | "warn" | "info"
): SmokeFinding[] {
  const allFindings = getAllFindings(progressMap);
  return allFindings.filter(f => f.severity === severity);
}

/**
 * Count findings by severity across all goals
 * 
 * @param progressMap - Map of goal progress
 * @returns Object with counts for each severity level
 */
export function countFindingsBySeverity(
  progressMap: Map<string, GoalProgress>
): { error: number; warn: number; info: number } {
  const counts = { error: 0, warn: 0, info: 0 };
  
  for (const progress of progressMap.values()) {
    for (const finding of progress.findings) {
      if (finding.severity in counts) {
        counts[finding.severity as keyof typeof counts]++;
      }
    }
  }
  
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Logging per Goal (Requirement 4.10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log an action to a specific goal's action log
 * 
 * Actions are recorded with full details including:
 * - Step number when action was executed
 * - Action type and parameters
 * - Screen hash where action occurred
 * - Result of action execution
 * - Whether action contributed to goal progress
 * 
 * This provides a complete audit trail of all actions taken for each goal.
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal to log the action to
 * @param action - Action record to log
 */
export function logAction(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  action: ActionRecord
): void {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    console.warn(`Cannot log action: goal_id ${goalId} not found`);
    return;
  }

  // Add action to the goal's action log
  progress.actions_log.push(action);
  
  // Increment steps taken for this goal
  progress.steps_taken++;
  
  console.log(
    `Action logged to goal ${goalId} (step ${action.step}): ${action.action.type} -> ${action.result}`
  );
}

/**
 * Get all actions for a specific goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Array of action records for the goal, or empty array if goal not found
 */
export function getGoalActions(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): ActionRecord[] {
  const progress = progressMap.get(goalId);
  return progress ? progress.actions_log : [];
}

/**
 * Get actions that contributed to goal progress
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Array of action records that contributed to goal progress
 */
export function getContributingActions(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): ActionRecord[] {
  const actions = getGoalActions(progressMap, goalId);
  return actions.filter(action => action.contributed_to_goal);
}

/**
 * Get the last N actions for a goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @param count - Number of recent actions to retrieve (default: 5)
 * @returns Array of the most recent action records
 */
export function getRecentGoalActions(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  count: number = 5
): ActionRecord[] {
  const actions = getGoalActions(progressMap, goalId);
  return actions.slice(-count);
}

/**
 * Count actions by result type for a goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Object with counts for each result type
 */
export function countActionsByResult(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): Record<string, number> {
  const actions = getGoalActions(progressMap, goalId);
  const counts: Record<string, number> = {};
  
  for (const action of actions) {
    const result = action.result;
    counts[result] = (counts[result] || 0) + 1;
  }
  
  return counts;
}

/**
 * Get action success rate for a goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Success rate as a percentage (0-100), or 0 if no actions
 */
export function getGoalActionSuccessRate(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): number {
  const actions = getGoalActions(progressMap, goalId);
  
  if (actions.length === 0) {
    return 0;
  }
  
  const successfulActions = actions.filter(action => action.result === "ok").length;
  return (successfulActions / actions.length) * 100;
}

/**
 * Get a summary of actions for a goal
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @returns Human-readable summary of actions
 */
export function getGoalActionSummary(
  progressMap: Map<string, GoalProgress>,
  goalId: string
): string {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    return `Goal ${goalId}: not found`;
  }
  
  const actions = progress.actions_log;
  const contributingCount = actions.filter(a => a.contributed_to_goal).length;
  const successRate = getGoalActionSuccessRate(progressMap, goalId);
  const resultCounts = countActionsByResult(progressMap, goalId);
  
  return [
    `Goal ${goalId} Actions:`,
    `  Total: ${actions.length}`,
    `  Contributing to goal: ${contributingCount}`,
    `  Success rate: ${successRate.toFixed(1)}%`,
    `  Results: ${JSON.stringify(resultCounts)}`,
  ].join("\n");
}

/**
 * Mark an action as contributing to goal progress
 * 
 * Updates the contributed_to_goal flag for a specific action.
 * This should be called when an action is determined to have helped achieve the goal.
 * 
 * @param progressMap - Map of goal progress
 * @param goalId - ID of the goal
 * @param actionStep - Step number of the action to mark
 */
export function markActionAsContributing(
  progressMap: Map<string, GoalProgress>,
  goalId: string,
  actionStep: number
): void {
  const progress = progressMap.get(goalId);
  
  if (!progress) {
    console.warn(`Cannot mark action as contributing: goal_id ${goalId} not found`);
    return;
  }
  
  const action = progress.actions_log.find(a => a.step === actionStep);
  
  if (!action) {
    console.warn(`Cannot mark action as contributing: action at step ${actionStep} not found in goal ${goalId}`);
    return;
  }
  
  action.contributed_to_goal = true;
  
  console.log(`Action at step ${actionStep} marked as contributing to goal ${goalId}`);
}

/**
 * Get all actions across all goals
 * 
 * @param progressMap - Map of goal progress
 * @returns Array of all action records from all goals
 */
export function getAllActions(progressMap: Map<string, GoalProgress>): ActionRecord[] {
  const allActions: ActionRecord[] = [];
  
  for (const progress of progressMap.values()) {
    allActions.push(...progress.actions_log);
  }
  
  // Sort by step number
  return allActions.sort((a, b) => a.step - b.step);
}
