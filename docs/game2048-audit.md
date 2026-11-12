# 2048 action journal

Apply supabase/migrations/20261113_game_run_events.sql in the project's Supabase SQL Editor **before** deploying this backend. No new environment variables are needed. The migration can safely run again. It creates the private game_run_events table, the audit_action column and a transactional trigger. Never deploy the code before applying the migration: inserts and updates include the new column.

The server supplies a unique request ID, rules version, move direction, spawn and Durov result in its existing game_runs write. The database appends a separate event with before/after snapshots and its own timestamp. A failed event insertion rolls back the game update. There is no additional HTTP request per move and no frontend change. There is still database overhead; production latency should be observed after rollout.

Successful moves, Undo and finish are recorded. Attempts that do not change the board, rejected requests and animation timings are not recorded. A new game starts with a start event. A game already in progress begins with a checkpoint on its next state change and is always labelled partial. Old completed games cannot be reconstructed. Direct database changes without matching action metadata are retained as inferred or unexplained events; stale metadata is not reused by the weekly finalizer.

The journal has RLS enabled. anon/authenticated roles have no access. service_role can read it but cannot directly insert, update or delete events; the SECURITY DEFINER trigger appends them. Deleting the underlying run cascades its journal, so this is not an immutable archive against a database administrator. Keep service-role keys on the backend only.

From lottery-server with its server .env available:

    node scripts/replay2048.mjs <run-uuid>

This command only reads the journal and run. It checks the initial state, every known-version move using the same authoritative engine as the game, spawn, Durov, Undo restoration, chain continuity and the final stored state. Output lists milestones such as reaching 2048, their move numbers and database timestamps. For an active game the command verifies a bounded captured prefix; it does not compare against a board that may continue changing. Unknown rules versions or missing directions are explicitly unverified. Preserve old engine versions in the replay tool when changing rules.

verified means the recorded transitions match these rules. It does not prove a human made the moves, verify payments, enforce rate limits or prevent concurrent requests. Those are separate tasks. Repeated Undo moves are counted as events even though the run's moves counter goes backwards.

Run npm test for isolated PostgreSQL (PGlite) and handler tests. Test credentials are dummy values; tests do not contact production.
