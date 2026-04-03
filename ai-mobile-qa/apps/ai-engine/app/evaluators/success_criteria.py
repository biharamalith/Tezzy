"""
Success criteria evaluation module for scenario execution.

This module provides functions to evaluate success criteria against the current
screen state and Phase B output. Criteria can be:
- Screen type criteria (e.g., "Reach home screen")
- Element presence criteria (e.g., "User profile visible")
- Natural language criteria (evaluated by LLM)
"""

import logging
import re
from typing import Any, Dict, List, Tuple

from app.llm.client import LLMClient

logger = logging.getLogger(__name__)


def evaluate_criterion(
    criterion: str,
    screen_state: Dict[str, Any],
    phase_b_output: Dict[str, Any],
    llm_client: LLMClient | None = None,
) -> bool:
    """
    Evaluate a single success criterion against the current screen state.
    
    Args:
        criterion: The success criterion to evaluate (natural language string)
        screen_state: Current UI state with ui_elements, screen_hash, etc.
        phase_b_output: Phase B (Screen Analyst) output with screen_type, candidate_targets, etc.
        llm_client: Optional LLM client for natural language evaluation
        
    Returns:
        True if criterion is satisfied, False otherwise
        
    Requirements: 11.1, 11.2, 11.3, 11.4, 11.7
    """
    try:
        criterion_lower = criterion.lower().strip()
        
        # Screen type criteria (e.g., "Reach home screen", "Screen type is 'settings'")
        if _is_screen_type_criterion(criterion_lower):
            return _evaluate_screen_type_criterion(criterion_lower, phase_b_output)
        
        # Element presence criteria (e.g., "User profile visible", "Login button present")
        if _is_element_presence_criterion(criterion_lower):
            return _evaluate_element_presence_criterion(criterion_lower, screen_state)
        
        # Natural language criteria - use LLM evaluation
        if llm_client:
            return _evaluate_natural_language_criterion(
                criterion, screen_state, phase_b_output, llm_client
            )
        else:
            logger.warning(
                f"No LLM client provided for natural language criterion: {criterion}. "
                "Treating as not met."
            )
            return False
            
    except Exception as e:
        logger.error(f"Error evaluating criterion '{criterion}': {e}", exc_info=True)
        return False


def _is_screen_type_criterion(criterion_lower: str) -> bool:
    """Check if criterion is about screen type."""
    screen_type_patterns = [
        r"reach\s+(\w+)\s+screen",
        r"screen\s+type\s+is\s+['\"]?(\w+)['\"]?",
        r"on\s+(\w+)\s+screen",
        r"navigate\s+to\s+(\w+)\s+screen",
    ]
    return any(re.search(pattern, criterion_lower) for pattern in screen_type_patterns)


def _is_element_presence_criterion(criterion_lower: str) -> bool:
    """Check if criterion is about element presence."""
    presence_keywords = [
        "visible", "present", "displayed", "shown", "appears",
        "exists", "available", "found", "see", "contains"
    ]
    return any(keyword in criterion_lower for keyword in presence_keywords)


def _evaluate_screen_type_criterion(
    criterion_lower: str,
    phase_b_output: Dict[str, Any]
) -> bool:
    """
    Evaluate screen type criteria by comparing against Phase B output.
    
    Requirements: 11.2
    """
    screen_type = phase_b_output.get("screen_type", "unknown")
    
    # Extract expected screen type from criterion
    screen_type_patterns = [
        r"reach\s+(\w+)\s+screen",
        r"screen\s+type\s+is\s+['\"]?(\w+)['\"]?",
        r"on\s+(\w+)\s+screen",
        r"navigate\s+to\s+(\w+)\s+screen",
    ]
    
    for pattern in screen_type_patterns:
        match = re.search(pattern, criterion_lower)
        if match:
            expected_type = match.group(1).lower()
            result = screen_type.lower() == expected_type
            logger.info(
                f"Screen type criterion: expected='{expected_type}', "
                f"actual='{screen_type}', result={result}"
            )
            return result
    
    logger.warning(f"Could not extract screen type from criterion: {criterion_lower}")
    return False


def _evaluate_element_presence_criterion(
    criterion_lower: str,
    screen_state: Dict[str, Any]
) -> bool:
    """
    Evaluate element presence criteria by checking if element exists in UI.
    
    Requirements: 11.3
    """
    ui_elements = screen_state.get("ui_elements", [])
    
    if not ui_elements:
        logger.info(f"No UI elements in screen state for criterion: {criterion_lower}")
        return False
    
    # Extract element keywords from criterion
    # Remove presence keywords to get the element description
    presence_keywords = [
        "visible", "present", "displayed", "shown", "appears",
        "exists", "available", "found", "see", "contains", "is", "are"
    ]
    
    element_desc = criterion_lower
    for keyword in presence_keywords:
        element_desc = element_desc.replace(keyword, " ")
    element_desc = element_desc.strip()
    
    # Split into keywords for fuzzy matching
    keywords = [w for w in element_desc.split() if len(w) > 2]
    
    if not keywords:
        logger.warning(f"Could not extract element keywords from: {criterion_lower}")
        return False
    
    # Check if any UI element matches the keywords
    for element in ui_elements:
        element_text = str(element.get("text", "")).lower()
        element_id = str(element.get("resource_id", "")).lower()
        element_desc_field = str(element.get("content_desc", "")).lower()
        
        # Combine all element fields for matching
        element_combined = f"{element_text} {element_id} {element_desc_field}"
        
        # Check if all keywords are present in the element
        if all(keyword in element_combined for keyword in keywords):
            logger.info(
                f"Element presence criterion satisfied: '{criterion_lower}' "
                f"matched element: {element.get('resource_id', element.get('text', 'unknown'))}"
            )
            return True
    
    logger.info(
        f"Element presence criterion not satisfied: '{criterion_lower}' "
        f"(checked {len(ui_elements)} elements)"
    )
    return False


async def _evaluate_natural_language_criterion(
    criterion: str,
    screen_state: Dict[str, Any],
    phase_b_output: Dict[str, Any],
    llm_client: LLMClient
) -> bool:
    """
    Evaluate natural language criteria using LLM.
    
    Requirements: 11.4
    """
    try:
        # Build context for LLM
        ui_elements = screen_state.get("ui_elements", [])
        screen_type = phase_b_output.get("screen_type", "unknown")
        candidate_targets = phase_b_output.get("candidate_targets", [])
        
        # Simplify UI elements for LLM (avoid overwhelming context)
        simplified_elements = [
            {
                "text": elem.get("text", ""),
                "resource_id": elem.get("resource_id", ""),
                "content_desc": elem.get("content_desc", ""),
                "class": elem.get("class", ""),
            }
            for elem in ui_elements[:20]  # Limit to first 20 elements
        ]
        
        system_prompt = """You are a QA criterion evaluator. Your job is to determine if a success criterion is satisfied based on the current screen state.

Respond with JSON in this format:
{
  "satisfied": true/false,
  "reasoning": "brief explanation"
}"""
        
        user_prompt = f"""Evaluate this success criterion:
"{criterion}"

Current screen state:
- Screen type: {screen_type}
- Candidate targets: {', '.join(candidate_targets) if candidate_targets else 'none'}
- UI elements: {simplified_elements}

Is the criterion satisfied? Consider:
1. Does the screen type match what's expected?
2. Are the required UI elements present?
3. Is the overall state consistent with the criterion?

Respond with JSON."""
        
        response = await llm_client.chat_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.0,
            timeout_s=30.0,
        )
        
        satisfied = response.get("satisfied", False)
        reasoning = response.get("reasoning", "")
        
        logger.info(
            f"Natural language criterion evaluation: '{criterion}' -> {satisfied}. "
            f"Reasoning: {reasoning}"
        )
        
        return satisfied
        
    except Exception as e:
        logger.error(
            f"Error in natural language criterion evaluation for '{criterion}': {e}",
            exc_info=True
        )
        return False


def evaluate_all_criteria(
    criteria_pending: List[str],
    screen_state: Dict[str, Any],
    phase_b_output: Dict[str, Any],
    llm_client: LLMClient | None = None,
) -> Tuple[List[str], List[str]]:
    """
    Evaluate all pending success criteria and return which are met vs still pending.
    
    Args:
        criteria_pending: List of criteria that haven't been satisfied yet
        screen_state: Current UI state
        phase_b_output: Phase B output
        llm_client: Optional LLM client for natural language evaluation
        
    Returns:
        Tuple of (criteria_met, criteria_still_pending)
        
    Requirements: 11.1, 11.5, 11.6, 11.7
    """
    criteria_met = []
    criteria_still_pending = []
    
    for criterion in criteria_pending:
        try:
            is_met = evaluate_criterion(
                criterion=criterion,
                screen_state=screen_state,
                phase_b_output=phase_b_output,
                llm_client=llm_client,
            )
            
            if is_met:
                criteria_met.append(criterion)
                logger.info(f"✓ Criterion satisfied: {criterion}")
            else:
                criteria_still_pending.append(criterion)
                logger.debug(f"○ Criterion still pending: {criterion}")
                
        except Exception as e:
            # Handle evaluation errors gracefully - treat as not met
            logger.error(
                f"Error evaluating criterion '{criterion}': {e}. Treating as not met.",
                exc_info=True
            )
            criteria_still_pending.append(criterion)
    
    logger.info(
        f"Criteria evaluation complete: {len(criteria_met)} met, "
        f"{len(criteria_still_pending)} still pending"
    )
    
    return criteria_met, criteria_still_pending
