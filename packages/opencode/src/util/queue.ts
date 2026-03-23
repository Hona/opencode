import { Telemetry } from "../telemetry"

export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private name: string

  constructor(name = "default") {
    this.name = name
  }

  push(item: T) {
    using span = Telemetry.span("queue.enqueue", {
      "queue.name": this.name,
      "queue.depth": this.queue.length + 1,
      "queue.item.type": typeof item,
      "execution.context": "background",
    })

    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) {
      const item = this.queue.shift()!
      Telemetry.span("queue.dequeue", {
        "queue.name": this.name,
        "queue.depth": this.queue.length,
        "execution.context": "background",
      })
      return item
    }
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }

  get depth() {
    return this.queue.length
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  return Telemetry.withSpan(
    "queue.work",
    {
      "queue.concurrency": concurrency,
      "queue.batch.size": items.length,
      "execution.context": "background",
    },
    async () => {
      const pending = [...items]
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (true) {
            const item = pending.pop()
            if (item === undefined) return
            await Telemetry.withSpan(
              "queue.work.item",
              {
                "queue.concurrency": concurrency,
                "queue.remaining": pending.length,
                "execution.context": "background",
              },
              async () => {
                await fn(item)
              }
            )
          }
        }),
      )
    }
  )
}
