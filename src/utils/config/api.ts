// Dynamically adapt to all API key situations, theoretically should not fail
export function getObjectWithoutAPIKeys<T extends Record<string, any>>(originalObject: T): T {
  function deepClean(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(deepClean)
    }
    if (obj && typeof obj === "object") {
      const newObj: Record<string, any> = {}
      for (const key in obj) {
        // `apiKey` and the rotation extras `apiKeys` are equally sensitive.
        if (key === "apiKey" || key === "apiKeys") {
          continue
        }
        newObj[key] = deepClean(obj[key])
      }
      return newObj
    }
    return obj
  }

  try {
    return deepClean(originalObject)
  } catch {
    return originalObject
  }
}

export function hasAPIKey(obj: any): boolean {
  function deepCheck(value: any): boolean {
    if (Array.isArray(value)) {
      return value.some(deepCheck)
    }
    if (value && typeof value === "object") {
      for (const key in value) {
        if (key === "apiKey" && value[key]) {
          return true
        }
        if (key === "apiKeys" && Array.isArray(value[key]) && value[key].some((k: any) => k)) {
          return true
        }
        if (deepCheck(value[key])) {
          return true
        }
      }
    }
    return false
  }

  try {
    return deepCheck(obj)
  } catch {
    return false
  }
}
