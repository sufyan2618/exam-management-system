import { Component } from "react";
import type { ReactNode } from "react";

export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <section className="account-card screen-notice">
      <h2>This view could not be displayed</h2>
      <p role="alert">The examination service returned information this screen could not read.</p>
      <button className="button button-primary" onClick={() => this.setState({ failed: false })}>Try again</button>
    </section>;
    return this.props.children;
  }
}
