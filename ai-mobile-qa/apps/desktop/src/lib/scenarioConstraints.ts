/**
 * Scenario Constraints Enforcement
 * 
 * Provides functions to check and enforce scenario constraints during execution.
 * Prevents tests from running indefinitely by enforcing limits on steps, time, and failures.
 * 
 * Implements requirements 27.1, 27.2, 27.3, 27.4, 27.5 from the requirements document.
 */

import type { GoalProgress, GoalStatus, ScenarioConstraints } from "../types/scenario";

/**
 * Result of a constraint check
 */
export interface ConstraintCheckResult {
  /** Whether the constraint is violated */
  violated: boolean;
  
  /** Name of the constraint that was violated */
  constraintName?: string;
  
  /** Value of the constraint */
  constraintValue?: number | boolean;
  
  /** Current value that triggered the violation */
  currentValue?: number;
  
  /** Human-readable message describing the violation */
  message?: string;
}

/**
 * Check if max_steps_per_goal constraint is violated
 * 
 * Requirement 27.1: WHEN max_steps_per_goal is specified, THE System SHALL halt 
 * goal execution after that many steps
 * 
 * @param goalProgress - Progress tracking for the goal
 * @param maxSteps - Maximum steps allowed per goal
 * @returns Constraint check result
 */
export function checkMaxStepsPerGoal(
  goalProgress: GoalProgress,
  maxSteps: number
): ConstraintCheckResult {
  if (maxSteps <= 0) {
    // No constraint specified or invalid value
    return { violated: false };
  }

  const violated = goalProgress.steps_taken >= maxSteps;

  if (violated) {
    return {
      violated: true,
      constraintName: "max_steps_per_goal",
      constraintValue: maxSteps,
      currentValue: goalProgress.steps_taken,
      message: `Goal "${goalProgress.goal_id}" exceeded max_steps_per_goal: ${goalProgress.steps_taken}/${maxSteps} steps`,
    };
  }

  return { violated: false };
}

/**
 * Check if timeout constraint is violated
 * 
 * Requirement 27.2: WHEN timeout_seconds is specified, THE System SHALL halt 
 * goal execution if the timeout is exceeded
 * 
 * @param startTime - Timestamp when execution started (milliseconds)
 * @param timeoutSeconds - Maximum execution time in seconds
 * @returns Constraint check result
 */
export function checkTimeout(
  startTime: number,
  timeoutSeconds: number
): ConstraintCheckResult {
  if (timeoutSeconds <= 0) {
    // No constraint specified or invalid value
    return { violated: false };
  }

  const now = Date.now();
  const elapsedSeconds = Math.floor((now - startTime) / 1000);
  const violated = elapsedSeconds >= timeoutSeconds;

  if (violated) {
    return {
      violated: true,
      constraintName: "timeout_seconds",
      constraintValue: timeoutSeconds,
      currentValue: elapsedSeconds,
      message: `Execution exceeded timeout: ${elapsedSeconds}/${timeoutSeconds} seconds`,
    };
  }

  return { violated: false };
}

/**
 * Check if execution should stop due to goal failure
 * 
 * Requirements 27.3, 27.4:
 * - WHEN stop_on_first_failure is true and a goal fails, THE System SHALL halt scenario execution
 * - WHEN stop_on_first_failure is false and a goal fails, THE System SHALL continue to the next goal
 * 
 * @param goalStatus - Current status of the goal
 * @param stopOnFirstFailure - Whether to stop execution on first failure
 * @returns Constraint check result
 */
export function shouldStopOnFailure(
  goalStatus: GoalStatus,
  stopOnFirstFailure: boolean
): ConstraintCheckResult {
  if (!stopOnFirstFailure) {
    // Constraint not enabled
    return { violated: false };
  }

  const violated = goalStatus === "failed";

  if (violated) {
    return {
      violated: true,
      constraintName: "stop_on_first_failure",
      constraintValue: stopOnFirstFailure,
      message: "Goal failed and stop_on_first_failure is enabled - halting scenario execution",
    };
  }

  return { violated: false };
}

/**
 * Check all constraints for a goal
 * 
 * Convenience function that checks all applicable constraints and returns
 * the first violation found.
 * 
 * @param goalProgress - Progress tracking for the goal
 * @param constraints - Scenario constraints to enforce
 * @param scenarioStartTime - Timestamp when scenario execution started
 * @returns Constraint check result (first violation found, or no violation)
 */
export function checkAllGoalConstraints(
  goalProgress: GoalProgress,
  constraints: ScenarioConstraints,
  scenarioStartTime: number
): ConstraintCheckResult {
  // Check max_steps_per_goal
  if (constraints.max_steps_per_goal) {
    const stepsResult = checkMaxStepsPerGoal(
      goalProgress,
      constraints.max_steps_per_goal
    );
    if (stepsResult.violated) {
      return stepsResult;
    }
  }

  // Check timeout_seconds
  if (constraints.timeout_seconds) {
    const timeoutResult = checkTimeout(
      scenarioStartTime,
      constraints.timeout_seconds
    );
    if (timeoutResult.violated) {
      return timeoutResult;
    }
  }

  // Check stop_on_first_failure
  if (constraints.stop_on_first_failure !== undefined) {
    const failureResult = shouldStopOnFailure(
      goalProgress.status,
      constraints.stop_on_first_failure
    );
    if (failureResult.violated) {
      return failureResult;
    }
  }

  return { violated: false };
}

/**
 * Check if a goal should be marked as failed due to constraint violation
 * 
 * @param goalProgress - Progress tracking for the goal
 * @param constraints - Scenario constraints to enforce
 * @param scenarioStartTime - Timestamp when scenario execution started
 * @returns True if goal should be marked as failed
 */
export function shouldFailGoalDueToConstraint(
  goalProgress: GoalProgress,
  constraints: ScenarioConstraints,
  scenarioStartTime: number
): boolean {
  const result = checkAllGoalConstraints(goalProgress, constraints, scenarioStartTime);
  
  // Only max_steps_per_goal and timeout_seconds should fail the goal
  // stop_on_first_failure is checked separately after goal failure
  if (result.violated) {
    return (
      result.constraintName === "max_steps_per_goal" ||
      result.constraintName === "timeout_seconds"
    );
  }

  return false;
}

/**
 * Check if scenario execution should be halted
 * 
 * @param goalProgress - Progress tracking for the goal
 * @param constraints - Scenario constraints to enforce
 * @param scenarioStartTime - Timestamp when scenario execution started
 * @returns True if scenario execution should be halted
 */
export function shouldHaltScenarioExecution(
  goalProgress: GoalProgress,
  constraints: ScenarioConstraints,
  scenarioStartTime: number
): boolean {
  const result = checkAllGoalConstraints(goalProgress, constraints, scenarioStartTime);
  
  // Halt execution if:
  // 1. Timeout is exceeded (affects entire scenario)
  // 2. Goal failed and stop_on_first_failure is true
  if (result.violated) {
    return (
      result.constraintName === "timeout_seconds" ||
      result.constraintName === "stop_on_first_failure"
    );
  }

  return false;
}

/**
 * Format constraint violation for logging
 * 
 * Requirement 27.5: THE System SHALL log constraint violations with the 
 * constraint name and value
 * 
 * @param result - Constraint check result
 * @returns Formatted log message
 */
export function formatConstraintViolation(result: ConstraintCheckResult): string {
  if (!result.violated || !result.message) {
    return "";
  }

  let logMessage = `[CONSTRAINT VIOLATION] ${result.message}`;
  
  if (result.constraintName && result.constraintValue !== undefined) {
    logMessage += ` (${result.constraintName}=${result.constraintValue}`;
    
    if (result.currentValue !== undefined) {
      logMessage += `, current=${result.currentValue}`;
    }
    
    logMessage += ")";
  }

  return logMessage;
}

/**
 * Get remaining steps for a goal
 * 
 * @param goalProgress - Progress tracking for the goal
 * @param maxSteps - Maximum steps allowed per goal
 * @returns Number of steps remaining, or Infinity if no limit
 */
export function getRemainingSteps(
  goalProgress: GoalProgress,
  maxSteps: number
): number {
  if (maxSteps <= 0) {
    return Infinity;
  }

  const remaining = maxSteps - goalProgress.steps_taken;
  return Math.max(0, remaining);
}

/**
 * Get remaining time for scenario execution
 * 
 * @param startTime - Timestamp when execution started (milliseconds)
 * @param timeoutSeconds - Maximum execution time in seconds
 * @returns Number of seconds remaining, or Infinity if no limit
 */
export function getRemainingTime(
  startTime: number,
  timeoutSeconds: number
): number {
  if (timeoutSeconds <= 0) {
    return Infinity;
  }

  const now = Date.now();
  const elapsedSeconds = Math.floor((now - startTime) / 1000);
  const remaining = timeoutSeconds - elapsedSeconds;
  return Math.max(0, remaining);
}

/**
 * Get progress percentage for a goal
 * 
 * @param goalProgress - Progress tracking for the goal
 * @param maxSteps - Maximum steps allowed per goal
 * @returns Progress percentage (0-100), or null if no limit
 */
export function getGoalProgressPercentage(
  goalProgress: GoalProgress,
  maxSteps: number
): number | null {
  if (maxSteps <= 0) {
    return null;
  }

  const percentage = Math.min(100, Math.floor((goalProgress.steps_taken / maxSteps) * 100));
  return percentage;
}

/**
 * Check if goal is approaching step limit
 * 
 * @param goalProgress - Progress tracking for the goal
 * @param maxSteps - Maximum steps allowed per goal
 * @param warningThreshold - Percentage threshold for warning (default: 80%)
 * @returns True if goal is approaching step limit
 */
export function isApproachingStepLimit(
  goalProgress: GoalProgress,
  maxSteps: number,
  warningThreshold: number = 80
): boolean {
  const percentage = getGoalProgressPercentage(goalProgress, maxSteps);
  
  if (percentage === null) {
    return false;
  }

  return percentage >= warningThreshold;
}

/**
 * Check if scenario is approaching timeout
 * 
 * @param startTime - Timestamp when execution started (milliseconds)
 * @param timeoutSeconds - Maximum execution time in seconds
 * @param warningThreshold - Percentage threshold for warning (default: 80%)
 * @returns True if scenario is approaching timeout
 */
export function isApproachingTimeout(
  startTime: number,
  timeoutSeconds: number,
  warningThreshold: number = 80
): boolean {
  if (timeoutSeconds <= 0) {
    return false;
  }

  const now = Date.now();
  const elapsedSeconds = Math.floor((now - startTime) / 1000);
  const percentage = Math.min(100, Math.floor((elapsedSeconds / timeoutSeconds) * 100));

  return percentage >= warningThreshold;
}

/**
 * Create a constraint violation finding
 * 
 * Helper function to create a SmokeFinding for constraint violations.
 * 
 * @param result - Constraint check result
 * @param step - Current step number
 * @param goalId - ID of the goal where violation occurred
 * @returns SmokeFinding object
 */
export function createConstraintViolationFinding(
  result: ConstraintCheckResult,
  step: number,
  goalId: string
): {
  step: number;
  severity: "error" | "warn" | "info";
  message: string;
  goal_id: string;
  blocks_goal: boolean;
} {
  return {
    step,
    severity: "error",
    message: result.message || "Constraint violation",
    goal_id: goalId,
    blocks_goal: true,
  };
}
