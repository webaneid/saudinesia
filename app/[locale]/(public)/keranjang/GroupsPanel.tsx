'use client'

import { useTranslations } from 'next-intl'
import { Plus, Trash2, UsersRound } from 'lucide-react'
import { groupMark } from '@/lib/booking/groupNames'
import { addCartGroup, CART_GROUP_LABEL_MAX, cartPeople, removeCartGroup, setCartGroup, setCartPeople, type DeviceCart } from '@/lib/checkout/cartStore'
import { PeopleStepper } from '../checkout/[kind]/PeopleStepper'

/**
 * Panel jumlah jamaah keranjang (Fase 11d-3, docs/arsitektur-booking-engine-v2.md §10.8): satu rombongan = satu stepper (perilaku 11c);
 * "Tambah rombongan" → daftar rombongan (nama opsional + jumlah jamaah + hapus). Σ jamaah dibatasi `maxPeople`.
 */
export function GroupsPanel({ cart, maxPeople }: { cart: DeviceCart; maxPeople: number }) {
  const t = useTranslations('cart')
  const total = cartPeople(cart)
  const canAdd = total < maxPeople
  const name = (label: string, i: number) => label.trim() || t('groupUnnamed', { mark: groupMark(i) })

  if (cart.groups.length === 1) {
    return (
      <div className="checkout-panel">
        <label htmlFor="cart-people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('people')}</label>
        <PeopleStepper id="cart-people" value={cart.groups[0]!.size} onChange={setCartPeople} max={maxPeople} />
        <p className="text-xs text-muted-foreground">{t('peopleHint')}</p>
        <button type="button" onClick={addCartGroup} disabled={!canAdd} className="btn-brand-outline self-start disabled:opacity-40">
          <Plus className="h-4 w-4" aria-hidden /> {t('addGroup')}
        </button>
      </div>
    )
  }

  return (
    <div className="checkout-panel">
      <p className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('groupsTitle')}</p>
      <p className="text-xs text-muted-foreground">{t('groupsHint')}</p>
      <ul className="space-y-3">
        {cart.groups.map((g, i) => {
          const shown = name(g.label, i)
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <input value={g.label} maxLength={CART_GROUP_LABEL_MAX} onChange={e => setCartGroup(i, { label: e.target.value })}
                placeholder={t('groupUnnamed', { mark: groupMark(i) })} aria-label={t('groupName', { name: shown })}
                className="checkout-input min-w-0 flex-1 basis-40" />
              <div aria-label={t('groupSize', { name: shown })} role="group">
                <PeopleStepper id={`cart-group-${i}`} value={g.size} onChange={n => setCartGroup(i, { size: n })} max={maxPeople - (total - g.size)} />
              </div>
              <button type="button" onClick={() => removeCartGroup(i)} aria-label={t('removeGroup', { name: shown })}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-destructive transition-colors hover:border-destructive">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={addCartGroup} disabled={!canAdd} className="btn-brand-outline disabled:opacity-40">
          <Plus className="h-4 w-4" aria-hidden /> {t('addGroup')}
        </button>
        <p className="text-sm font-semibold text-brand-dark">{t('totalPeople', { count: total })}</p>
      </div>
    </div>
  )
}
