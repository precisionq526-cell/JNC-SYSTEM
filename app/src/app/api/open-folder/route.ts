import { openVerifiedLocal } from '@/lib/hardware/open-local'
export async function POST(request: Request) { return openVerifiedLocal(request, true) }
