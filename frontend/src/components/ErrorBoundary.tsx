import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 m-4 rounded-lg border border-error/30 bg-error/5">
          <div className="font-mono text-sm text-error mb-2">Something went wrong</div>
          <pre className="text-xs text-graphite-100 overflow-auto max-h-40">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 px-3 py-1 rounded text-xs font-mono border border-line-soft text-graphite-100 hover:text-foreground cursor-pointer"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
