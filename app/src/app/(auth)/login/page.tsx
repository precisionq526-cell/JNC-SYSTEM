'use client'

import { Suspense, useState } from 'react'
import { clearSupabaseBrowserAuthStorage } from '@/lib/supabase/client'
import { signInAction } from '@/lib/actions/auth'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react'
import styles from './login.module.css'
import { ShopHeader } from '@/components/shop/shop-header'
import { ShopFooter } from '@/components/shop/shop-footer'

export default function LoginPage() {
  return (
    <div className={`shop-shell ${styles.shell}`}>
      <a href="#login-content" className="skip-link">Skip to sign in</a>
      <ShopHeader />
      <main id="login-content" className={styles.main}>
        <Suspense fallback={<LoginShell />}><LoginForm /></Suspense>
      </main>
      <ShopFooter />
    </div>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  const requestedRedirect = searchParams.get('redirect') || '/'
  const redirect = requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//') ? requestedRedirect : '/'
  const error = searchParams.get('error')
  const isAdmin = redirect.startsWith('/admin') || error === 'unauthorized'

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setLoginError(null)
    try {
      clearSupabaseBrowserAuthStorage()
      const result = await signInAction({ email, password })
      if (!result.ok) {
        setLoginError(result.error ?? 'Sign-in failed. Please try again.')
        setLoading(false)
      } else {
        toast.success('Logged in successfully!')
        router.push(redirect)
        router.refresh()
      }
    } catch {
      setLoginError('The sign-in service could not be reached. Check the connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className={styles.content}>
      <section className={`surface ${styles.card}`} aria-labelledby="login-title">
        <div className={styles.heading}>
          <p className={styles.eyebrow}><ShieldCheck size={16} /> {isAdmin ? 'Administration' : 'JandC account'}</p>
          <h1 id="login-title">{isAdmin ? 'Admin sign in' : 'Welcome back'}</h1>
          <p className={styles.subtitle}>{isAdmin ? 'Manage your orders, printers, and shop in one place.' : 'Sign in to manage your orders.'}</p>
        </div>

        {error === 'unauthorized' && <div className={styles.error} role="alert">You do not have permission to access the admin area. Sign in with an administrator account.</div>}
        {loginError && <div className={styles.error} role="alert">{loginError}</div>}

        <form onSubmit={handleLogin} className={styles.form} aria-busy={loading}>
          <div className={`field ${styles.field}`}>
            <label htmlFor="login-email">Email address</label>
            <input id="login-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required disabled={loading} value={email} onChange={event => setEmail(event.target.value)} placeholder={isAdmin ? 'admin@example.com' : 'you@example.com'} />
          </div>

          <div className={`field ${styles.field}`}>
            <label htmlFor="login-password">Password</label>
            <div className={styles.passwordField}>
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required disabled={loading} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" />
              <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} aria-controls="login-password" disabled={loading}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className={`button button-primary ${styles.submit}`}>
            {loading ? <><LoaderCircle size={17} className={styles.spinner} /> Signing in…</> : <>Sign in {isAdmin ? 'to dashboard' : ''}<ArrowRight size={17} /></>}
          </button>
        </form>

        <div className={styles.cardFooter}>
          {isAdmin ? <p>Use the staff account provided by your administrator.</p> : <p>Don’t have an account? <Link href="/register">Create an account</Link></p>}
        </div>
      </section>
      <Link href="/order" className={styles.backLink}><ArrowLeft size={15} /> Back to print services</Link>
    </div>
  )
}

function LoginShell() {
  return (
    <div className={styles.content}>
      <div className={`surface ${styles.card} ${styles.loadingCard}`} role="status" aria-label="Loading sign-in form">
        <div className={styles.skeleton} style={{ width: 140, height: 24 }} />
        <div className={styles.skeleton} style={{ width: 220, height: 34, marginTop: 18 }} />
        <div className={styles.skeleton} style={{ width: '90%', height: 16, marginTop: 12, marginBottom: 30 }} />
        <div className={styles.skeleton} style={{ height: 48, marginBottom: 22 }} />
        <div className={styles.skeleton} style={{ height: 48, marginBottom: 26 }} />
        <div className={styles.skeleton} style={{ height: 48 }} />
      </div>
    </div>
  )
}
