import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Telemetry } from "../telemetry"

export namespace Scheduler {
  const log = Log.create({ service: "scheduler" })

  export type Task = {
    id: string
    interval: number
    run: () => Promise<void>
    scope?: "instance" | "global"
  }

  type Timer = ReturnType<typeof setInterval>
  type Entry = {
    tasks: Map<string, Task>
    timers: Map<string, Timer>
    executionCounts: Map<string, number>
  }

  const create = (): Entry => {
    const tasks = new Map<string, Task>()
    const timers = new Map<string, Timer>()
    const executionCounts = new Map<string, number>()
    return { tasks, timers, executionCounts }
  }

  const shared = create()

  const state = Instance.state(
    () => create(),
    async (entry) => {
      for (const timer of entry.timers.values()) {
        clearInterval(timer)
      }
      entry.tasks.clear()
      entry.timers.clear()
      entry.executionCounts.clear()
    },
  )

  export function register(task: Task) {
    using span = Telemetry.span("scheduler.register", {
      "scheduler.task.id": task.id,
      "scheduler.interval_ms": task.interval,
      "scheduler.scope": task.scope ?? "instance",
      "execution.context": "scheduled",
    })

    const scope = task.scope ?? "instance"
    const entry = scope === "global" ? shared : state()
    const current = entry.timers.get(task.id)
    if (current && scope === "global") return
    if (current) clearInterval(current)

    entry.tasks.set(task.id, task)
    entry.executionCounts.set(task.id, 0)
    
    void Telemetry.withSpan(
      "scheduler.task.initial",
      {
        "scheduler.task.id": task.id,
        "execution.context": "scheduled",
      },
      async () => {
        await run(task, entry)
      }
    )
    
    const timer = setInterval(() => {
      void Telemetry.withSpan(
        "scheduler.task.execute",
        {
          "scheduler.task.id": task.id,
          "scheduler.interval_ms": task.interval,
          "scheduler.execution.count": (entry.executionCounts.get(task.id) ?? 0) + 1,
          "execution.context": "scheduled",
        },
        async () => {
          await run(task, entry)
        }
      )
    }, task.interval)
    timer.unref()
    entry.timers.set(task.id, timer)
  }

  async function run(task: Task, entry: Entry) {
    log.info("run", { id: task.id })
    const count = entry.executionCounts.get(task.id) ?? 0
    entry.executionCounts.set(task.id, count + 1)
    
    await task.run().catch((error) => {
      log.error("run failed", { id: task.id, error })
    })
  }
}
