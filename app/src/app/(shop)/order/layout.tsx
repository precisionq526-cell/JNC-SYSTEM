import { ShopHeader } from '@/components/shop/shop-header'
import { ShopFooter } from '@/components/shop/shop-footer'
import './customer-order.css'

export default function OnlineOrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-shell customer-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <ShopHeader />
      <main id="main-content" className="shop-main">{children}</main>
      <ShopFooter />
    </div>
  )
}
