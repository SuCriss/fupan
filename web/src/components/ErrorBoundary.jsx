import React from 'react'

/**
 * Keeps one broken subtree from blanking the whole page.
 *
 * Without a boundary React unmounts the entire root when a render throws, which
 * shows up as a black screen with no way back. This renders a small inline
 * failure panel instead, and clears itself when `resetKey` changes (for example
 * when a different stock is opened).
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Keep the trace in the console for debugging; the UI stays usable.
    console.error('render error caught by boundary:', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="err-boundary" role="alert">
        <b>该面板渲染出错</b>
        <span className="err-msg">{String(this.state.error?.message || this.state.error)}</span>
        <button className="btn" onClick={() => this.setState({ error: null })}>重试</button>
      </div>
    )
  }
}
