import React from 'react';

// Если на экране что-то пошло не так, вместо чёрного экрана показываем сообщение и кнопку «Вернуться на главную»
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ошибка интерфейса]', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    // при переходе на другой экран пробуем показать его заново
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>Что-то пошло не так</h2>
        <p>
          Скорее всего, приложение было запущено до обновления. Закройте его полностью и запустите заново.
          <br />
          <small>{String(this.state.error?.message || this.state.error).slice(0, 160)}</small>
        </p>
        <button
          data-focusable
          className="btn primary"
          autoFocus
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
        >
          Вернуться на главную
        </button>
      </div>
    );
  }
}
