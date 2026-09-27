/** Small DOM primitives: no animation library and no repeated card remounts. */
import { escapeHTML } from './utils.js';
import { icon } from '../components/icons.js';

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function desktopShortcuts(): boolean {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !mobile && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** Morph existing nodes so a progress update never reloads images or restarts motion. */
function morph(current: Node, next: Node): void {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.parentNode?.replaceChild(next.cloneNode(true), current); return;
  }
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.textContent !== next.textContent) current.textContent = next.textContent;
    return;
  }
  if (!(current instanceof Element) || !(next instanceof Element)) return;
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  const oldChildren = [...current.childNodes]; const newChildren = [...next.childNodes];
  for (let index = 0; index < Math.max(oldChildren.length, newChildren.length); index++) {
    if (!newChildren[index]) oldChildren[index]?.remove();
    else if (!oldChildren[index]) current.append(newChildren[index].cloneNode(true));
    else morph(oldChildren[index], newChildren[index]);
  }
}

export function reconcileCards(container: HTMLElement, cards: { id: string; html: string }[]): void {
  const existing = new Map([...container.querySelectorAll<HTMLElement>(':scope > [data-item-id]')].map(node => [node.dataset.itemId!, node]));
  if (!existing.size) container.replaceChildren();
  const desired = new Set(cards.map(card => card.id));
  for (const [id, node] of existing) if (!desired.has(id)) node.remove();
  cards.forEach((card, index) => {
    const template = document.createElement('template'); template.innerHTML = card.html;
    const fresh = template.content.firstElementChild as HTMLElement;
    let node = existing.get(card.id); const isNew = !node;
    const justCompleted = node && !node.classList.contains('state-complete') && fresh.classList.contains('state-complete');
    if (node) morph(node, fresh); else node = fresh;
    // Only move a node when the order actually changed. Focus and text selection survive updates.
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
    if (!reducedMotion() && typeof node.animate === 'function') {
      if (isNew) node.animate([{ opacity: 0, transform: 'translateY(12px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 340, delay: Math.min(index, 4) * 35, easing: 'cubic-bezier(.2,.8,.2,1)' });
      else if (justCompleted) node.animate([{ boxShadow: '0 0 0 0 var(--line-strong)' }, { boxShadow: '0 0 0 5px transparent' }], { duration: 650, easing: 'ease-out' });
    }
  });
}

interface DialogOptions {
  title: string; body: string; closeLabel: string; classes?: string; onClose?: () => void;
}
export function createDialog({ title, body, closeLabel, classes = '', onClose }: DialogOptions): HTMLDialogElement {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog'); dialog.className = `dialog ${classes}`;
  const titleId = `dialog-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="${titleId}" tabindex="-1">${escapeHTML(title)}</h2><button type="button" class="icon-button dialog-close" aria-label="${escapeHTML(closeLabel)}">${icon('close')}</button></div>${body}<p class="dialog-status" role="status" aria-live="polite" hidden></p>`;
  document.body.append(dialog); document.documentElement.classList.add('modal-open');
  const nativeClose = dialog.close.bind(dialog);
  dialog.close = (value?: string) => {
    if (!dialog.open || dialog.dataset.closing) return;
    dialog.dataset.closing = 'true';
    if (reducedMotion() || typeof dialog.animate !== 'function') { nativeClose(value); return; }
    const animation = dialog.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.985)' }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
    void animation.finished.catch(() => undefined).then(() => nativeClose(value));
  };
  dialog.querySelector('.dialog-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  let backdropStart = false;
  const outside = (event: PointerEvent | MouseEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  dialog.addEventListener('pointerdown', event => { backdropStart = outside(event); });
  dialog.addEventListener('click', event => { if (backdropStart && outside(event)) dialog.close(); backdropStart = false; });
  dialog.addEventListener('close', () => {
    dialog.remove(); onClose?.();
    if (!document.querySelector('dialog[open]')) {
      document.documentElement.classList.remove('modal-open');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }
  }, { once: true });
  dialog.showModal();
  if (classes.includes('reader-dialog')) dialog.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  return dialog;
}
