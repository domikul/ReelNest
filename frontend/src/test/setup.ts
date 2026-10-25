import '@testing-library/jest-dom/vitest'

const storageValues = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageValues.size
  },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => Array.from(storageValues.keys())[index] ?? null,
  removeItem: (key) => {
    storageValues.delete(key)
  },
  setItem: (key, value) => {
    storageValues.set(key, String(value))
  },
}

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})
