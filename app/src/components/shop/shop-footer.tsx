import Link from 'next/link'
import {ShopHours} from './shop-hours'

export function ShopFooter() {
  return <footer className="shop-footer">
    <p>JandC Internet Cafe and Services <span aria-hidden="true">|</span> <ShopHours/></p>
    <nav aria-label="Shop links"><Link href="/order">Home</Link><Link href="/order/status">Track order</Link><Link href="/login?redirect=/admin">Staff sign in</Link></nav>
  </footer>
}
