import React from "react";
import { pick } from "../app/i18n.js";
import { translateUiText } from "../app/runtimeTranslation.js";

/**
 * Component-level error boundary.
 * Catches render errors in children and displays a fallback UI
 * instead of crashing the entire page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const label = this.props.label || "Ce composant";

      return (
        <div className="errorbox" style={{ margin: "12px 0" }}>
          <div className="errorbox__title" data-no-ui-translate="1">
            {pick(
              `Nem sikerült megjeleníteni: ${translateUiText(label)}`,
              `${translateUiText(label)} could not be displayed`,
              `${label} n'a pas pu être affiché`
            )}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {this.state.error?.message || "Erreur inattendue"}
          </div>
          <button
            className="btn btn--sm"
            type="button"
            style={{ marginTop: 8 }}
            onClick={this.handleRetry}
          >
            Reessayer
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
