// Error boundaries: the one around the whole editor, and the small one
// each lazy panel sits in. Without them any render error or failed chunk
// unmounts everything and leaves a blank page.

import React from 'react';

// The whole editor failed. One job: say so, and get the person back to
// work. The details go to the console; the screen keeps one fixed wording,
// like the app's other error states.
export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Home Studio: the editor stopped.', error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <div className="top">
          <div>
            <h1>Home Studio</h1>
            <div className="sub">Designs are saved on this device</div>
          </div>
        </div>
        <div className="work">
          <div className="state-error" role="alert">
            <h2 className="text-heading">Something went wrong in the editor.</h2>
            <p className="sub">Your designs are still on this device. Reload to keep working. Home Studio offers back any changes it had not saved yet.</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

// One lazy panel failed to load (offline before it was cached, or an old
// hash after an update). The dialog is closed and a notice shown through
// onError; nothing renders where the panel would have been, and the
// editor keeps working. The next try gets a fresh chunk via reset().
export class ChunkBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('Home Studio: a panel could not load.', error);
    const { onError } = this.props;
    if (onError) onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}