import { createCheckpointController } from "./checkpoint"

export type DocumentAddress = {
  storage: string
  key: string
}

export type BlobReference = {
  digest: string
  byteLength: number
}

export type DocumentValue = string | (() => string)

export interface Repository {
  read(address: DocumentAddress): Promise<string | null>
  commit(input: { address: DocumentAddress; value: DocumentValue }): void
  remove(address: DocumentAddress): Promise<void>
  putBlob(bytes: Uint8Array): Promise<BlobReference>
  readBlob(reference: BlobReference): Promise<Uint8Array | null>
  drain(): Promise<void>
}

export interface DurableRepository {
  read(address: DocumentAddress): Promise<string | null>
  commit(input: { address: DocumentAddress; value: string }): Promise<void>
  remove(address: DocumentAddress): Promise<void>
  putBlob(bytes: Uint8Array): Promise<BlobReference>
  readBlob(reference: BlobReference): Promise<Uint8Array | null>
  drain(): Promise<void>
}

export function createRepository(durable: DurableRepository): Repository {
  const checkpoints = new Map<string, ReturnType<typeof createCheckpointController<DocumentValue>>>()
  const id = (address: DocumentAddress) => `${address.storage}\0${address.key}`

  return {
    read: (address) => durable.read(address),
    commit(input) {
      const key = id(input.address)
      const existing = checkpoints.get(key)
      if (existing) return existing.checkpoint(input.value)
      const checkpoint = createCheckpointController((value: DocumentValue) =>
        durable.commit({ address: input.address, value: typeof value === "function" ? value() : value }),
      )
      checkpoints.set(key, checkpoint)
      checkpoint.checkpoint(input.value)
    },
    async remove(address) {
      const key = id(address)
      const checkpoint = checkpoints.get(key)
      checkpoint?.discard()
      checkpoints.delete(key)
      await checkpoint?.idle()
      await durable.remove(address)
    },
    putBlob: (bytes) => durable.putBlob(bytes),
    readBlob: (reference) => durable.readBlob(reference),
    async drain() {
      await Promise.all([...checkpoints.values()].map((checkpoint) => checkpoint.drain()))
      await durable.drain()
    },
  }
}
