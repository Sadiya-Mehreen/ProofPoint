# ProofPoint Frontend

Not yet implemented. This directory is a placeholder for the client that will connect to
the FastAPI backend in [../backend/](../backend/):

- `POST /session/start`, `POST /resume/upload`, `GET /github/{username}` for setup
- `WS /ws/{session_id}` for the live interview -- send `{"type": "transcript_chunk", "text": "..."}`,
  receive `transcript_ack` and `no_action` / `agent_interrupt` events back
- `POST /session/{session_id}/end` for the final scorecard
