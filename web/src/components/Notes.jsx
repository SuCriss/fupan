import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getNote, saveNote, draftNote } from '../lib/api'

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
  const [drafting, setDrafting] = useState(false)
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

  /**
   * Ask the server to draft a note from this day's review data.
   *
   * The draft replaces the textarea and is saved immediately, so a generated
   * paragraph is never lost if the tab closes before the debounce fires.
   */
  const draft = async () => {
    if (!date || drafting) return
    if (text.trim() && !window.confirm('将用 AI 生成的内容替换当前笔记，继续？')) return
    setDrafting(true)
    setStatus('生成中…')
    try {
      const r = await draftNote(date)
      clearTimeout(timer.current)
      setText(r.content || '')
      await flush(r.content || '')
    } catch (e) {
      setStatus(e.message || '生成失败')
    } finally {
      setDrafting(false)
    }
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
              className="btn sm nb-ai"
              onClick={draft}
              disabled={drafting || status === 'saving'}
              title="根据当日复盘数据生成一段笔记草稿"
            >
              {drafting ? '生成中…' : 'AI 生成'}
            </button>
            <button
              className="btn sm"
              onClick={() => { clearTimeout(timer.current); flush(text) }}
              disabled={status === 'saving' || drafting}
            >
              立即保存
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
