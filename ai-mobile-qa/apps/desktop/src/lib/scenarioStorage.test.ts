/**
 * Integration Tests for Scenario Storage
 * 
 * Tests the complete scenario storage system including:
 * - Save and load round-trip
 * - List scenarios
 * - Delete scenarios
 * - Import from external file
 * - Export to external file
 * - Error handling for malformed JSON
 * 
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SmokeScenario } from "../types/scenario";
import {
  saveScenario,
  loadScenario,
  listScenarios,
  deleteScenario,
  importScenario,
  exportScenario,
  scenarioExists,
  duplicateScenario,
  validateAndSaveScenario,
} from "./scenarioStorage";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Test scenario data
const createTestScenario = (id: string = "test-scenario-1"): SmokeScenario => ({
  id,
  name: "Test Scenario",
  description: "A test scenario for integration testing",
  app_name: "com.example.testapp",
  goals: [
    {
      id: "goal-1",
      description: "Navigate to home screen",
      type: "navigate",
      success_criteria: [
        "Home screen is visible",
        "Navigation bar is present",
      ],
      hints: {
        expected_screens: ["Home", "Dashboard"],
      },
    },
    {
      id: "goal-2",
      description: "Verify main features",
      type: "verify",
      success_criteria: [
        "Feature buttons are visible",
        "No error messages",
      ],
    },
  ],
  constraints: {
    max_steps_per_goal: 20,
    timeout_seconds: 300,
    stop_on_first_failure: false,
  },
});

describe("Scenario Storage - Save and Load", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should save a scenario successfully", async () => {
    const scenario = createTestScenario();
    mockInvoke.mockResolvedValueOnce(undefined);

    await saveScenario(scenario);

    expect(mockInvoke).toHaveBeenCalledWith("save_scenario", { scenario });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("should load a scenario successfully", async () => {
    const scenario = createTestScenario();
    mockInvoke.mockResolvedValueOnce(scenario);

    const loaded = await loadScenario("test-scenario-1");

    expect(mockInvoke).toHaveBeenCalledWith("load_scenario", {
      scenarioId: "test-scenario-1",
    });
    expect(loaded).toEqual(scenario);
  });

  it("should complete save and load round-trip", async () => {
    const scenario = createTestScenario();
    
    // Mock save
    mockInvoke.mockResolvedValueOnce(undefined);
    await saveScenario(scenario);
    
    // Mock load
    mockInvoke.mockResolvedValueOnce(scenario);
    const loaded = await loadScenario(scenario.id);

    expect(loaded).toEqual(scenario);
    expect(loaded.id).toBe(scenario.id);
    expect(loaded.name).toBe(scenario.name);
    expect(loaded.goals).toHaveLength(2);
  });

  it("should throw error when saving fails", async () => {
    const scenario = createTestScenario();
    mockInvoke.mockRejectedValueOnce(new Error("Disk write failed"));

    await expect(saveScenario(scenario)).rejects.toThrow(
      "Failed to save scenario"
    );
  });

  it("should throw error when loading non-existent scenario", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Scenario not found"));

    await expect(loadScenario("non-existent")).rejects.toThrow(
      "Failed to load scenario"
    );
  });
});

describe("Scenario Storage - List Scenarios", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should list all saved scenarios", async () => {
    const scenarios = [
      createTestScenario("scenario-1"),
      createTestScenario("scenario-2"),
      createTestScenario("scenario-3"),
    ];
    mockInvoke.mockResolvedValueOnce(scenarios);

    const result = await listScenarios();

    expect(mockInvoke).toHaveBeenCalledWith("list_scenarios");
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("scenario-1");
    expect(result[1].id).toBe("scenario-2");
    expect(result[2].id).toBe("scenario-3");
  });

  it("should return empty array when no scenarios exist", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    const result = await listScenarios();

    expect(result).toEqual([]);
  });

  it("should throw error when list operation fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Directory read failed"));

    await expect(listScenarios()).rejects.toThrow("Failed to list scenarios");
  });
});

describe("Scenario Storage - Delete Scenario", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should delete a scenario successfully", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await deleteScenario("test-scenario-1");

    expect(mockInvoke).toHaveBeenCalledWith("delete_scenario", {
      scenarioId: "test-scenario-1",
    });
  });

  it("should verify scenario is removed after deletion", async () => {
    const scenario = createTestScenario();
    
    // Save scenario
    mockInvoke.mockResolvedValueOnce(undefined);
    await saveScenario(scenario);
    
    // Delete scenario
    mockInvoke.mockResolvedValueOnce(undefined);
    await deleteScenario(scenario.id);
    
    // Try to load (should fail)
    mockInvoke.mockRejectedValueOnce(new Error("Scenario not found"));
    await expect(loadScenario(scenario.id)).rejects.toThrow();
  });

  it("should throw error when deleting non-existent scenario", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Scenario not found"));

    await expect(deleteScenario("non-existent")).rejects.toThrow(
      "Failed to delete scenario"
    );
  });
});

describe("Scenario Storage - Import from External File", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should import scenario from external file", async () => {
    const scenario = createTestScenario();
    const filePath = "/path/to/scenario.json";
    
    // Mock read_file
    mockInvoke.mockResolvedValueOnce(JSON.stringify(scenario));
    
    // Mock save_scenario
    mockInvoke.mockResolvedValueOnce(undefined);

    const imported = await importScenario(filePath);

    expect(mockInvoke).toHaveBeenCalledWith("read_file", { filePath });
    expect(mockInvoke).toHaveBeenCalledWith("save_scenario", { scenario });
    expect(imported).toEqual(scenario);
  });

  it("should import without saving to library when saveToLibrary is false", async () => {
    const scenario = createTestScenario();
    const filePath = "/path/to/scenario.json";
    
    // Mock read_file
    mockInvoke.mockResolvedValueOnce(JSON.stringify(scenario));

    const imported = await importScenario(filePath, false);

    expect(mockInvoke).toHaveBeenCalledWith("read_file", { filePath });
    expect(mockInvoke).not.toHaveBeenCalledWith("save_scenario", expect.any(Object));
    expect(imported).toEqual(scenario);
  });

  it("should throw error for malformed JSON", async () => {
    const filePath = "/path/to/invalid.json";
    
    // Mock read_file with invalid JSON
    mockInvoke.mockResolvedValueOnce("{ invalid json }");

    await expect(importScenario(filePath)).rejects.toThrow(
      "Invalid JSON in file"
    );
  });

  it("should throw error for missing required fields", async () => {
    const filePath = "/path/to/incomplete.json";
    
    // Mock read_file with incomplete scenario
    const incompleteScenario = {
      id: "test",
      name: "Test",
      // Missing description, app_name, goals
    };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(incompleteScenario));

    await expect(importScenario(filePath)).rejects.toThrow(
      "Invalid scenario"
    );
  });

  it("should throw error when file cannot be read", async () => {
    const filePath = "/path/to/nonexistent.json";
    
    mockInvoke.mockRejectedValueOnce(new Error("File not found"));

    await expect(importScenario(filePath)).rejects.toThrow(
      "Failed to import scenario"
    );
  });
});

describe("Scenario Storage - Export to External File", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should export scenario to external file", async () => {
    const scenario = createTestScenario();
    const filePath = "/path/to/export.json";
    
    // Mock write_file
    mockInvoke.mockResolvedValueOnce(undefined);

    await exportScenario(scenario, filePath);

    expect(mockInvoke).toHaveBeenCalledWith("write_file", {
      filePath,
      content: JSON.stringify(scenario, null, 2),
    });
  });

  it("should export scenario by ID", async () => {
    const scenario = createTestScenario();
    const filePath = "/path/to/export.json";
    
    // Mock load_scenario
    mockInvoke.mockResolvedValueOnce(scenario);
    
    // Mock write_file
    mockInvoke.mockResolvedValueOnce(undefined);

    await exportScenario("test-scenario-1", filePath);

    expect(mockInvoke).toHaveBeenCalledWith("load_scenario", {
      scenarioId: "test-scenario-1",
    });
    expect(mockInvoke).toHaveBeenCalledWith("write_file", {
      filePath,
      content: JSON.stringify(scenario, null, 2),
    });
  });

  it("should throw error when export fails", async () => {
    const scenario = createTestScenario();
    const filePath = "/path/to/export.json";
    
    mockInvoke.mockRejectedValueOnce(new Error("Write permission denied"));

    await expect(exportScenario(scenario, filePath)).rejects.toThrow(
      "Failed to export scenario"
    );
  });

  it("should complete import-export round-trip", async () => {
    const scenario = createTestScenario();
    const exportPath = "/path/to/export.json";
    const importPath = "/path/to/import.json";
    
    // Export
    mockInvoke.mockResolvedValueOnce(undefined);
    await exportScenario(scenario, exportPath);
    
    // Import
    mockInvoke.mockResolvedValueOnce(JSON.stringify(scenario));
    mockInvoke.mockResolvedValueOnce(undefined);
    const imported = await importScenario(importPath);

    expect(imported).toEqual(scenario);
  });
});

describe("Scenario Storage - Error Handling", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should handle malformed JSON gracefully", async () => {
    const filePath = "/path/to/malformed.json";
    
    mockInvoke.mockResolvedValueOnce("{ malformed: json }");

    await expect(importScenario(filePath)).rejects.toThrow();
  });

  it("should handle missing id field", async () => {
    const filePath = "/path/to/no-id.json";
    
    const scenarioWithoutId = {
      name: "Test",
      description: "Test",
      app_name: "com.test",
      goals: [],
    };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(scenarioWithoutId));

    await expect(importScenario(filePath)).rejects.toThrow(
      "missing or invalid 'id' field"
    );
  });

  it("should handle empty goals array", async () => {
    const filePath = "/path/to/no-goals.json";
    
    const scenarioWithoutGoals = {
      id: "test",
      name: "Test",
      description: "Test",
      app_name: "com.test",
      goals: [],
    };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(scenarioWithoutGoals));

    await expect(importScenario(filePath)).rejects.toThrow(
      "missing or empty 'goals' array"
    );
  });

  it("should handle network/disk errors gracefully", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Disk I/O error"));

    await expect(loadScenario("test")).rejects.toThrow(
      "Failed to load scenario"
    );
  });
});

describe("Scenario Storage - Helper Functions", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should check if scenario exists", async () => {
    const scenario = createTestScenario();
    
    // Scenario exists
    mockInvoke.mockResolvedValueOnce(scenario);
    const exists = await scenarioExists("test-scenario-1");
    expect(exists).toBe(true);
    
    // Scenario doesn't exist
    mockInvoke.mockRejectedValueOnce(new Error("Not found"));
    const notExists = await scenarioExists("non-existent");
    expect(notExists).toBe(false);
  });

  it("should duplicate a scenario", async () => {
    const scenario = createTestScenario();
    
    // Mock load
    mockInvoke.mockResolvedValueOnce(scenario);
    
    // Mock save
    mockInvoke.mockResolvedValueOnce(undefined);

    const duplicated = await duplicateScenario(
      "test-scenario-1",
      "test-scenario-2",
      "Test Scenario Copy"
    );

    expect(duplicated.id).toBe("test-scenario-2");
    expect(duplicated.name).toBe("Test Scenario Copy");
    expect(duplicated.goals).toEqual(scenario.goals);
  });

  it("should validate and save scenario", async () => {
    const scenario = createTestScenario();
    
    // Mock save
    mockInvoke.mockResolvedValueOnce(undefined);

    await validateAndSaveScenario(scenario);

    expect(mockInvoke).toHaveBeenCalledWith("save_scenario", { scenario });
  });

  it("should reject invalid scenario on validateAndSave", async () => {
    const invalidScenario = {
      ...createTestScenario(),
      goals: [], // Empty goals array
    };

    await expect(validateAndSaveScenario(invalidScenario)).rejects.toThrow(
      "Scenario validation failed"
    );
  });
});

describe("Scenario Storage - Batch Operations", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("should save multiple scenarios", async () => {
    const scenarios = [
      createTestScenario("scenario-1"),
      createTestScenario("scenario-2"),
      createTestScenario("scenario-3"),
    ];

    // Mock save for each scenario
    mockInvoke.mockResolvedValue(undefined);

    for (const scenario of scenarios) {
      await saveScenario(scenario);
    }

    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it("should load multiple scenarios", async () => {
    const scenarios = [
      createTestScenario("scenario-1"),
      createTestScenario("scenario-2"),
    ];

    // Mock load for each scenario
    mockInvoke
      .mockResolvedValueOnce(scenarios[0])
      .mockResolvedValueOnce(scenarios[1]);

    const loaded1 = await loadScenario("scenario-1");
    const loaded2 = await loadScenario("scenario-2");

    expect(loaded1.id).toBe("scenario-1");
    expect(loaded2.id).toBe("scenario-2");
  });

  it("should delete multiple scenarios", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await deleteScenario("scenario-1");
    await deleteScenario("scenario-2");
    await deleteScenario("scenario-3");

    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });
});
