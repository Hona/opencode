import {
  createRepository,
  type BlobReference,
  type DocumentAddress,
  type DurableRepository,
  type Repository,
} from "./repository"

const DATABASE = "opencode.persistence"
const DOCUMENTS = "documents"
const BLOBS = "blobs"

type DocumentRecord = DocumentAddress & { value: string }
type BlobRecord = BlobReference & { bytes: Uint8Array }

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

function transaction(value: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    value.oncomplete = () => resolve()
    value.onabort = () => reject(value.error)
    value.onerror = () => reject(value.error)
  })
}

function key(address: DocumentAddress) {
  return [address.storage, address.key]
}

function sha256(value: Uint8Array) {
  const bytes = value.slice().buffer
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((hash) => Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""))
}

export class IndexedDBRepository implements DurableRepository {
  private database: Promise<IDBDatabase> | undefined
  private readonly writes = new Set<Promise<unknown>>()

  constructor(private readonly name = DATABASE) {}

  private open() {
    this.database ??= new Promise((resolve, reject) => {
      const opening = indexedDB.open(this.name, 1)
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains(DOCUMENTS)) {
          opening.result.createObjectStore(DOCUMENTS, { keyPath: ["storage", "key"] })
        }
        if (!opening.result.objectStoreNames.contains(BLOBS)) {
          opening.result.createObjectStore(BLOBS, { keyPath: "digest" })
        }
      }
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    return this.database
  }

  async read(address: DocumentAddress) {
    const database = await this.open()
    const record = (await request(
      database.transaction(DOCUMENTS, "readonly").objectStore(DOCUMENTS).get(key(address)),
    )) as DocumentRecord | undefined
    return record?.value ?? null
  }

  commit(input: { address: DocumentAddress; value: string }) {
    return this.track(
      (async () => {
        const database = await this.open()
        const current = database.transaction(DOCUMENTS, "readwrite")
        current.objectStore(DOCUMENTS).put({ ...input.address, value: input.value } satisfies DocumentRecord)
        await transaction(current)
      })(),
    )
  }

  remove(address: DocumentAddress) {
    return this.track(
      (async () => {
        const database = await this.open()
        const current = database.transaction(DOCUMENTS, "readwrite")
        current.objectStore(DOCUMENTS).delete(key(address))
        await transaction(current)
      })(),
    )
  }

  putBlob(bytes: Uint8Array) {
    return this.track(
      (async () => {
        const value = new Uint8Array(bytes)
        const reference = {
          digest: await sha256(value),
          byteLength: value.byteLength,
        }
        const database = await this.open()
        const current = database.transaction(BLOBS, "readwrite")
        current.objectStore(BLOBS).put({ ...reference, bytes: value } satisfies BlobRecord)
        await transaction(current)
        return reference
      })(),
    )
  }

  async readBlob(reference: BlobReference) {
    const database = await this.open()
    const record = (await request(database.transaction(BLOBS, "readonly").objectStore(BLOBS).get(reference.digest))) as
      | BlobRecord
      | undefined
    if (!record) return null
    if (record.byteLength !== reference.byteLength || record.bytes.byteLength !== reference.byteLength) {
      throw new Error(`Blob length mismatch: ${reference.digest}`)
    }
    if ((await sha256(record.bytes)) !== reference.digest) throw new Error(`Blob digest mismatch: ${reference.digest}`)
    return new Uint8Array(record.bytes)
  }

  async drain() {
    const writes = [...this.writes]
    await Promise.all(writes)
  }

  private track<T>(value: Promise<T>) {
    this.writes.add(value)
    void value.then(
      () => this.writes.delete(value),
      () => this.writes.delete(value),
    )
    return value
  }
}

let singleton: Repository | undefined

export function getIndexedDBRepository() {
  singleton ??= createRepository(new IndexedDBRepository())
  return singleton
}
