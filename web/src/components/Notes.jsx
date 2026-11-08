import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getNote, saveNote } from '../lib/api'

/**
 * Free-form review notes for the selected trading day.
 *
 * Saves automatically after a pause so the user never loses a paragraph to a
 * forgotten save button, but keeps an explicit status line so it is obvious
 * whether the text is on the server.
 */
const SAVE_DELAY = 1200

export function NoteBox({ date }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState('')   // last value fetched from the server
  const [status, setStatus] = useState('')   // '' | 'saving' | 'saved' | error text
  const [updatedAt, setUpdatedAt] = useState(null)
  const timer = useRef(null)
  const alive = useRef(true)

  // Load whenever the day changes; closes the editor for a different day so a
  // half-typed note is never shown against the wrong date.
  useEffect(() => {
    alive.current = true
    setStatus('')
    setText('')
    setLoaded('')
    setUpdatedAt(null)
    if (!date) return undefined
    getNote(date)
      .then((r) => {
        if (!alive.current) return
        setText(r.content || '')
        setLoaded(r.content || '')
        setUpdatedAt(r.updatedAt || null)
      })
      .catch(() => { if (alive.current) setStatus('读取失败') })
    return () => { alive.current = false }
  }, [date])

  const flush = useCallback(async (value) => {
    if (!date) return
    setStatus('saving')
    try {
      const r = await saveNote(date, value)
      if (!alive.current) return
      setLoaded(r.content || '')
      setUpdatedAt(r.updatedAt || null)
      // The server is the source of truth. If the textarea state was cleared
      // between the edit and this response (a re-mount, or a fast paste that
      // raced the controlled-input update), restore what was actually saved
      // rather than showing an empty box next to a "saved" badge.
      setText((prev) => (prev.trim() ? prev : (r.content || '')))
      setStatus('saved')
    } catch (e) {
      if (alive.current) setStatus(e.message || '保存失败')
    }
  }, [date])

  const onChange = (e) => {
    const v = e.target.value
    setText(v)
    setStatus('')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(v), SAVE_DELAY)
  }

  // Flush on unmount / date switch so a pending edit is not dropped.
  useEffect(() => () => {
    clearTimeout(timer.current)
  }, [])

  const dirty = text !== loaded
  const words = text.trim().length
  const when = updatedAt
    ? new Date(updatedAt * 1000).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)
    : null

  if (!date) return null

  return (
    <section className={`notebox${open ? ' open' : ''}`}>
      <button
        className="nb-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="note-body"
      >
        <span className="nb-title">复盘笔记</span>
        <span className="nb-meta">
          {words > 0 ? `${words} 字` : '未填写'}
          {when && ` · ${when} 保存`}
          {status === 'saving' && ' · 保存中…'}
          {status === 'saved' && ' · 已保存'}
          {status && status !== 'saving' && status !== 'saved' && ` · ${status}`}
          {dirty && status === '' && ' · 未保存'}
        </span>
        <span className="nb-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div id="note-body" className="nb-body">
          <textarea
            className="nb-input"
            value={text}
            onChange={onChange}
            placeholder={`记录 ${date} 的观察：情绪判断、主线切换、明日关注…`}
            rows={6}
            aria-label={`${date} 复盘笔记`}
          />
          <div className="nb-foot">
            <span className="nb-hint">停止输入后自动保存；清空内容即删除</span>
            <button
              className="btn sm"
              onClick={() => { clearTimeout(timer.current); flush(text) }}
              disabled={status === 'saving'}
            >
              立即保存
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
