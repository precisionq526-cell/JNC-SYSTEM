'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'
import { Profile } from '@/lib/types/database'
import { Toaster } from 'react-hot-toast'
import { usePathname } from 'next/navigation'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const shouldLoadAuth = pathname?.startsWith('/admin') ?? false

  useEffect(() => {
    if (!shouldLoadAuth) {
      setUser(null)
      setProfile(null)
      setLoading(false)
      return
    }

    const supabase = createClient()

    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        setUser(user)

        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()
          setProfile(profile)
        }
      } catch (error) {
        console.warn('Supabase auth bootstrap failed; continuing as guest.', error)
        setUser(null)
        setProfile(null)
      } finally {
        setLoading(false)
      }
    }

    fetchUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const currentUser = session?.user || null
        setUser(currentUser)

        if (currentUser) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single()
          setProfile(profile)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [shouldLoadAuth])

  const signOut = async () => {
    try {
      await createClient().auth.signOut()
    } catch (error) {
      console.warn('Supabase sign-out failed locally.', error)
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      <Toaster 
        position="top-right"
        toastOptions={{
          className: 'glass-card text-white border-[hsl(220,15%,20%)]',
          style: {
            background: 'hsl(222, 40%, 15%)',
            color: '#fff',
            border: '1px solid hsl(220, 15%, 20%)',
            backdropFilter: 'blur(10px)',
          },
        }}
      />
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
