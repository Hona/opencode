export namespace Binary {
  export function search<T>(array: T[], id: string, compare: (item: T) => string) {
    let left = 0
    let right = array.length - 1

    while (left <= right) {
      const middle = Math.floor((left + right) / 2)
      const value = compare(array[middle])
      if (value === id) return { found: true, index: middle }
      if (value < id) left = middle + 1
      else right = middle - 1
    }
    return { found: false, index: left }
  }
}
