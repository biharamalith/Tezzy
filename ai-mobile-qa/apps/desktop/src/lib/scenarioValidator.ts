/**
 * Scenario Validator
 * 
 * Validates scenario definitions before execution to catch configuration errors early.
 * Implements requirements 2.1-2.6 from the requirements document.
 */

import type { SmokeScenario, ValidationResult } from "../types/scenario";

/**
 * Validates a scenario definition and returns detailed validation results
 * 
 * @param scenario - The scenario to validate
 * @returns ValidationResult with errors, warnings, and estimates
 */
export function validateScenario(scenario: SmokeScenario): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ─── Validate Required Fields ───────────────────────────────────────────
  // Requirement 2.1: Check that all required fields are present

  if (!scenario.id || scenario.id.trim() === "") {
    errors.push("Scenario ID is required and cannot be empty");
  }

  if (!scenario.name || scenario.name.trim() === "") {
    errors.push("Scenario name is required and cannot be empty");
  }

  if (!scenario.description || scenario.description.trim() === "") {
    errors.push("Scenario description is required and cannot be empty");
  }

  if (!scenario.app_name || scenario.app_name.trim() === "") {
    errors.push("App name is required and cannot be empty");
  }

  if (!scenario.goals || !Array.isArray(scenario.goals)) {
    errors.push("Scenario must have a goals array");
    // Cannot continue validation without goals
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  if (scenario.goals.length === 0) {
    errors.push("Scenario must have at least one goal");
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  // ─── Validate Goal IDs are Unique ──────────────────────────────────────
  // Requirement 2.4: Check that all goal IDs are unique within the scenario

  const goalIds = new Set<string>();
  const duplicateGoalIds: string[] = [];

  for (const goal of scenario.goals) {
    if (!goal.id || goal.id.trim() === "") {
      errors.push(`Goal at index ${scenario.goals.indexOf(goal)} is missing an ID`);
      continue;
    }

    if (goalIds.has(goal.id)) {
      duplicateGoalIds.push(goal.id);
    } else {
      goalIds.add(goal.id);
    }
  }

  if (duplicateGoalIds.length > 0) {
    errors.push(
      `Duplicate goal IDs found: ${duplicateGoalIds.join(", ")}. Each goal must have a unique ID.`
    );
  }

  // ─── Validate Each Goal ────────────────────────────────────────────────

  for (let i = 0; i < scenario.goals.length; i++) {
    const goal = scenario.goals[i];
    const goalPrefix = `Goal "${goal.id || `at index ${i}`}"`;

    // Check required goal fields
    if (!goal.description || goal.description.trim() === "") {
      errors.push(`${goalPrefix}: description is required and cannot be empty`);
    }

    if (!goal.type) {
      errors.push(`${goalPrefix}: type is required`);
    } else {
      // Validate goal type is one of the supported types
      const validTypes = ["login", "navigate", "form_fill", "verify", "explore_section", "custom"];
      if (!validTypes.includes(goal.type)) {
        errors.push(
          `${goalPrefix}: invalid type "${goal.type}". Must be one of: ${validTypes.join(", ")}`
        );
      }
    }

    // Requirement 2.5: Validate success_criteria arrays are non-empty
    if (!goal.success_criteria || !Array.isArray(goal.success_criteria)) {
      errors.push(`${goalPrefix}: success_criteria must be an array`);
    } else if (goal.success_criteria.length === 0) {
      errors.push(`${goalPrefix}: success_criteria cannot be empty. At least one criterion is required.`);
    } else {
      // Check that each criterion is a non-empty string
      for (let j = 0; j < goal.success_criteria.length; j++) {
        const criterion = goal.success_criteria[j];
        if (!criterion || typeof criterion !== "string" || criterion.trim() === "") {
          errors.push(
            `${goalPrefix}: success_criteria[${j}] is empty or invalid. Each criterion must be a non-empty string.`
          );
        }
      }
    }

    // Requirement 2.2: Validate login goals have credentials
    if (goal.type === "login") {
      if (!scenario.credentials) {
        errors.push(
          `${goalPrefix}: Login goal requires credentials. Please provide email and password in the scenario.`
        );
      } else {
        if (!scenario.credentials.email || scenario.credentials.email.trim() === "") {
          errors.push(`${goalPrefix}: Login goal requires a valid email in credentials`);
        }
        if (!scenario.credentials.password || scenario.credentials.password.trim() === "") {
          errors.push(`${goalPrefix}: Login goal requires a valid password in credentials`);
        }
      }
    }

    // Requirement 2.3: Validate form_fill goals have form_data
    if (goal.type === "form_fill") {
      if (!goal.form_data || typeof goal.form_data !== "object") {
        errors.push(
          `${goalPrefix}: Form fill goal requires form_data. Please provide a key-value map of field names to values.`
        );
      } else if (Object.keys(goal.form_data).length === 0) {
        errors.push(
          `${goalPrefix}: Form fill goal has empty form_data. At least one field must be specified.`
        );
      }
    }

    // Validate hints if provided
    if (goal.hints) {
      if (goal.hints.expected_screens && !Array.isArray(goal.hints.expected_screens)) {
        warnings.push(`${goalPrefix}: hints.expected_screens should be an array`);
      }
      if (goal.hints.required_actions && !Array.isArray(goal.hints.required_actions)) {
        warnings.push(`${goalPrefix}: hints.required_actions should be an array`);
      }
      if (goal.hints.avoid_actions && !Array.isArray(goal.hints.avoid_actions)) {
        warnings.push(`${goalPrefix}: hints.avoid_actions should be an array`);
      }
    }
  }

  // ─── Validate Constraints ──────────────────────────────────────────────

  if (scenario.constraints) {
    if (
      scenario.constraints.max_steps_per_goal !== undefined &&
      (typeof scenario.constraints.max_steps_per_goal !== "number" ||
        scenario.constraints.max_steps_per_goal <= 0)
    ) {
      errors.push("constraints.max_steps_per_goal must be a positive number");
    }

    if (
      scenario.constraints.timeout_seconds !== undefined &&
      (typeof scenario.constraints.timeout_seconds !== "number" ||
        scenario.constraints.timeout_seconds <= 0)
    ) {
      errors.push("constraints.timeout_seconds must be a positive number");
    }

    if (
      scenario.constraints.stop_on_first_failure !== undefined &&
      typeof scenario.constraints.stop_on_first_failure !== "boolean"
    ) {
      errors.push("constraints.stop_on_first_failure must be a boolean");
    }
  }

  // ─── Generate Estimates ────────────────────────────────────────────────
  // Requirement 2.7: Return estimated steps and duration

  let estimatedSteps = 0;
  let estimatedDurationSeconds = 0;

  if (errors.length === 0) {
    // Estimate steps based on goal types
    for (const goal of scenario.goals) {
      switch (goal.type) {
        case "login":
          estimatedSteps += 5; // email tap, email input, password tap, password input, login tap
          estimatedDurationSeconds += 15; // ~3 seconds per step
          break;
        case "navigate":
          estimatedSteps += 3; // typically 2-4 taps to reach a screen
          estimatedDurationSeconds += 9;
          break;
        case "form_fill":
          const fieldCount = goal.form_data ? Object.keys(goal.form_data).length : 2;
          estimatedSteps += fieldCount * 2 + 1; // tap + input per field + submit
          estimatedDurationSeconds += (fieldCount * 2 + 1) * 3;
          break;
        case "verify":
          estimatedSteps += 1; // just verification, no actions
          estimatedDurationSeconds += 3;
          break;
        case "explore_section":
          estimatedSteps += 10; // bounded exploration
          estimatedDurationSeconds += 30;
          break;
        case "custom":
          estimatedSteps += 5; // default estimate
          estimatedDurationSeconds += 15;
          break;
      }
    }

    // Apply constraint limits if specified
    if (scenario.constraints?.max_steps_per_goal) {
      const maxTotal = scenario.constraints.max_steps_per_goal * scenario.goals.length;
      if (estimatedSteps > maxTotal) {
        estimatedSteps = maxTotal;
        estimatedDurationSeconds = maxTotal * 3; // ~3 seconds per step
      }
    }

    if (scenario.constraints?.timeout_seconds) {
      if (estimatedDurationSeconds > scenario.constraints.timeout_seconds) {
        estimatedDurationSeconds = scenario.constraints.timeout_seconds;
      }
    }
  }

  // ─── Return Validation Result ──────────────────────────────────────────

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    estimated_steps: valid ? estimatedSteps : undefined,
    estimated_duration_seconds: valid ? estimatedDurationSeconds : undefined,
  };
}

/**
 * Quick validation check - returns true if scenario is valid
 * 
 * @param scenario - The scenario to validate
 * @returns true if valid, false otherwise
 */
export function isScenarioValid(scenario: SmokeScenario): boolean {
  const result = validateScenario(scenario);
  return result.valid;
}

/**
 * Get validation errors as a formatted string
 * 
 * @param scenario - The scenario to validate
 * @returns Formatted error message, or null if valid
 */
export function getValidationErrorMessage(scenario: SmokeScenario): string | null {
  const result = validateScenario(scenario);
  
  if (result.valid) {
    return null;
  }

  let message = "Scenario validation failed:\n\n";
  
  if (result.errors.length > 0) {
    message += "Errors:\n";
    result.errors.forEach((error, index) => {
      message += `  ${index + 1}. ${error}\n`;
    });
  }

  if (result.warnings.length > 0) {
    message += "\nWarnings:\n";
    result.warnings.forEach((warning, index) => {
      message += `  ${index + 1}. ${warning}\n`;
    });
  }

  return message;
}
