import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useDatabase } from './DatabaseContext'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { scheduleSave } from '@/db/persistence'

const LOCAL_USER_ID = 'local-user'

interface User {
  id: string
  email: string | null
  name: string | null
  dateOfBirth: string | null
  location: string | null
  occupation: string | null
  gender: string | null
  onboardingCompleted: boolean
  themePreference: string
  sessionLengthDefault: number
}

interface UserContextType {
  user: User | null
  isLoading: boolean
  updateUser: (data: Partial<User>) => void
  createUser: (data: Partial<User>) => void
  getApiKey: () => string | null
  setApiKey: (key: string) => void
}

const UserContext = createContext<UserContextType>({
  user: null,
  isLoading: true,
  updateUser: () => {},
  createUser: () => {},
  getApiKey: () => null,
  setApiKey: () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const db = useDatabase()
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const rows = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).all()
    if (rows.length > 0) {
      const row = rows[0]
      setUser({
        id: row.id,
        email: row.email,
        name: row.name,
        dateOfBirth: row.dateOfBirth,
        location: row.location,
        occupation: row.occupation,
        gender: row.gender,
        onboardingCompleted: row.onboardingCompleted ?? false,
        themePreference: row.themePreference ?? 'light',
        sessionLengthDefault: row.sessionLengthDefault ?? 15,
      })
    }
    setIsLoading(false)
  }, [db])

  const createUser = useCallback((data: Partial<User>) => {
    db.insert(users).values({
      id: LOCAL_USER_ID,
      name: data.name ?? null,
      email: data.email ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      location: data.location ?? null,
      occupation: data.occupation ?? null,
      gender: data.gender ?? null,
      onboardingCompleted: false,
      themePreference: 'light',
      sessionLengthDefault: 15,
    }).run()
    scheduleSave()

    const rows = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).all()
    if (rows.length > 0) {
      const row = rows[0]
      setUser({
        id: row.id,
        email: row.email,
        name: row.name,
        dateOfBirth: row.dateOfBirth,
        location: row.location,
        occupation: row.occupation,
        gender: row.gender,
        onboardingCompleted: row.onboardingCompleted ?? false,
        themePreference: row.themePreference ?? 'light',
        sessionLengthDefault: row.sessionLengthDefault ?? 15,
      })
    }
  }, [db])

  const updateUser = useCallback((data: Partial<User>) => {
    db.update(users)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(users.id, LOCAL_USER_ID))
      .run()
    scheduleSave()
    setUser((prev) => prev ? { ...prev, ...data } : prev)
  }, [db])

  const getApiKey = useCallback(() => {
    return localStorage.getItem('memd_api_key')
  }, [])

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem('memd_api_key', key)
  }, [])

  return (
    <UserContext.Provider value={{ user, isLoading, updateUser, createUser, getApiKey, setApiKey }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}

export { LOCAL_USER_ID }
