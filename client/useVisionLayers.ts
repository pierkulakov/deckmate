import { useEffect, type RefObject } from 'react';
import { moveFocus } from './focus.ts';

function focusAfterClose(opener: HTMLElement | null) {
  if (opener?.isConnected) moveFocus(opener, { preventScroll: true });
}

/** 2026-11-13: Excalidraw's document-capture menu handler precedes nested Radix popovers,
 * and its canvas handler consumes Escape before the undocked library can receive it.
 * Its search sidebar shares window capture, so an owned Escape must also stop sibling listeners. */
export function useVisionLayers(host: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!host.current || typeof window === 'undefined') return;
    const canvas = host.current;
    const supportsOpenSelect = CSS.supports('selector(select:open)');
    let commandOpener: HTMLElement | null = null;
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest('.dropdown-menu:not(.fonts)')?.previousElementSibling;
      if (trigger instanceof HTMLElement && trigger.matches('.dropdown-menu-button')) commandOpener = trigger;
      else if (!event.target.closest('.sidebar') && !commandOpener?.contains(event.target)) commandOpener = null;
    };
    const keydown = (event: KeyboardEvent) => {
      const editor = host.current?.querySelector<HTMLElement>('.excalidraw');
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.repeat
        || !(event.target instanceof Node) || !editor) return;
      const modal = event.target instanceof Element ? event.target.closest('.excalidraw-modal-container .Modal') : null;
      if (modal) {
        // 2026-11-13: a command dialog's menu item unmounts before its native focus return.
        const opener = commandOpener;
        requestAnimationFrame(() => {
          if (!modal.isConnected && document.activeElement === document.body) focusAfterClose(opener);
        });
        return;
      }
      const eyedropper = editor.querySelector<HTMLElement>('.excalidraw-eye-dropper-trigger.selected');
      if (!editor.contains(event.target) && !(eyedropper && event.target === document.body)) return;
      if (editor.querySelector('.Modal, .context-menu')
        || (supportsOpenSelect && editor.querySelector('select:open'))) return;

      const trigger = editor.querySelector<HTMLElement>('[aria-haspopup="dialog"][aria-expanded="true"]');
      const menu = editor.querySelector<HTMLElement>('.dropdown-menu:not(.fonts)');
      const menuTrigger = menu?.previousElementSibling;
      const sidebar = editor.querySelector<HTMLElement>('.sidebar');
      const sidebarTrigger = editor.querySelector<HTMLInputElement>('.sidebar-trigger__label-element input:checked');
      const closableSidebar = sidebar && (sidebar.querySelector('.layer-ui__search')
        || !sidebar.classList.contains('sidebar--docked') || editor.classList.contains('excalidraw--mobile'));

      if (eyedropper) {
        event.preventDefault(); event.stopImmediatePropagation();
        eyedropper.click();
        moveFocus(editor.querySelector<HTMLInputElement>('.color-picker-input'), { preventScroll: true });
        return;
      }
      if (trigger) {
        const content = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
        if (!content) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const opener = trigger.matches('button, input') ? trigger : trigger.querySelector<HTMLElement>('button');
        // 2026-11-13: PropertiesPopover deliberately focuses the canvas during FocusScope cleanup.
        // Restore the opening control after that callback, keeping its state cleanup intact.
        content.addEventListener('focusScope.autoFocusOnUnmount', () => {
          queueMicrotask(() => focusAfterClose(opener));
        }, { once: true });
        trigger.click();
      } else if (menuTrigger instanceof HTMLElement && menuTrigger.matches('.dropdown-menu-button')) {
        event.preventDefault(); event.stopImmediatePropagation();
        menuTrigger.click();
        focusAfterClose(menuTrigger);
      } else if (closableSidebar) {
        const close = sidebar.querySelector<HTMLElement>('.sidebar__close');
        if (!close) return;
        event.preventDefault(); event.stopImmediatePropagation();
        close.click();
        focusAfterClose(commandOpener ?? sidebarTrigger ?? editor);
      }
    };
    // 2026-11-13: the mobile main menu omits its outside-click callback; the embedded
    // editor also has surrounding page controls, so leaving the canvas must dismiss it.
    const pointerdown = (event: PointerEvent) => {
      const editor = host.current?.querySelector('.excalidraw--mobile');
      const trigger = editor?.querySelector<HTMLElement>('.main-menu-trigger');
      const menu = trigger?.nextElementSibling;
      if (!(event.target instanceof Node) || !menu?.matches('.dropdown-menu')
        || menu.contains(event.target) || trigger?.contains(event.target)
        || editor?.querySelector('[aria-haspopup="dialog"][aria-expanded="true"], .Modal')) return;
      trigger?.click();
    };
    window.addEventListener('keydown', keydown, true);
    canvas.addEventListener('click', click, true);
    document.addEventListener('pointerdown', pointerdown);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      canvas.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', pointerdown);
    };
  }, [host]);
}
