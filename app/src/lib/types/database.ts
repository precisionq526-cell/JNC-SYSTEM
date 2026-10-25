// ============================================
// DATABASE TYPES (mirrors Supabase schema)
// ============================================

export type UserRole = 'customer' | 'admin' | 'kiosk'

export type OrderStatus = 'pending' | 'queued' | 'processing' | 'finishing' | 'completed' | 'collected' | 'cancelled' | 'failed'

export type OrderSource = 'kiosk' | 'online'

export type QueueEntryStatus = 'waiting' | 'serving' | 'served' | 'skipped' | 'cancelled'

export type ServiceOptionType = 'select' | 'number' | 'toggle' | 'text'

export type AssetClassification = 'document' | 'image'

export type HardwareDeviceType = 'printer' | 'computer' | 'kiosk_terminal'

export type HardwareDeviceStatus = 'online' | 'offline' | 'error' | 'busy'

export type PrintJobAssignmentStatus = 'pending' | 'assigned' | 'processing' | 'completed' | 'failed' | 'rerouted'

// ============================================
// TABLE TYPES
// ============================================

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Service {
  id: string
  name: string
  slug: string
  description: string | null
  icon: string | null
  base_price: number
  estimated_duration_minutes: number
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export interface ServiceOption {
  id: string
  service_id: string
  name: string
  option_type: ServiceOptionType
  choices: string[] | null
  default_value: string | null
  price_modifier: number
  is_required: boolean
  display_order: number
  created_at: string
}

export interface KioskStation {
  id: string
  station_name: string
  location: string | null
  device_token: string
  is_online: boolean
  last_heartbeat: string | null
  ip_address: string | null
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Order {
  pricing_quote?: import('@/lib/sop/pricing').PrintQuote | null
  student_status?: 'none' | 'pending' | 'approved' | 'rejected'
  student_proof?: {path:string; name:string; type:string} | null
  payment_expires_at?: string | null
  ticket_released_at?: string | null
  finishing_at?: string | null
  collected_at?: string | null
  collected_by?: string | null
  disposal_recorded_at?: string | null
  setup_duration_minutes?: number
  id: string
  order_number: string
  source: OrderSource
  kiosk_station_id: string | null
  customer_id: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  service_id: string
  service_options: Record<string, unknown>
  status: OrderStatus
  is_rush: boolean
  priority_score: number
  estimated_duration_minutes: number | null
  total_price: number
  is_paid: boolean
  payment_method: string | null
  local_synced: boolean
  local_path: string | null
  processed_by: string | null
  started_at: string | null
  completed_at: string | null
  customer_notes: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
}

export interface OrderFile {
  id: string
  order_id: string
  file_name: string
  file_type: string
  file_size: number
  storage_bucket: string
  storage_path: string
  storage_url: string | null
  local_path: string | null
  is_downloaded: boolean
  downloaded_at: string | null
  page_count: number | null
  asset_classification?: AssetClassification | null
  dimensions: { width: number; height: number } | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface QueueEntry {
  id: string
  order_id: string
  queue_number: number
  queue_date: string
  priority_score: number
  wait_time_minutes: number
  estimated_service_minutes: number | null
  congestion_factor: number
  rush_multiplier: number
  estimated_wait_minutes?: number | null
  arrival_rate_snapshot?: number | null
  utilization_snapshot?: number | null
  position: number | null
  status: QueueEntryStatus
  called_at: string | null
  served_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface HardwareDevice {
  id: string
  device_name: string
  device_type: HardwareDeviceType
  status: HardwareDeviceStatus
  location: string | null
  is_enabled: boolean
  capabilities: Record<string, unknown>
  last_heartbeat: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface PrintJobAssignment {
  id: string
  order_id: string
  device_id: string | null
  status: PrintJobAssignmentStatus
  assigned_at: string
  started_at: string | null
  completed_at: string | null
  rerouted_from_device_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface FailoverEvent {
  id: string
  order_id: string | null
  assignment_id: string | null
  from_device_id: string | null
  to_device_id: string | null
  reason: string
  status: 'rerouted' | 'unassigned'
  created_at: string
}

export interface AuditLog {
  id: string
  event_type: string
  entity_type: string | null
  entity_id: string | null
  actor_id: string | null
  actor_role: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

// ============================================
// JOINED / EXTENDED TYPES
// ============================================

export interface OrderWithDetails extends Order {
  service?: Service
  order_files?: OrderFile[]
  queue_entry?: QueueEntry
  profile?: Profile
}

export interface QueueEntryWithOrder extends QueueEntry {
  order?: OrderWithDetails
}

// ============================================
// API REQUEST / RESPONSE TYPES
// ============================================

export interface CreateOrderRequest {
  service_id: string
  source: OrderSource
  kiosk_station_id?: string
  service_options: Record<string, unknown>
  file_ids: string[]
  customer_name?: string
  customer_email?: string
  customer_phone?: string
  customer_notes?: string
  is_rush?: boolean
}

export interface CreateOrderResponse {
  id: string
  order_number: string
  queue_number: number
  status: OrderStatus
  total_price: number
  estimated_wait_minutes: number
  created_at: string
}

export interface UpdateOrderRequest {
  status?: OrderStatus
  admin_notes?: string
  is_rush?: boolean
}

export interface OptimizedQueueItem {
  orderId: string
  orderNumber: string
  position: number
  priorityScore: number
  components: {
    waitCost: number
    rushScore: number
    durationScore: number
    congestionScore: number
  }
  estimatedWaitMinutes: number
}

export interface QueueMetrics {
  totalOrders: number
  avgWaitMinutes: number
  maxWaitMinutes: number
  rushOrders: number
  efficiencyScore: number
}

export interface DashboardStats {
  todayTotal: number
  pending: number
  processing: number
  completed: number
  avgWaitMinutes: number
  revenue: number
}
