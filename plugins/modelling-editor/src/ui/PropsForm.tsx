/**
 * A form rendered from an operator's JSON-schema `props`: numbers, integers, booleans, enums,
 * `[x, y, z]` triples and free text. Used by the redo-last panel and by "run with options" in the
 * palette. Values are committed on change; the caller decides what to do with them.
 */

import React from 'react'
import {Checkbox, HTMLSelect, InputGroup, NumericInput, Tooltip} from '@blueprintjs/core'
import type {PropDef, PropSchema} from '@threepipe/plugin-editor-engine'

export interface PropsFormProps {
    schema: PropSchema
    values: Record<string, unknown>
    onChange(values: Record<string, unknown>): void
    disabled?: boolean
}

function labelOf(key: string): string {
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

function Field({name, def, value, onChange, disabled}: {name: string, def: PropDef, value: unknown, onChange(v: unknown): void, disabled?: boolean}) {
    const id = `me-prop-${name}`
    let control: React.ReactNode
    const isVec3 = def.type === 'array' && def.items?.type === 'number' && def.minItems === 3 && def.maxItems === 3
    if (def.enum) {
        control = <HTMLSelect id={id} value={(value as string) ?? ''} disabled={disabled} fill
            onChange={e => onChange(e.currentTarget.value || undefined)}>
            {value === undefined && <option value="">(default)</option>}
            {def.enum.map(v => <option key={v} value={v}>{v}</option>)}
        </HTMLSelect>
    } else if (def.type === 'boolean') {
        control = <Checkbox id={id} checked={!!value} disabled={disabled}
            onChange={e => onChange(e.currentTarget.checked)} />
    } else if (def.type === 'number' || def.type === 'integer') {
        const step = def.type === 'integer' ? 1 : def.maximum !== undefined && def.maximum <= 1 ? 0.05 : 0.1
        control = <NumericInput id={id} value={value === undefined ? '' : value as number} disabled={disabled} fill
            min={def.minimum} max={def.maximum} stepSize={step} minorStepSize={def.type === 'integer' ? null : step / 10}
            majorStepSize={step * 10} placeholder={def.default !== undefined ? String(def.default) : 'default'}
            onValueChange={(n, s) => onChange(s === '' || Number.isNaN(n) ? undefined : n)} />
    } else if (isVec3) {
        const arr = Array.isArray(value) ? value as number[] : [0, 0, 0]
        control = <div className="me-vec3">
            {['X', 'Y', 'Z'].map((axis, i) => <NumericInput key={axis} value={arr[i] ?? 0} disabled={disabled} stepSize={0.1}
                minorStepSize={0.01} majorStepSize={1} buttonPosition="none" leftElement={<span className="me-axis">{axis}</span>}
                onValueChange={n => { const next = [...arr]; next[i] = Number.isNaN(n) ? 0 : n; onChange(next) }} />)}
        </div>
    } else {
        control = <InputGroup id={id} value={value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)}
            disabled={disabled} fill placeholder="default"
            onChange={e => {
                const s = e.currentTarget.value
                if (s === '') return onChange(undefined)
                try { onChange(JSON.parse(s)) } catch { onChange(s) }
            }} />
    }
    return <div className="me-prop">
        <Tooltip content={def.description ?? name} compact hoverOpenDelay={500} placement="left" targetTagName="label" disabled={!def.description}>
            <label htmlFor={id} className="me-prop-label">{labelOf(name)}</label>
        </Tooltip>
        <div className="me-prop-control">{control}</div>
    </div>
}

export function PropsForm({schema, values, onChange, disabled}: PropsFormProps) {
    const entries = Object.entries(schema.properties ?? {})
    if (!entries.length) return <div className="me-props-empty">No parameters.</div>
    return <div className="me-props-form">
        {entries.map(([name, def]) => <Field
            key={name} name={name} def={def} value={values[name]} disabled={disabled}
            onChange={v => {
                const next = {...values}
                if (v === undefined) delete next[name]
                else next[name] = v
                onChange(next)
            }} />)}
    </div>
}
