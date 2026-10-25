/**
 * Mobile Bridge — File Transfer Session Types
 *
 * A transfer session ties a kiosk screen to a mobile phone.
 * The kiosk generates a short-lived session, displays a QR code,
 * and the phone uploads files into that session via a simple webpage.
 * Supabase Realtime pushes the uploaded file metadata to the kiosk instantly.
 */

export interface TransferSession {
  id: string
  /** Short 6-char code for manual entry */
  shortCode: string
  /** ISO timestamp — session expires after this */
  expiresAt: string
  /** Which kiosk created it */
  kioskStationId: string | null
  /** Current status */
  status: 'active' | 'completed' | 'expired'
  createdAt: string
}

export interface TransferFile {
  id: string
  sessionId: string
  fileName: string
  fileSize: number
  fileType: string
  /** Supabase Storage path */
  storagePath: string
  /** Upload timestamp */
  uploadedAt: string
  /** Optional thumbnail for images */
  thumbnailUrl?: string
  /** Optional browser-readable data URL */
  dataUrl?: string
}

/** Stored in sessionStorage on the kiosk to track the active session */
export const TRANSFER_SESSION_KEY = 'printhub:transfer-session'

/** Session lifetime in minutes */
export const SESSION_LIFETIME_MINUTES = 15

/** Storage bucket for transfer files */
export const TRANSFER_BUCKET = 'transfer-files'
