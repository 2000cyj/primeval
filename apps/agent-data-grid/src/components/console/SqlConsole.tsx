import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface SqlConsoleProps {
  value: string
  onChange: (value: string) => void
}

const ROOT = {
  display: 'flex',
  flex: '1 1 auto',
  minHeight: 0,
  position: 'relative',
  background: 'var(--bg-editor)',
  overflow: 'hidden',
} as const

const GUTTER = {
  flex: 'none',
  width: 44,
  background: 'var(--bg-panel, var(--bg-elev))',
  borderRight: '1px solid var(--border)',
  overflow: 'hidden',
  position: 'relative',
} as const

const EDITOR = {
  flex: '1 1 auto',
  minWidth: 0,
  height: '100%',
  display: 'flex',
} as const

const TEXTAREA = {
  flex: '1 1 auto',
  width: '100%',
  height: '100%',
  margin: 0,
  padding: '8px 12px',
  border: 'none',
  outline: 'none',
  resize: 'none',
  boxShadow: 'none',
  background: 'var(--bg-editor)',
  color: 'var(--fg-editor)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-code)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  overflow: 'auto',
  tabSize: 4,
  spellCheck: false,
} as const

/**
 * Invisible twin of the editor used to measure how many visual rows each
 * logical line occupies once it soft-wraps. Keeping it in the same font and
 * width as the textarea makes the line numbers line up with the text.
 */
const MIRROR = {
  position: 'absolute',
  top: 0,
  left: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-code)',
  lineHeight: 1.6,
} as const

/**
 * SQL editor: a 44px line-number gutter next to a monospaced textarea. The
 * gutter follows the textarea's vertical scroll and numbers every logical
 * line, keeping the number of each line on its first visual row.
 */
export function SqlConsole({ value, onChange }: SqlConsoleProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [rowsPerLine, setRowsPerLine] = useState<number[]>([])
  const [lineHeight, setLineHeight] = useState(20.8)

  const measure = useCallback(() => {
    const textarea = textareaRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return

    const style = window.getComputedStyle(textarea)
    mirror.style.fontFamily = style.fontFamily
    mirror.style.fontSize = style.fontSize
    mirror.style.fontWeight = style.fontWeight
    mirror.style.fontStyle = style.fontStyle
    mirror.style.letterSpacing = style.letterSpacing
    mirror.style.lineHeight = style.lineHeight
    mirror.style.tabSize = style.tabSize
    mirror.style.whiteSpace = style.whiteSpace
    mirror.style.overflowWrap = style.overflowWrap
    mirror.style.wordBreak = style.wordBreak
    mirror.style.paddingTop = style.paddingTop
    mirror.style.paddingBottom = style.paddingBottom

    const contentWidth =
      textarea.clientWidth -
      parseFloat(style.paddingLeft || '0') -
      parseFloat(style.paddingRight || '0')
    mirror.style.width = `${Math.max(contentWidth, 0)}px`

    const rows = parseFloat(style.lineHeight)
    if (Number.isFinite(rows) && rows > 0) setLineHeight(rows)

    mirror.textContent = textarea.value
    const node = mirror.firstChild
    const lines = textarea.value.split('\n')
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      setRowsPerLine(lines.map(() => 1))
      return
    }

    const range = document.createRange()
    const counts: number[] = []
    let offset = 0
    for (const line of lines) {
      range.setStart(node, offset)
      range.setEnd(node, offset + line.length)
      const rects = Array.from(range.getClientRects())
      const tops = new Set(rects.map((rect) => Math.round(rect.top * 2) / 2))
      counts.push(tops.size > 0 ? tops.size : 1)
      offset += line.length + 1
    }
    setRowsPerLine(counts)
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, value])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [measure])

  useEffect(() => {
    if (!document.fonts) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) measure()
    })
    return () => {
      cancelled = true
    }
  }, [measure])

  // The gutter mirrors the textarea's vertical scroll without a scrollbar of
  // its own: the number column is translated instead of scrolled.
  const syncScroll = () => {
    const textarea = textareaRef.current
    const gutter = gutterRef.current
    if (!textarea || !gutter) return
    gutter.style.transform = `translateY(${-textarea.scrollTop}px)`
  }

  return (
    <div style={ROOT}>
      <div style={GUTTER}>
        <div
          ref={gutterRef}
          style={{
            paddingTop: 8,
            paddingBottom: 8,
            willChange: 'transform',
          }}
        >
          {rowsPerLine.map((rows, index) => (
            <div
              key={index}
              style={{
                height: rows * lineHeight,
                paddingRight: 8,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-small)',
                color: 'var(--fg-muted)',
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  height: lineHeight,
                  lineHeight: `${lineHeight}px`,
                  overflow: 'hidden',
                }}
              >
                {index + 1}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={EDITOR}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          style={TEXTAREA}
          spellCheck={false}
          wrap="soft"
          aria-label="SQL editor"
        />
      </div>

      <div ref={mirrorRef} style={MIRROR} aria-hidden="true" />
    </div>
  )
}
