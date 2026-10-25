'use client'

import { useState } from 'react'
import { clearSupabaseBrowserAuthStorage, createClient } from '@/lib/supabase/client'
import { createCustomerProfileAction } from '@/lib/actions/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, UserPlus } from 'lucide-react'
import { ShopHeader } from '@/components/shop/shop-header'
import { ShopFooter } from '@/components/shop/shop-footer'
import styles from '../login/login.module.css'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      clearSupabaseBrowserAuthStorage()
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
      if (error) { toast.error(error.message); setLoading(false); return }

      if (data.user && data.session) {
        const profileResult = await createCustomerProfileAction({
          userId: data.user.id,
          email,
          fullName,
        })
        if (!profileResult.ok) {
          toast.error(profileResult.error ?? 'Account created, but profile setup failed.')
          setLoading(false)
          return
        }
      }

      toast.success('Account created. Please verify your email before logging in.')
      router.push('/login')
    } catch {
      toast.error('Could not reach Supabase Auth. Please check your network or Supabase project status.')
      setLoading(false)
    }
  }

  return <div className={`shop-shell ${styles.shell}`}>
    <a href="#register-content" className="skip-link">Skip to registration</a><ShopHeader />
    <main id="register-content" className={styles.main}><div className={styles.content}>
      <section className={`surface ${styles.card}`} aria-labelledby="register-title">
        <div className={styles.heading}><p className={styles.eyebrow}><UserPlus size={16} /> Your JandC account</p><h1 id="register-title">Make yourself at home.</h1><p className={styles.subtitle}>Create an account for your next print project.</p></div>
        <form onSubmit={handleRegister} className={styles.form} aria-busy={loading}>
          <div className={`field ${styles.field}`}><label htmlFor="register-name">Full name</label><input id="register-name" type="text" autoComplete="name" required maxLength={120} disabled={loading} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Juan Dela Cruz" /></div>
          <div className={`field ${styles.field}`}><label htmlFor="register-email">Email address</label><input id="register-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required disabled={loading} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>
          <div className={`field ${styles.field}`}><label htmlFor="register-password">Password</label><div className={styles.passwordField}><input id="register-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} required disabled={loading} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" /><button type="button" className={styles.passwordToggle} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={loading} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
          <button type="submit" disabled={loading} className={`button button-primary ${styles.submit}`}>{loading ? <><LoaderCircle size={17} className={styles.spinner} /> Creating account…</> : <>Create account <ArrowRight size={17} /></>}</button>
        </form>
        <div className={styles.cardFooter}><p>Already have an account? <Link href="/login">Sign in</Link></p></div>
      </section>
      <Link href="/order" className={styles.backLink}><ArrowLeft size={15} /> Back to print services</Link>
    </div></main><ShopFooter />
  </div>
}
