import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { initDatabase, getDb } from '@/db/database'
import type { SQLJsDatabase as DrizzleDb } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'

interface DatabaseContextType {
  db: DrizzleDb<typeof schema> | null
  isLoading: boolean
  error: string | null
}

const DatabaseContext = createContext<DatabaseContextType>({
  db: null,
  isLoading: true,
  error: null,
})

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [db, setDb] = useState<DrizzleDb<typeof schema> | null>(null)

  useEffect(() => {
    initDatabase()
      .then(() => {
        setDb(getDb())
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('[me.md] Database init failed:', err)
        setError(err.message)
        setIsLoading(false)
      })
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading database...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-red-600">
          <p>Failed to load database: {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <DatabaseContext.Provider value={{ db, isLoading, error }}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabase() {
  const ctx = useContext(DatabaseContext)
  if (!ctx.db) throw new Error('useDatabase must be used within DatabaseProvider after init')
  return ctx.db
}
