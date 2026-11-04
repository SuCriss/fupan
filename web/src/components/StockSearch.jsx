import { useEffect, useRef, useState } from 'react'
import { searchStocks } from '../lib/api'

/**
 * Header stock search. Queries the server's local symbol table (no market
 * fetch), so results appear instantly. Picking a row opens the detail drawer,
 * which already renders the full K-line panes.
 */
export default function StockSearch({ onPick }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  const seq = useRef(0)

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setItems([])
      setOpen(false)
      return undefined
    }
    const mine = (seq.current += 1)
    setBusy(true)
    const t = setTimeout(() => {
      searchStocks(term)
        .then((r) => {
          if (mine !== seq.current) return // a newer query already won
          setItems(r.items || [])
          setOpen(true)
          setActive(0)
        })
        .catch(() => {
          if (mine === seq.current) setItems([])
        })
        .finally(() => {
          if (mine === seq.current) setBusy(false)
        })
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDoc = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (item) => {
    if (!item) return
    onPick(item.code)
    setQ('')
    setItems([])
    setOpen(false)
  }

  const onKey = (e) => {
    if (!open || !items.length) {
      if (e.key === 'Escape') setQ('')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(items[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="search" ref={box}>
      <input
        className="inp search-inp"
        type="text"
        value={q}
        placeholder="搜索代码 / 名称"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onKeyDown={onKey}
        aria-label="搜索个股"
      />
      {busy && <span className="search-spin" />}
      {open && (
        <ul className="search-pop">
          {items.length === 0 && <li className="search-empty">无匹配个股</li>}
          {items.map((it, i) => (
            <li
              key={it.code}
              className={`search-item${i === active ? ' on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(it)}
            >
              <span className="si-code">{it.code}</span>
              <span className="si-name">{it.name}</span>
              {typeof it.chg === 'number' && (
                <span className={`si-chg ${it.chg >= 0 ? 'up' : 'dn'}`}>
                  {it.chg >= 0 ? '+' : ''}{it.chg.toFixed(2)}%
                </span>
              )}
              {it.boards > 1 && <span className="si-tag">{it.boards}板</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
