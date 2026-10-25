'use client'

import Link from 'next/link'
import Image from 'next/image'

export function ShopHeader() {
  return <header className="shop-header">
    <div className="shop-header-inner">
      <Link href="/order" className="shop-brand" aria-label="JandC Internet Cafe and Services home">
        <Image src="/jnconnect-ribbon.png" alt="JNConnect" width={438} height={129} priority className="customer-logo" />
        <span className="customer-brand-title">JandC Internet Cafe and Services</span>
      </Link>
    </div>
  </header>
}
