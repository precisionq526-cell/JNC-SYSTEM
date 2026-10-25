import Image from 'next/image'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
    <Image src="/jnconnect-logo.png" alt="JNConnect" width={140} height={40} className="brand-logo" priority />
    <span className="brand-name">JandC<span>Internet Cafe & Services</span></span>
  </span>
}
