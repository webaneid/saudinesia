'use client'

import { createContext, useContext, type ReactNode } from 'react'

// Peran admin untuk komponen klien (mis. VendorPicker menampilkan "Vendor baru" hanya bagi superadmin). Hanya petunjuk tampilan —
// penjaga sebenarnya tetap API (requireSuperAdmin).
const AdminRoleContext = createContext<{ isSuperAdmin: boolean }>({ isSuperAdmin: false })

export function AdminRoleProvider({ isSuperAdmin, children }: { isSuperAdmin: boolean; children: ReactNode }) {
  return <AdminRoleContext.Provider value={{ isSuperAdmin }}>{children}</AdminRoleContext.Provider>
}

export const useIsSuperAdmin = () => useContext(AdminRoleContext).isSuperAdmin
