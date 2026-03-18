#!/bin/bash

# Hook script that transforms Claude Code events and sends them to the Electron app server
# Receives hook data via stdin, normalizes event types, and POSTs to the app's hook endpoint

HOOK_DATA=$(cat)

PAYLOAD=$(node -e "
  const hookData = $HOOK_DATA;
  const hookEvent = hookData.hook_event_name || 'unknown';
  const sessionId = hookData.session_id || 'unknown';
  const toolName = hookData.tool_name || 'unknown';

  // Map Claude Code hook event names to app-specific event types
  let eventType = 'message';
  switch (hookEvent) {
    case 'PreToolUse':
      eventType = 'tool_use';
      break;
    case 'PostToolUse':
      eventType = 'tool_result';
      break;
    case 'PostToolUseFailure':
      eventType = 'tool_failure';
      break;
    case 'UserPromptSubmit':
      eventType = 'thinking_start';
      break;
    case 'Stop':
      eventType = 'thinking_end';
      break;
    case 'PermissionRequest':
      eventType = 'permission_request';
      break;
    case 'Notification':
      eventType = 'notification';
      break;
    case 'SessionStart':
      eventType = 'session_start';
      break;
    case 'SessionEnd':
      eventType = 'session_end';
      break;
    case 'SubagentStop':
      eventType = 'subagent_complete';
      break;
    case 'PreCompact':
      eventType = 'compact_start';
      break;
  }

  // Retrieve agent ID from Claude Code environment variable
  const agentId = process.env.CLAUDE_AGENT_ID || 'unknown';

  // Build normalized payload with metadata for the app
  const payload = {
    agentId: agentId,
    eventType: eventType,
    timestamp: Date.now(),
    data: hookData
  };

  console.log(JSON.stringify(payload));
")

# POST the payload to the Electron app's hook server endpoint
curl -s -X POST "http://localhost:3067/hooks/agent-event" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"

exit 0
