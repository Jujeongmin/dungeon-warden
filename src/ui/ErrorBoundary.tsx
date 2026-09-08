import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Turns a crash into something readable.
 *
 * When a render throws, React 18 unmounts the whole tree — the page goes black
 * and takes the boot placeholder with it, which is indistinguishable from the
 * bundle never loading. That cost a long debugging session against the editor
 * preview, where the console is not easy to reach. Anything that gets this far
 * is a bug, so the panel says what happened rather than pretending to recover.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[dungeon-warden] render failed", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <h1>DUNGEON WARDEN</h1>
        <p>The game could not start.</p>
        <pre>{error.message}</pre>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
