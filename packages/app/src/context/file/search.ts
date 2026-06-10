type FileSearchClient = {
  v2: {
    fs: {
      find: (input: { query: string; type?: "file"; limit: string }) => Promise<{
        data?: { data: readonly { path: string }[] }
      }>
    }
  }
}

export function searchFiles(
  client: FileSearchClient,
  normalize: (path: string) => string,
  query: string,
  type?: "file",
) {
  return client.v2.fs.find({ query, type, limit: "10" }).then(
    (response) => (response.data?.data ?? []).map((entry) => normalize(entry.path)),
    () => [],
  )
}
