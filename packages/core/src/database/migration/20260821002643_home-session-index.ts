import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260821002643_home-session-index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_v2_active_root_updated_idx\` ON \`session_v2\` (\`parent_id\`,\`time_updated\`) WHERE "session_v2"."parent_id" is null and "session_v2"."time_archived" is null;`,
      )
    })
  },
}

export default migration
