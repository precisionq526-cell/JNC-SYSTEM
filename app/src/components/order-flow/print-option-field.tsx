'use client'

import { Check, Minus, Plus } from 'lucide-react'
import type { KioskOptionSummary, KioskOptionValue } from '@/lib/kiosk/order-draft'
import { PAPER_LABELS, printOptionHint } from '@/lib/kiosk/print-options'

export function PrintOptionField({ option, value, onChange, prefix }: {
  option: KioskOptionSummary; value: KioskOptionValue | undefined
  onChange: (value: KioskOptionValue) => void; prefix: string
}) {
  const id = `${prefix}-${option.id}`
  const hint = printOptionHint(option.name)
  const choices = option.optionType === 'toggle' ? ['Yes', 'No'] : option.choices
  const color = option.name === 'Print Color' || option.name === 'Color Mode'
  const segmented = option.optionType === 'toggle' || (color && option.optionType === 'select')
  const label = (choice: string) => option.name === 'Paper Size' ? PAPER_LABELS[choice] ?? choice : choice === 'B&W' ? 'Black & white' : choice
  return <div className={`field print-option ${color ? 'print-option-color' : ''}`}>
    <label id={`${id}-label`} htmlFor={segmented ? undefined : id}>{option.name}</label>
    {segmented ? <div className="option-choices" role="group" aria-labelledby={`${id}-label`}>
      {choices.map(choice => <button key={choice} type="button" aria-pressed={String(value) === choice} onClick={() => onChange(choice)}>
        {color && <span className={`color-swatch ${/colou?r/i.test(choice) && choice !== 'B&W' ? 'color-swatch-full' : ''}`} aria-hidden="true" />}
        <span>{label(choice)}</span>{String(value) === choice && <Check size={15} />}
      </button>)}
    </div> : option.optionType === 'select' ? <select id={id} value={String(value ?? '')} onChange={e => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined}>
      {choices.map(choice => <option key={choice} value={choice}>{label(choice)}</option>)}
    </select> : option.optionType === 'number' && option.name === 'Copies' ? <div className="quantity-control">
      <button type="button" aria-label="Decrease copies" disabled={Number(value) <= 1} onClick={() => onChange(Math.max(1, (Number(value) || 1) - 1))}><Minus size={16} /></button>
      <input id={id} type="number" min={1} max={10000} step={1} value={String(value ?? 1)} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} aria-describedby={hint ? `${id}-hint` : undefined} />
      <button type="button" aria-label="Increase copies" disabled={Number(value) >= 10000} onClick={() => onChange(Math.min(10000, (Number(value) || 0) + 1))}><Plus size={16} /></button>
    </div> : <input id={id} type={option.optionType === 'number' ? 'number' : 'text'} min={option.optionType === 'number' ? 1 : undefined} max={option.optionType === 'number' ? 10000 : undefined} step={option.optionType === 'number' ? 1 : undefined} value={String(value ?? '')} onChange={e => onChange(option.optionType === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />}
    {hint && <small id={`${id}-hint`} className="option-hint">{hint}</small>}
  </div>
}
