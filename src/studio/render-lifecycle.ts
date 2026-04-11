export function shouldRenderPreview(isSlicing: boolean): boolean {
    if (isSlicing) {
        return false;
    }

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return false;
    }

    if (typeof document !== 'undefined' && !document.hasFocus()) {
        return false;
    }

    return true;
}

export function attachRenderLifecycleHandlers(refresh: () => void): () => void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return () => {};
    }

    const listeners: Array<() => void> = [];

    const addDocumentListener = (eventName: string, handler: EventListener): void => {
        document.addEventListener(eventName, handler);
        listeners.push(() => document.removeEventListener(eventName, handler));
    };

    const addWindowListener = (eventName: string, handler: EventListener): void => {
        window.addEventListener(eventName, handler);
        listeners.push(() => window.removeEventListener(eventName, handler));
    };

    const onRefresh = refresh as EventListener;
    addDocumentListener('visibilitychange', onRefresh);
    addDocumentListener('freeze', onRefresh);
    addDocumentListener('resume', onRefresh);
    addWindowListener('focus', onRefresh);
    addWindowListener('blur', onRefresh);
    addWindowListener('pageshow', onRefresh);
    addWindowListener('pagehide', onRefresh);

    return () => {
        for (const remove of listeners) {
            remove();
        }
    };
}
