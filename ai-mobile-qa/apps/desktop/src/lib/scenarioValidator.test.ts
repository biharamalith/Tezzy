/**
 * Unit Tests for Scenario Validator
 * 
 * Tests validation of scenario definitions covering requirements 2.1-2.6
 */

import { describe, it, expect } from "vitest";
import {
  validateScenario,
  isScenarioValid,
  getValidationErrorMessage,
} from "./scenarioValidator";
import type { SmokeScenario } from "../types/scenario";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/**
 * Creates a valid baseline scenario for testing
 */
function createValidScenario(): SmokeScenario {
  return {
    id: "test-scenario-1",
    name: "Test Scenario",
    description: "A valid test scenario",
    app_name: "com.example.app",
    goals: [
      {
        id: "goal-1",
        description: "Navigate to home screen",
        type: "navigate",
        success_criteria: ["Home screen is visible"],
      },
    ],
  };
}

// ─── Required Field Validation Tests ───────────────────────────────────────

describe("validateScenario - Required Fields (Requirement 2.1)", () => {
  it("should validate a complete valid scenario", () => {
    const scenario = createValidScenario();
    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.estimated_steps).toBeGreaterThan(0);
    expect(result.estimated_duration_seconds).toBeGreaterThan(0);
  });

  it("should reject scenario with missing id", () => {
    const scenario = createValidScenario();
    scenario.id = "";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scenario ID is required and cannot be empty");
  });

  it("should reject scenario with missing name", () => {
    const scenario = createValidScenario();
    scenario.name = "";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scenario name is required and cannot be empty");
  });

  it("should reject scenario with missing description", () => {
    const scenario = createValidScenario();
    scenario.description = "";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scenario description is required and cannot be empty");
  });

  it("should reject scenario with missing app_name", () => {
    const scenario = createValidScenario();
    scenario.app_name = "";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("App name is required and cannot be empty");
  });

  it("should reject scenario with missing goals array", () => {
    const scenario = createValidScenario();
    // @ts-expect-error - Testing invalid input
    scenario.goals = undefined;

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scenario must have a goals array");
  });

  it("should reject scenario with empty goals array", () => {
    const scenario = createValidScenario();
    scenario.goals = [];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scenario must have at least one goal");
  });

  it("should reject scenario with whitespace-only required fields", () => {
    const scenario = createValidScenario();
    scenario.id = "   ";
    scenario.name = "  ";
    scenario.description = "\t\n";
    scenario.app_name = " ";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scenario ID is required and cannot be empty");
    expect(result.errors).toContain("Scenario name is required and cannot be empty");
    expect(result.errors).toContain("Scenario description is required and cannot be empty");
    expect(result.errors).toContain("App name is required and cannot be empty");
  });
});

// ─── Duplicate Goal ID Tests ───────────────────────────────────────────────

describe("validateScenario - Duplicate Goal IDs (Requirement 2.4)", () => {
  it("should accept scenario with unique goal IDs", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "goal-1",
        description: "First goal",
        type: "navigate",
        success_criteria: ["Screen visible"],
      },
      {
        id: "goal-2",
        description: "Second goal",
        type: "verify",
        success_criteria: ["Element present"],
      },
      {
        id: "goal-3",
        description: "Third goal",
        type: "explore_section",
        success_criteria: ["Section explored"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject scenario with duplicate goal IDs", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "goal-1",
        description: "First goal",
        type: "navigate",
        success_criteria: ["Screen visible"],
      },
      {
        id: "goal-1",
        description: "Duplicate ID goal",
        type: "verify",
        success_criteria: ["Element present"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate goal IDs found: goal-1"))).toBe(true);
  });

  it("should reject scenario with multiple duplicate goal IDs", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "goal-1",
        description: "First goal",
        type: "navigate",
        success_criteria: ["Screen visible"],
      },
      {
        id: "goal-1",
        description: "Duplicate goal",
        type: "verify",
        success_criteria: ["Element present"],
      },
      {
        id: "goal-2",
        description: "Another goal",
        type: "explore_section",
        success_criteria: ["Section explored"],
      },
      {
        id: "goal-2",
        description: "Another duplicate",
        type: "custom",
        success_criteria: ["Custom action done"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate goal IDs found"))).toBe(true);
    expect(result.errors.some((e) => e.includes("goal-1"))).toBe(true);
    expect(result.errors.some((e) => e.includes("goal-2"))).toBe(true);
  });

  it("should reject goal with missing ID", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "",
        description: "Goal without ID",
        type: "navigate",
        success_criteria: ["Screen visible"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("is missing an ID"))).toBe(true);
  });
});

// ─── Empty Success Criteria Tests ──────────────────────────────────────────

describe("validateScenario - Empty Success Criteria (Requirement 2.5)", () => {
  it("should accept goal with valid success criteria", () => {
    const scenario = createValidScenario();
    scenario.goals[0].success_criteria = [
      "Home screen is visible",
      "Navigation bar is present",
      "User profile icon is displayed",
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject goal with empty success_criteria array", () => {
    const scenario = createValidScenario();
    scenario.goals[0].success_criteria = [];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("success_criteria cannot be empty. At least one criterion is required")
      )
    ).toBe(true);
  });

  it("should reject goal with missing success_criteria", () => {
    const scenario = createValidScenario();
    // @ts-expect-error - Testing invalid input
    scenario.goals[0].success_criteria = undefined;

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("success_criteria must be an array"))).toBe(true);
  });

  it("should reject goal with non-array success_criteria", () => {
    const scenario = createValidScenario();
    // @ts-expect-error - Testing invalid input
    scenario.goals[0].success_criteria = "not an array";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("success_criteria must be an array"))).toBe(true);
  });

  it("should reject goal with empty string in success_criteria", () => {
    const scenario = createValidScenario();
    scenario.goals[0].success_criteria = ["Valid criterion", "", "Another valid criterion"];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("success_criteria[1] is empty or invalid")
      )
    ).toBe(true);
  });

  it("should reject goal with whitespace-only string in success_criteria", () => {
    const scenario = createValidScenario();
    scenario.goals[0].success_criteria = ["Valid criterion", "   ", "Another valid criterion"];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("success_criteria[1] is empty or invalid")
      )
    ).toBe(true);
  });
});

// ─── Login Goal Validation Tests ───────────────────────────────────────────

describe("validateScenario - Login Goal Credentials (Requirement 2.2)", () => {
  it("should accept login goal with valid credentials", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "login-goal",
        description: "Login to the app",
        type: "login",
        success_criteria: ["User is logged in", "Dashboard is visible"],
      },
    ];
    scenario.credentials = {
      email: "test@example.com",
      password: "securePassword123",
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject login goal without credentials", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "login-goal",
        description: "Login to the app",
        type: "login",
        success_criteria: ["User is logged in"],
      },
    ];
    // No credentials provided

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Login goal requires credentials. Please provide email and password")
      )
    ).toBe(true);
  });

  it("should reject login goal with missing email", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "login-goal",
        description: "Login to the app",
        type: "login",
        success_criteria: ["User is logged in"],
      },
    ];
    scenario.credentials = {
      email: "",
      password: "securePassword123",
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Login goal requires a valid email in credentials"))
    ).toBe(true);
  });

  it("should reject login goal with missing password", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "login-goal",
        description: "Login to the app",
        type: "login",
        success_criteria: ["User is logged in"],
      },
    ];
    scenario.credentials = {
      email: "test@example.com",
      password: "",
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Login goal requires a valid password in credentials"))
    ).toBe(true);
  });

  it("should reject login goal with whitespace-only credentials", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "login-goal",
        description: "Login to the app",
        type: "login",
        success_criteria: ["User is logged in"],
      },
    ];
    scenario.credentials = {
      email: "   ",
      password: "\t\n",
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("Login goal requires a valid email in credentials"))
    ).toBe(true);
    expect(
      result.errors.some((e) => e.includes("Login goal requires a valid password in credentials"))
    ).toBe(true);
  });
});

// ─── Form Fill Goal Validation Tests ───────────────────────────────────────

describe("validateScenario - Form Fill Goal Data (Requirement 2.3)", () => {
  it("should accept form_fill goal with valid form_data", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "form-goal",
        description: "Fill out registration form",
        type: "form_fill",
        success_criteria: ["Form is submitted successfully"],
        form_data: {
          name: "John Doe",
          email: "john@example.com",
          phone: "555-1234",
        },
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject form_fill goal without form_data", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "form-goal",
        description: "Fill out registration form",
        type: "form_fill",
        success_criteria: ["Form is submitted successfully"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Form fill goal requires form_data. Please provide a key-value map")
      )
    ).toBe(true);
  });

  it("should reject form_fill goal with empty form_data", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "form-goal",
        description: "Fill out registration form",
        type: "form_fill",
        success_criteria: ["Form is submitted successfully"],
        form_data: {},
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Form fill goal has empty form_data. At least one field must be specified")
      )
    ).toBe(true);
  });

  it("should reject form_fill goal with non-object form_data", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "form-goal",
        description: "Fill out registration form",
        type: "form_fill",
        success_criteria: ["Form is submitted successfully"],
        // @ts-expect-error - Testing invalid input
        form_data: "not an object",
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Form fill goal requires form_data. Please provide a key-value map")
      )
    ).toBe(true);
  });
});

// ─── Goal Type Validation Tests ────────────────────────────────────────────

describe("validateScenario - Goal Type Validation", () => {
  it("should accept all valid goal types", () => {
    const scenario = createValidScenario();
    const validTypes = ["login", "navigate", "form_fill", "verify", "explore_section", "custom"];

    for (const type of validTypes) {
      scenario.goals = [
        {
          id: `goal-${type}`,
          description: `Test ${type} goal`,
          type: type as any,
          success_criteria: ["Success"],
        },
      ];

      // Add required data for specific types
      if (type === "login") {
        scenario.credentials = { email: "test@example.com", password: "pass123" };
      }
      if (type === "form_fill") {
        scenario.goals[0].form_data = { field: "value" };
      }

      const result = validateScenario(scenario);
      expect(result.valid).toBe(true);
    }
  });

  it("should reject invalid goal type", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "invalid-goal",
        description: "Goal with invalid type",
        // @ts-expect-error - Testing invalid input
        type: "invalid_type",
        success_criteria: ["Success"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid type "invalid_type"'))).toBe(true);
  });

  it("should reject goal with missing type", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "no-type-goal",
        description: "Goal without type",
        // @ts-expect-error - Testing invalid input
        type: undefined,
        success_criteria: ["Success"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("type is required"))).toBe(true);
  });
});

// ─── Constraints Validation Tests ──────────────────────────────────────────

describe("validateScenario - Constraints Validation", () => {
  it("should accept valid constraints", () => {
    const scenario = createValidScenario();
    scenario.constraints = {
      max_steps_per_goal: 20,
      timeout_seconds: 300,
      stop_on_first_failure: true,
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject negative max_steps_per_goal", () => {
    const scenario = createValidScenario();
    scenario.constraints = {
      max_steps_per_goal: -5,
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("max_steps_per_goal must be a positive number"))
    ).toBe(true);
  });

  it("should reject zero max_steps_per_goal", () => {
    const scenario = createValidScenario();
    scenario.constraints = {
      max_steps_per_goal: 0,
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("max_steps_per_goal must be a positive number"))
    ).toBe(true);
  });

  it("should reject negative timeout_seconds", () => {
    const scenario = createValidScenario();
    scenario.constraints = {
      timeout_seconds: -100,
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("timeout_seconds must be a positive number"))
    ).toBe(true);
  });

  it("should reject non-boolean stop_on_first_failure", () => {
    const scenario = createValidScenario();
    scenario.constraints = {
      // @ts-expect-error - Testing invalid input
      stop_on_first_failure: "yes",
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("stop_on_first_failure must be a boolean"))
    ).toBe(true);
  });
});

// ─── Helper Function Tests ─────────────────────────────────────────────────

describe("isScenarioValid - Helper Function", () => {
  it("should return true for valid scenario", () => {
    const scenario = createValidScenario();
    expect(isScenarioValid(scenario)).toBe(true);
  });

  it("should return false for invalid scenario", () => {
    const scenario = createValidScenario();
    scenario.id = "";
    expect(isScenarioValid(scenario)).toBe(false);
  });
});

describe("getValidationErrorMessage - Helper Function", () => {
  it("should return null for valid scenario", () => {
    const scenario = createValidScenario();
    expect(getValidationErrorMessage(scenario)).toBeNull();
  });

  it("should return formatted error message for invalid scenario", () => {
    const scenario = createValidScenario();
    scenario.id = "";
    scenario.name = "";

    const message = getValidationErrorMessage(scenario);

    expect(message).not.toBeNull();
    expect(message).toContain("Scenario validation failed");
    expect(message).toContain("Errors:");
    expect(message).toContain("Scenario ID is required");
    expect(message).toContain("Scenario name is required");
  });

  it("should include warnings in error message when there are also errors", () => {
    const scenario = createValidScenario();
    scenario.id = ""; // Add an error
    scenario.goals[0].hints = {
      // @ts-expect-error - Testing invalid input
      expected_screens: "not an array",
    };

    const message = getValidationErrorMessage(scenario);

    expect(message).not.toBeNull();
    expect(message).toContain("Errors:");
    expect(message).toContain("Scenario ID is required");
    expect(message).toContain("Warnings:");
    expect(message).toContain("expected_screens should be an array");
  });
});

// ─── Estimation Tests ──────────────────────────────────────────────────────

describe("validateScenario - Step and Duration Estimation (Requirement 2.7)", () => {
  it("should estimate steps for login goal", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "login-goal",
        description: "Login",
        type: "login",
        success_criteria: ["Logged in"],
      },
    ];
    scenario.credentials = { email: "test@example.com", password: "pass123" };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.estimated_steps).toBe(5); // email tap, input, password tap, input, login tap
    expect(result.estimated_duration_seconds).toBe(15); // 5 steps * 3 seconds
  });

  it("should estimate steps for navigate goal", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "nav-goal",
        description: "Navigate",
        type: "navigate",
        success_criteria: ["Screen reached"],
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.estimated_steps).toBe(3);
    expect(result.estimated_duration_seconds).toBe(9);
  });

  it("should estimate steps for form_fill goal based on field count", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "form-goal",
        description: "Fill form",
        type: "form_fill",
        success_criteria: ["Form submitted"],
        form_data: {
          name: "John",
          email: "john@example.com",
          phone: "555-1234",
        },
      },
    ];

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.estimated_steps).toBe(7); // 3 fields * 2 (tap + input) + 1 submit
    expect(result.estimated_duration_seconds).toBe(21); // 7 steps * 3 seconds
  });

  it("should not provide estimates for invalid scenario", () => {
    const scenario = createValidScenario();
    scenario.id = "";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.estimated_steps).toBeUndefined();
    expect(result.estimated_duration_seconds).toBeUndefined();
  });

  it("should respect max_steps_per_goal constraint", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "explore-goal",
        description: "Explore",
        type: "explore_section",
        success_criteria: ["Section explored"],
      },
    ];
    scenario.constraints = {
      max_steps_per_goal: 5,
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.estimated_steps).toBeLessThanOrEqual(5);
  });

  it("should respect timeout_seconds constraint", () => {
    const scenario = createValidScenario();
    scenario.goals = [
      {
        id: "explore-goal",
        description: "Explore",
        type: "explore_section",
        success_criteria: ["Section explored"],
      },
    ];
    scenario.constraints = {
      timeout_seconds: 10,
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.estimated_duration_seconds).toBeLessThanOrEqual(10);
  });
});

// ─── Complex Scenario Tests ────────────────────────────────────────────────

describe("validateScenario - Complex Scenarios", () => {
  it("should validate multi-goal scenario", () => {
    const scenario: SmokeScenario = {
      id: "complex-scenario",
      name: "Complex Test Scenario",
      description: "A scenario with multiple goals",
      app_name: "com.example.app",
      credentials: {
        email: "test@example.com",
        password: "pass123",
      },
      goals: [
        {
          id: "login",
          description: "Login to app",
          type: "login",
          success_criteria: ["User is logged in"],
        },
        {
          id: "navigate-home",
          description: "Navigate to home",
          type: "navigate",
          success_criteria: ["Home screen visible"],
        },
        {
          id: "fill-profile",
          description: "Fill profile form",
          type: "form_fill",
          success_criteria: ["Profile updated"],
          form_data: {
            name: "John Doe",
            bio: "Test user",
          },
        },
        {
          id: "verify-profile",
          description: "Verify profile",
          type: "verify",
          success_criteria: ["Profile data is correct"],
        },
      ],
      constraints: {
        max_steps_per_goal: 15,
        timeout_seconds: 120,
        stop_on_first_failure: true,
      },
    };

    const result = validateScenario(scenario);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.estimated_steps).toBeGreaterThan(0);
    expect(result.estimated_duration_seconds).toBeGreaterThan(0);
  });

  it("should accumulate multiple errors", () => {
    const scenario = createValidScenario();
    scenario.id = "";
    scenario.name = "";
    scenario.app_name = "";
    scenario.goals[0].success_criteria = [];
    scenario.goals[0].description = "";

    const result = validateScenario(scenario);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(4);
  });
});
