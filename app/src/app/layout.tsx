import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import './sop.css'

const poppins = localFont({
  src: [
    { path: './fonts/poppins-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/poppins-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/poppins-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/poppins-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/poppins-800.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-poppins',
})

export const metadata: Metadata = {
  title: 'JandC Internet Cafe and Services',
  description: 'Online ordering system for printing and digital services.',
}

import { AuthProvider } from '@/lib/hooks/use-auth'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`min-h-screen antialiased ${poppins.variable} font-sans`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
