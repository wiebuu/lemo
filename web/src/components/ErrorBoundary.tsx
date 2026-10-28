import { Component, type ReactNode } from 'react'
import { isStaleChunkError, reloadForNewVersion } from '../lib/staleBuild'

/** Keeps one broken widget from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (isStaleChunkError(error) && reloadForNewVersion()) return // a new version was deployed: load it
    console.error(`[lemo] ${this.props.label ?? 'component'} crashed:`, error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="text-xs text-sub text-center py-3">
        something went wrong in the {this.props.label ?? 'page'} ·{' '}
        <button type="button" className="text-main hover:underline" onClick={() => this.setState({ error: null })}>
          try again
        </button>{' '}
        ·{' '}
        <button type="button" className="text-main hover:underline" onClick={() => location.reload()}>
          reload
        </button>
      </div>
    )
  }
}
