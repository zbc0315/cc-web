import React from 'react';
import { toast } from 'sonner';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    toast.error(error.message || 'Something went wrong');
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-sm text-muted-foreground">
          <p>出错了</p>
          <button
            onClick={this.handleReset}
            className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
