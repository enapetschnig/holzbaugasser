import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-screen flex items-center justify-center p-4">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 max-w-lg w-full">
              <h2 className="text-lg font-bold text-destructive mb-2">Fehler beim Laden der Seite</h2>
              <p className="text-sm text-muted-foreground mb-4">
                {this.state.error?.message || "Unbekannter Fehler"}
              </p>
              <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40 mb-4">
                {this.state.error?.stack}
              </pre>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
              >
                Seite neu laden
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
