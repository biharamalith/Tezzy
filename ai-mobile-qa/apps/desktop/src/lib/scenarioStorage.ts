/**
 * Scenario Storage
 * 
 * TypeScript wrapper for scenario file operations.
 * Provides functions to save, load, list, and delete scenarios from disk.
 * 
 * Scenarios are stored in ~/.tezzy/scenarios/{scenario_id}.json
 * 
 * Implements requirements 23.1-23.4 from the requirements document.
 */

import { invoke } from "@tauri-apps/api/tauri";
import type { SmokeScenario } from "../types/scenario";

/**
 * Save a scenario to disk
 * 
 * Saves the scenario as a JSON file in ~/.tezzy/scenarios/{scenario_id}.json
 * Creates the directory if it doesn't exist.
 * 
 * @param scenario - The scenario to save
 * @throws Error if save operation fails
 */
export async function saveScenario(scenario: SmokeScenario): Promise<void> {
  try {
    await invoke("save_scenario", { scenario });
    console.log(`Scenario saved: ${scenario.id}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to save scenario ${scenario.id}:`, errorMessage);
    throw new Error(`Failed to save scenario: ${errorMessage}`);
  }
}

/**
 * Load a scenario from disk
 * 
 * Reads the scenario JSON file from ~/.tezzy/scenarios/{scenario_id}.json
 * 
 * @param scenarioId - ID of the scenario to load
 * @returns The loaded scenario
 * @throws Error if scenario not found or load operation fails
 */
export async function loadScenario(scenarioId: string): Promise<SmokeScenario> {
  try {
    const scenario = await invoke<SmokeScenario>("load_scenario", { scenarioId });
    console.log(`Scenario loaded: ${scenarioId}`);
    return scenario;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load scenario ${scenarioId}:`, errorMessage);
    throw new Error(`Failed to load scenario: ${errorMessage}`);
  }
}

/**
 * List all scenarios
 * 
 * Lists all scenario files in ~/.tezzy/scenarios/ directory
 * Returns an array of scenario objects (not just IDs)
 * 
 * @returns Array of all scenarios
 * @throws Error if list operation fails
 */
export async function listScenarios(): Promise<SmokeScenario[]> {
  try {
    const scenarios = await invoke<SmokeScenario[]>("list_scenarios");
    console.log(`Found ${scenarios.length} scenarios`);
    return scenarios;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to list scenarios:", errorMessage);
    throw new Error(`Failed to list scenarios: ${errorMessage}`);
  }
}

/**
 * Delete a scenario from disk
 * 
 * Removes the scenario JSON file from ~/.tezzy/scenarios/{scenario_id}.json
 * 
 * @param scenarioId - ID of the scenario to delete
 * @throws Error if scenario not found or delete operation fails
 */
export async function deleteScenario(scenarioId: string): Promise<void> {
  try {
    await invoke("delete_scenario", { scenarioId });
    console.log(`Scenario deleted: ${scenarioId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to delete scenario ${scenarioId}:`, errorMessage);
    throw new Error(`Failed to delete scenario: ${errorMessage}`);
  }
}

/**
 * Check if a scenario exists
 * 
 * @param scenarioId - ID of the scenario to check
 * @returns true if scenario exists, false otherwise
 */
export async function scenarioExists(scenarioId: string): Promise<boolean> {
  try {
    await loadScenario(scenarioId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get scenario metadata (without loading full scenario)
 * 
 * Returns basic information about a scenario without loading the entire file.
 * Useful for displaying scenario lists.
 * 
 * @param scenarioId - ID of the scenario
 * @returns Metadata object with id, name, description, app_name
 */
export async function getScenarioMetadata(scenarioId: string): Promise<{
  id: string;
  name: string;
  description: string;
  app_name: string;
  goal_count: number;
}> {
  try {
    const scenario = await loadScenario(scenarioId);
    return {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      app_name: scenario.app_name,
      goal_count: scenario.goals.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get scenario metadata: ${errorMessage}`);
  }
}

/**
 * Duplicate a scenario with a new ID
 * 
 * Creates a copy of an existing scenario with a new ID and optionally a new name.
 * 
 * @param sourceScenarioId - ID of the scenario to duplicate
 * @param newScenarioId - ID for the new scenario
 * @param newName - Optional new name for the duplicated scenario
 * @returns The duplicated scenario
 */
export async function duplicateScenario(
  sourceScenarioId: string,
  newScenarioId: string,
  newName?: string
): Promise<SmokeScenario> {
  try {
    const sourceScenario = await loadScenario(sourceScenarioId);
    
    const duplicatedScenario: SmokeScenario = {
      ...sourceScenario,
      id: newScenarioId,
      name: newName || `${sourceScenario.name} (Copy)`,
    };
    
    await saveScenario(duplicatedScenario);
    console.log(`Scenario duplicated: ${sourceScenarioId} -> ${newScenarioId}`);
    
    return duplicatedScenario;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to duplicate scenario ${sourceScenarioId}:`, errorMessage);
    throw new Error(`Failed to duplicate scenario: ${errorMessage}`);
  }
}

/**
 * Export a scenario to a JSON string
 * 
 * Useful for sharing scenarios or backing them up.
 * 
 * @param scenarioId - ID of the scenario to export
 * @returns JSON string representation of the scenario
 */
export async function exportScenarioToJson(scenarioId: string): Promise<string> {
  try {
    const scenario = await loadScenario(scenarioId);
    return JSON.stringify(scenario, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to export scenario: ${errorMessage}`);
  }
}

/**
 * Import a scenario from a JSON string
 * 
 * Parses and validates the JSON, then saves it as a new scenario.
 * 
 * @param jsonString - JSON string representation of a scenario
 * @returns The imported scenario
 * @throws Error if JSON is invalid or save fails
 */
export async function importScenarioFromJson(jsonString: string): Promise<SmokeScenario> {
  try {
    const scenario = JSON.parse(jsonString) as SmokeScenario;
    
    // Basic validation
    if (!scenario.id || !scenario.name || !scenario.app_name || !scenario.goals) {
      throw new Error("Invalid scenario JSON: missing required fields");
    }
    
    await saveScenario(scenario);
    console.log(`Scenario imported: ${scenario.id}`);
    
    return scenario;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to import scenario:", errorMessage);
    throw new Error(`Failed to import scenario: ${errorMessage}`);
  }
}

/**
 * Search scenarios by name or description
 * 
 * @param query - Search query string
 * @returns Array of scenarios matching the query
 */
export async function searchScenarios(query: string): Promise<SmokeScenario[]> {
  try {
    const allScenarios = await listScenarios();
    const lowerQuery = query.toLowerCase();
    
    return allScenarios.filter(scenario => 
      scenario.name.toLowerCase().includes(lowerQuery) ||
      scenario.description.toLowerCase().includes(lowerQuery) ||
      scenario.app_name.toLowerCase().includes(lowerQuery)
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to search scenarios: ${errorMessage}`);
  }
}

/**
 * Get scenarios for a specific app
 * 
 * @param appName - Name of the app to filter by
 * @returns Array of scenarios for the specified app
 */
export async function getScenariosForApp(appName: string): Promise<SmokeScenario[]> {
  try {
    const allScenarios = await listScenarios();
    return allScenarios.filter(scenario => scenario.app_name === appName);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get scenarios for app: ${errorMessage}`);
  }
}

/**
 * Validate and save a scenario
 * 
 * Validates the scenario before saving to catch errors early.
 * 
 * @param scenario - The scenario to validate and save
 * @throws Error if validation fails or save operation fails
 */
export async function validateAndSaveScenario(scenario: SmokeScenario): Promise<void> {
  // Import validator
  const { validateScenario } = await import("./scenarioValidator");
  
  const validationResult = validateScenario(scenario);
  
  if (!validationResult.valid) {
    const errorMessage = validationResult.errors.join("; ");
    throw new Error(`Scenario validation failed: ${errorMessage}`);
  }
  
  if (validationResult.warnings.length > 0) {
    console.warn("Scenario validation warnings:", validationResult.warnings);
  }
  
  await saveScenario(scenario);
}


// ─────────────────────────────────────────────────────────────────────────────
// Import/Export with File Paths (Requirements 23.5, 23.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Import a scenario from an arbitrary file path
 * 
 * Reads a scenario JSON file from any location on disk, validates it,
 * and optionally saves it to the scenarios directory.
 * 
 * @param filePath - Absolute path to the scenario JSON file
 * @param saveToLibrary - Whether to save the imported scenario to ~/.tezzy/scenarios/ (default: true)
 * @returns The imported and validated scenario
 * @throws Error if file cannot be read, JSON is invalid, or validation fails
 */
export async function importScenario(
  filePath: string,
  saveToLibrary: boolean = true
): Promise<SmokeScenario> {
  try {
    // Read file using Tauri command
    const fileContent = await invoke<string>("read_file", { filePath });
    
    // Parse JSON
    let scenario: SmokeScenario;
    try {
      scenario = JSON.parse(fileContent);
    } catch (parseError) {
      throw new Error(`Invalid JSON in file: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
    
    // Validate required fields
    if (!scenario.id || typeof scenario.id !== "string") {
      throw new Error("Invalid scenario: missing or invalid 'id' field");
    }
    if (!scenario.name || typeof scenario.name !== "string") {
      throw new Error("Invalid scenario: missing or invalid 'name' field");
    }
    if (!scenario.description || typeof scenario.description !== "string") {
      throw new Error("Invalid scenario: missing or invalid 'description' field");
    }
    if (!scenario.app_name || typeof scenario.app_name !== "string") {
      throw new Error("Invalid scenario: missing or invalid 'app_name' field");
    }
    if (!Array.isArray(scenario.goals) || scenario.goals.length === 0) {
      throw new Error("Invalid scenario: missing or empty 'goals' array");
    }
    
    // Validate using scenario validator
    const { validateScenario } = await import("./scenarioValidator");
    const validationResult = validateScenario(scenario);
    
    if (!validationResult.valid) {
      const errorMessage = validationResult.errors.join("; ");
      throw new Error(`Scenario validation failed: ${errorMessage}`);
    }
    
    // Log warnings if any
    if (validationResult.warnings.length > 0) {
      console.warn("Scenario validation warnings:", validationResult.warnings);
    }
    
    // Save to library if requested
    if (saveToLibrary) {
      await saveScenario(scenario);
      console.log(`Scenario imported and saved to library: ${scenario.id}`);
    } else {
      console.log(`Scenario imported (not saved to library): ${scenario.id}`);
    }
    
    return scenario;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to import scenario from ${filePath}:`, errorMessage);
    throw new Error(`Failed to import scenario: ${errorMessage}`);
  }
}

/**
 * Export a scenario to an arbitrary file path
 * 
 * Writes a scenario as a formatted JSON file to any location on disk.
 * The scenario can be from the library or a custom scenario object.
 * 
 * @param scenario - The scenario to export (can be scenario object or scenario ID)
 * @param filePath - Absolute path where the JSON file should be written
 * @throws Error if scenario not found or file cannot be written
 */
export async function exportScenario(
  scenario: SmokeScenario | string,
  filePath: string
): Promise<void> {
  try {
    // If scenario is a string (ID), load it first
    let scenarioToExport: SmokeScenario;
    if (typeof scenario === "string") {
      scenarioToExport = await loadScenario(scenario);
    } else {
      scenarioToExport = scenario;
    }
    
    // Convert to formatted JSON
    const jsonContent = JSON.stringify(scenarioToExport, null, 2);
    
    // Write file using Tauri command
    await invoke("write_file", { filePath, content: jsonContent });
    
    console.log(`Scenario exported to: ${filePath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to export scenario to ${filePath}:`, errorMessage);
    throw new Error(`Failed to export scenario: ${errorMessage}`);
  }
}

/**
 * Import multiple scenarios from a directory
 * 
 * Reads all JSON files from a directory and imports them as scenarios.
 * Validates each scenario before importing.
 * 
 * @param directoryPath - Path to directory containing scenario JSON files
 * @param saveToLibrary - Whether to save imported scenarios to library (default: true)
 * @returns Array of successfully imported scenarios and array of errors
 */
export async function importScenariosFromDirectory(
  directoryPath: string,
  saveToLibrary: boolean = true
): Promise<{
  imported: SmokeScenario[];
  errors: Array<{ file: string; error: string }>;
}> {
  const imported: SmokeScenario[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  
  try {
    // List JSON files in directory
    const files = await invoke<string[]>("list_json_files", { directoryPath });
    
    // Import each file
    for (const file of files) {
      try {
        const scenario = await importScenario(file, saveToLibrary);
        imported.push(scenario);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ file, error: errorMessage });
        console.error(`Failed to import ${file}:`, errorMessage);
      }
    }
    
    console.log(`Imported ${imported.length} scenarios from ${directoryPath} (${errors.length} errors)`);
    
    return { imported, errors };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import scenarios from directory: ${errorMessage}`);
  }
}

/**
 * Export multiple scenarios to a directory
 * 
 * Writes multiple scenarios as JSON files to a specified directory.
 * Each scenario is saved as {scenario_id}.json
 * 
 * @param scenarios - Array of scenarios to export (can be scenario objects or IDs)
 * @param directoryPath - Path to directory where files should be written
 * @returns Array of successfully exported scenario IDs and array of errors
 */
export async function exportScenariosToDirectory(
  scenarios: Array<SmokeScenario | string>,
  directoryPath: string
): Promise<{
  exported: string[];
  errors: Array<{ scenarioId: string; error: string }>;
}> {
  const exported: string[] = [];
  const errors: Array<{ scenarioId: string; error: string }> = [];
  
  try {
    // Ensure directory exists
    await invoke("ensure_directory", { directoryPath });
    
    // Export each scenario
    for (const scenario of scenarios) {
      try {
        const scenarioId = typeof scenario === "string" ? scenario : scenario.id;
        const filePath = `${directoryPath}/${scenarioId}.json`;
        
        await exportScenario(scenario, filePath);
        exported.push(scenarioId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const scenarioId = typeof scenario === "string" ? scenario : scenario.id;
        errors.push({ scenarioId, error: errorMessage });
        console.error(`Failed to export ${scenarioId}:`, errorMessage);
      }
    }
    
    console.log(`Exported ${exported.length} scenarios to ${directoryPath} (${errors.length} errors)`);
    
    return { exported, errors };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to export scenarios to directory: ${errorMessage}`);
  }
}

/**
 * Validate a scenario file without importing it
 * 
 * Reads and validates a scenario JSON file without saving it to the library.
 * Useful for checking if a file is a valid scenario before importing.
 * 
 * @param filePath - Path to the scenario JSON file
 * @returns Validation result with valid flag, errors, and warnings
 */
export async function validateScenarioFile(filePath: string): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
  scenario?: SmokeScenario;
}> {
  try {
    // Read and parse file
    const fileContent = await invoke<string>("read_file", { filePath });
    const scenario = JSON.parse(fileContent) as SmokeScenario;
    
    // Validate using scenario validator
    const { validateScenario } = await import("./scenarioValidator");
    const validationResult = validateScenario(scenario);
    
    return {
      valid: validationResult.valid,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      scenario: validationResult.valid ? scenario : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      errors: [`Failed to read or parse file: ${errorMessage}`],
      warnings: [],
    };
  }
}

/**
 * Create a scenario template file
 * 
 * Generates a template scenario JSON file with placeholder values.
 * Useful for users to start creating their own scenarios.
 * 
 * @param filePath - Path where the template should be written
 * @param appName - Optional app name to pre-fill
 */
export async function createScenarioTemplate(
  filePath: string,
  appName?: string
): Promise<void> {
  const template: SmokeScenario = {
    id: "my-scenario-1",
    name: "My Test Scenario",
    description: "Description of what this scenario tests",
    app_name: appName || "com.example.app",
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
        description: "Verify main features are accessible",
        type: "verify",
        success_criteria: [
          "Feature buttons are visible",
          "No error messages displayed",
        ],
      },
    ],
    constraints: {
      max_steps_per_goal: 20,
      timeout_seconds: 300,
      stop_on_first_failure: false,
    },
  };
  
  try {
    await exportScenario(template, filePath);
    console.log(`Scenario template created at: ${filePath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create scenario template: ${errorMessage}`);
  }
}
