// The app's error boundary: a panel that throws while it renders shows a message where it was, never
// a blank page. The canvas and the code view (framework-free, outside every guard) keep the drawing,
// the drafts are untouched, and Files is one tap away (it tries the panel again, then opens the
// Files menu).

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Try again, then open the Files menu. */
  files: () => void;
}

export class Guard extends Component<Props, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown): { error: string } {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="draw-alert draw-alert--loud draw-crash" role="alert">
        <p className="draw-alert-text">Draw couldn’t show this part ({this.state.error}). The drawing and your drafts are kept.</p>
        <button
          type="button"
          className="draw-key draw-alert-go"
          onClick={() => {
            this.setState({ error: null });
            this.props.files();
          }}
        >
          Files
        </button>
      </div>
    );
  }
}
